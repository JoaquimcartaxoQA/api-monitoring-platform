import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:5173';

async function fixture(t, secure = false) {
  const { createMonitor, hashPassword } = await import('../server/monitor.mjs');
  const root = await mkdtemp(join(tmpdir(), 'api-monitor-'));
  const date = new Date().toISOString().slice(0, 10);
  const file = join(root, date + '.jsonl');
  const requestId = randomUUID();
  const row = (index) => ({timestamp: date + 'T00:00:' + String(index).padStart(2, '0') + '.000Z',
    operation: 'demo.health', method: 'GET', status: 200, requestId, token: 'SECRET-FIXTURE'});
  const source = Array.from({length: 26}, (_, i) => JSON.stringify(row(i))).join('\n') + '\n{broken}\n';
  await writeFile(file, source);
  const audits = [];
  const server = createMonitor({root, origins:[origin], user:'qa', passwordHash:await hashPassword('test-password'),
    secure, operations:{'demo.health':'/health'}, audit:async (event) => { audits.push(event); }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive:true,force:true});
  });
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (path, options) => fetch(url + path, options);
  const post = (path, body, cookie, from = origin) => request(path, {
    method:'POST', headers:{'Content-Type':'application/json', Origin:from, ...(cookie && {Cookie:cookie})},
    body:JSON.stringify(body)
  });
  const login = () => post('/api/session', {user:'qa', password:'test-password'});
  return {file, source, row, request, post, login, audits, requestId};
}

test('status público só contém campos agregados e detalhe retorna 401', async t => {
  const f = await fixture(t);
  const status = await f.request('/api/status');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {state:'available', events:26, errors:0});
  assert.equal((await f.request('/api/logs')).status, 401);
});

test('sessão exige origem autorizada e logout invalida o cookie', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/session', {}, null, 'https://invalid.example')).status, 403);
  assert.equal((await f.post('/api/session', {user:'qa',password:'incorrect'})).status, 401);
  const login = await f.login();
  assert.equal(login.status, 200);
  const header = login.headers.get('set-cookie');
  assert.match(header, /HttpOnly.*SameSite=Strict/);
  const cookie = header.split(';')[0];
  assert.equal((await f.post('/api/logout', {}, cookie)).status, 200);
  assert.equal((await f.request('/api/logs', {headers:{Cookie:cookie}})).status, 401);
  assert.deepEqual(f.audits, ['login_failure','login_success','logout']);
});

test('página permanece estável após novas linhas e a resposta omite campos arbitrários', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const get = path => f.request(path,{headers:{Cookie:cookie}});
  const first = await (await get('/api/logs?requestId=' + f.requestId)).json();
  assert.equal(first.items.length, 25);
  assert.match(first.items[0].timestamp,/00:00:25/);
  assert.equal(first.items[0].endpoint,'/health');
  assert.equal(JSON.stringify(first).includes('SECRET-FIXTURE'), false);
  await writeFile(f.file, f.source + JSON.stringify(f.row(26)) + '\n');
  const next = await (await get('/api/logs?page=2&view=' + first.view + '&requestId=' + f.requestId)).json();
  assert.equal(next.items.length, 1);
  assert.match(next.items[0].timestamp,/00:00:00/);
  assert.equal((await get('/api/logs?requestId=invalid')).status,400);
  assert.equal((await f.post('/api/logs',{},cookie)).status,405);
  assert.equal(await readFile(f.file,'utf8'),f.source + JSON.stringify(f.row(26)) + '\n');
});

test('detalhe preserva o registro seguro capturado, sem campos arbitrários', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const page = await (await f.request('/api/logs', {headers:{Cookie:cookie}})).json();
  assert.deepEqual(page.items[0].log, {
    timestamp: page.items[0].timestamp,
    operation: 'demo.health', method: 'GET', status: 200, requestId: f.requestId
  });
  assert.equal(JSON.stringify(page.items[0].log).includes('SECRET-FIXTURE'), false);
});

test('eventos com o mesmo horário mantêm primeiro o último registro concluído', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const timestamp = new Date().toISOString();
  const first = {...f.row(1), timestamp, requestId:randomUUID()};
  const last = {...f.row(2), timestamp, requestId:randomUUID()};
  await writeFile(f.file, JSON.stringify(first) + '\n' + JSON.stringify(last) + '\n');
  const page = await (await f.request('/api/logs', {headers:{Cookie:cookie}})).json();
  assert.equal(page.items[0].requestId, last.requestId);
  assert.equal(page.items[1].requestId, first.requestId);
});

test('fluxo de eventos avisa sessão autenticada quando um JSONL é atualizado', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await f.request('/api/events', {headers:{Cookie:cookie}, signal:controller.signal});
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const received = (async () => {
    let text = '';
    while (!text.includes('event: logs_changed')) {
      const {done,value} = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    return text;
  })();
  await writeFile(f.file, JSON.stringify(f.row(99)) + '\n');
  const text = await Promise.race([received, new Promise((_,reject) => setTimeout(() => reject(new Error('stream_timeout')), 2000))]);
  assert.match(text, /event: logs_changed/);
  await reader.cancel();
});

test('diretório sem arquivos responde vazio', async t => {
  const f = await fixture(t);
  await rm(f.file);
  const result = await f.request('/api/status');
  assert.deepEqual(await result.json(), {state:'empty', events:0, errors:0});
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/logs',{headers:{Cookie:cookie}})).status,200);
});

test('consulta nova não invalida a paginação já aberta em outra aba', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const get = path => f.request(path,{headers:{Cookie:cookie}});
  const first = await (await get('/api/logs')).json();
  const second = await (await get('/api/logs?requestId=' + f.requestId)).json();
  assert.notEqual(first.view,second.view);
  assert.equal((await get('/api/logs?page=2&view=' + first.view)).status,200);
});

test('falha da fonte retorna 503 sem detalhes internos', async t => {
  const f = await fixture(t);
  await rm(f.file);
  await rm(dirname(f.file),{recursive:true});
  const response = await f.request('/api/status');
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'service_unavailable'});
});

test('modo de implantação configura cookie Secure e bloqueia outras origens', async t => {
  const f = await fixture(t, true);
  const login = await f.login();
  assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/^__Host-monitor=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1800; Secure$/);
  const response = await f.request('/api/status',{headers:{Origin:'https://invalid.example'}});
  assert.equal(response.status,403);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
});

test('arquivos fora da janela técnica não entram na contagem', async t => {
  const f = await fixture(t);
  await writeFile(join(dirname(f.file),'2000-01-01.jsonl'),
    JSON.stringify({...f.row(0),timestamp:'2000-01-01T00:00:00.000Z'}) + '\n');
  const status = await f.request('/api/status');
  assert.deepEqual(await status.json(),{state:'available',events:26,errors:0});
});

test('valida preflight, formato do login e páginas sem uma visão válida', async t => {
  const f = await fixture(t);
  const preflight = await f.request('/api/session', {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal((await f.request('/api/session', { method: 'OPTIONS' })).status, 403);
  assert.equal((await f.request('/api/session', {
    method: 'POST', headers: { Origin: origin }, body: 'not-json'
  })).status, 400);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const get = path => f.request(path, { headers: { Cookie: cookie } });
  assert.equal((await get('/api/logs?page=0')).status, 400);
  assert.equal((await get('/api/logs?page=2')).status, 409);
});

test('rejeita campos inválidos sem descartar evento válido de rota desconhecida', async t => {
  const f = await fixture(t);
  const base = f.row(1);
  const rows = [
    null, { ...base, timestamp: 1 }, { ...base, timestamp: 'invalid' },
    { ...base, timestamp: '2000-01-01T00:00:00.000Z' }, { ...base, method: 'UNKNOWN' },
    { ...base, status: 200.5 }, { ...base, status: 99 }, { ...base, status: 600 },
    { ...base, operation: 'unknown', requestId: 'invalid', durationMs: 0, status: 503 },
  ];
  await writeFile(f.file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const status = await (await f.request('/api/status')).json();
  assert.equal(status.events, 1);
  assert.equal(status.errors, 1);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const result = await (await f.request('/api/logs', { headers: { Cookie: cookie } })).json();
  assert.equal(result.malformed, 8);
  assert.equal(result.items[0].requestId, null);
  assert.equal(result.items[0].log.operation, 'uncatalogued');
  assert.equal(result.items[0].log.durationMs, 0);
});
