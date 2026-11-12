import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { watch } from 'node:fs';
import { readLogs, isRequestId } from './logs.mjs';

const derive = promisify(scrypt);
const ttl = 30 * 60_000;
const pageSize = 25;
const validHash = /^[0-9a-f]{32}:[0-9a-f]{128}$/;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return salt + ':' + key.toString('hex');
}
async function passwordMatches(password, hash) {
  const [salt, digest] = hash.split(':');
  return timingSafeEqual(await derive(password, salt, 64), Buffer.from(digest, 'hex'));
}

async function credentials(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return null;
  let text = '';
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    text += chunk.toString('utf8');
    if (Buffer.byteLength(text) > 2048) return null;
  }
  try {
    const data = JSON.parse(text);
    return typeof data?.user === 'string' && typeof data.password === 'string' &&
      data.password.length <= 256 && data.user.length <= 100 ? data : null;
  } catch { return null; }
}

export function createMonitor({root, operations, origins, user, passwordHash, audit, secure = true}) {
  if (!root || !user || !validHash.test(passwordHash) || !origins.length) throw new Error('invalid_configuration');
  const sessions = new Map();
  const cookieName = secure ? '__Host-monitor' : 'monitor_dev';
  const cookie = (token, age) => cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
    age + (secure ? '; Secure' : '');
  let reading;
  let cache;
  let windowEnd = 0;
  let loginAttempts = 0;
  const streams = new Set();

  function notifyLogChange() {
    cache = undefined;
    for (const stream of streams) stream.write('event: logs_changed\ndata: {}\n\n');
  }
  let watcher;
  try {
    watcher = watch(root, {persistent:false}, (_eventType, filename) => {
      if (typeof filename === 'string' && /^\d{4}-\d\d-\d\d\.jsonl$/.test(filename)) notifyLogChange();
    });
  } catch { /* a rota de status informará indisponibilidade da fonte */ }

  function loadLogs() {
    if (cache?.until > Date.now()) return Promise.resolve(cache.value);
    reading ??= readLogs(root, operations).then(value => {
      cache = {value, until:Date.now() + 2000};
      return value;
    }).finally(() => { reading = undefined; });
    return reading;
  }

  const server = createServer({requestTimeout:10_000, headersTimeout:5000}, async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    };
    const fail = (code, error) => send(code, {error});
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Vary','Origin');
    const origin = req.headers.origin;
    const trusted = origins.includes(origin);
    if (trusted) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials','true');
    }
    try {
      const url = new URL(req.url, 'http://monitor.local');
      const path = url.pathname;
      if (!['/api/status','/api/session','/api/logs','/api/events','/api/logout'].includes(path)) return fail(404,'not_found');
      if (origin && !trusted) return fail(403,'origin_denied');
      if (req.method === 'OPTIONS') {
        if (!trusted) return fail(403,'origin_denied');
        res.writeHead(204, {'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':'Content-Type'}).end();
        return;
      }
      const methods = path === '/api/session' ? ['GET','POST'] : path === '/api/logout' ? ['POST'] : ['GET'];
      if (!methods.includes(req.method)) {
        res.setHeader('Allow',methods.join(', '));
        return fail(405,'method_not_allowed');
      }
      if (req.method === 'POST' && !trusted) return fail(403,'origin_denied');

      if (path === '/api/status') {
        const {items, malformed} = await loadLogs();
        return send(200, {state: malformed ? (items.length ? 'available' : 'degraded') :
          (items.length ? 'available' : 'empty'),
          events:items.length, errors:items.filter(row => row.status >= 500).length});
      }

      const now = Date.now();
      for (const [key, session] of sessions) if (session.until <= now) sessions.delete(key);
      const token = (req.headers.cookie ?? '').split(';').map(part => part.trim())
        .find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      const session = sessions.get(token);

      if (path === '/api/session' && req.method === 'POST') {
        if (now >= windowEnd) {
          windowEnd = now + 60_000;
          loginAttempts = 0;
        }
        if (++loginAttempts > 10) return fail(429,'try_later');
        const data = await credentials(req);
        if (!data) return fail(400,'invalid_input');
        const valid = await passwordMatches(data.password, passwordHash);
        if (!valid || data.user !== user) {
          await audit('login_failure');
          return fail(401,'invalid_credentials');
        }
        await audit('login_success');
        if (session) sessions.delete(token);
        if (sessions.size >= 8) sessions.delete(sessions.keys().next().value);
        const key = randomBytes(32).toString('hex');
        sessions.set(key, {until:now + ttl, views:new Map()});
        res.setHeader('Set-Cookie',cookie(key, ttl / 1000));
        return send(200,{authenticated:true});
      }
      if (path === '/api/session') return send(200,{authenticated:!!session});
      if (!session) return fail(401,'authentication_required');
      if (path === '/api/events') {
        res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8', 'Connection':'keep-alive',
          'X-Accel-Buffering':'no'});
        res.write('event: ready\ndata: {}\n\n');
        streams.add(res);
        req.on('close', () => streams.delete(res));
        return;
      }
      if (path === '/api/logout') {
        sessions.delete(token);
        res.setHeader('Set-Cookie',cookie('',0));
        await audit('logout');
        return send(200,{authenticated:false});
      }

      const rawId = url.searchParams.get('requestId');
      const filter = rawId?.toLowerCase() ?? null;
      const rawPage = url.searchParams.get('page') ?? '1';
      if ((filter !== null && !isRequestId(filter)) || !/^[1-9]\d{0,3}$/.test(rawPage)) {
        return fail(400,'invalid_input');
      }
      const page = Number(rawPage);
      const viewId = url.searchParams.get('view');
      let view = session.views.get(viewId);
      if (!viewId && page === 1) {
        const {items, malformed} = await loadLogs();
        const endOfDay = (Math.floor(now / 86_400_000) + 1) * 86_400_000;
        view = {id:randomUUID(), filter, items:filter ? items.filter(row => row.requestId === filter) : items,
          malformed, until:Math.min(endOfDay, now + 5 * 60_000)};
        if (session.views.size >= 8) session.views.delete(session.views.keys().next().value);
        session.views.set(view.id, view);
      }
      if (!view || view.filter !== filter || view.until <= now) return fail(409,'view_expired');
      const totalPages = Math.max(1, Math.ceil(view.items.length / pageSize));
      if (page > totalPages) return fail(400,'invalid_page');
      return send(200,{items:view.items.slice((page - 1) * pageSize, page * pageSize), page, totalPages,
        total:view.items.length, view:view.id, malformed:view.malformed});
    } catch {
      if (!res.headersSent) fail(503,'service_unavailable');
      else res.end();
    }
  });
  server.on('close', () => {
    watcher?.close();
    for (const stream of streams) stream.end();
    streams.clear();
  });
  return server;
}

