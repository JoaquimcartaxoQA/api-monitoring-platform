// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';

class Stream extends EventTarget {
  static active: Stream;
  constructor() { super(); Stream.active = this; }
  close() {}
}

Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  } },
});

const id = 'f07b6f3f-679d-4e84-a3c4-0f4c92f7aa01';
const stamp = '2026-11-12T12:00:00.000Z';
const item = { timestamp: stamp, method: 'GET', endpoint: '/health', status: 503, requestId: id, durationMs: 8,
  log: { timestamp: stamp, operation: 'demo.health', method: 'GET', status: 503, requestId: id, durationMs: 8 } };
const json = (body: unknown, status = 200) => Response.json(body, { status });
const okStatus = (state = 'empty') => json({ state, events: 0, errors: 0 });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const logs = (page = 1, items: unknown[] = []) => json({ page, view: 'snapshot', totalPages: 2, total: 2, malformed: page === 1 ? 1 : 0, items });

function mount(reply: (url: URL, init: RequestInit) => Response) {
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => reply(new URL(path, 'http://monitor.test'), init)));
  render(<App />);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([[401, /senha inválidos/], [429, /Muitas tentativas/], [503, /Não foi possível entrar/]] as const)(
  'mantém o login disponível ao receber HTTP %s', async (code, message) => {
    mount((url, init) => url.pathname.endsWith('/status') ? okStatus()
      : init.method === 'POST' ? json({}, code) : json({ authenticated: false }));
    fireEvent.change(await screen.findByLabelText('Usuário'), { target: { value: 'qa' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'synthetic' } });
    click('Entrar');
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(screen.getByRole('heading', { name: 'Acesso aos logs' })).toBeTruthy();
  });

it('distingue indisponibilidade da fonte de uma lista sem eventos', async () => {
  mount(() => json({}, 503));
  expect(await screen.findByText('Indisponível')).toBeTruthy();
  expect(await screen.findByLabelText('Usuário')).toBeTruthy();
});

it('preserva a visão na paginação e retorna à primeira página ao receber evento', async () => {
  let changed = false;
  mount((url, init) => {
    if (url.pathname.endsWith('/status')) return okStatus(changed ? 'degraded' : 'available');
    if (url.pathname.endsWith('/session')) return json({ authenticated: init.method === 'POST' });
    if (url.pathname.endsWith('/logout')) return json({});
    const page = Number(url.searchParams.get('page'));
    if (page === 2 && url.searchParams.get('view') !== 'snapshot') return json({}, 409);
    return logs(page, url.searchParams.has('requestId') ? [] : [page === 1 ? item : { ...item, requestId: null, durationMs: null, status: 200 }]);
  });
  fireEvent.change(await screen.findByLabelText('Usuário'), { target: { value: 'qa' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'synthetic' } });
  click('Entrar');
  await screen.findByText(/Página 1 de 2/);
  click('Próxima');
  await screen.findByText(/Página 2 de 2/);
  click('Ver evento 1');
  expect(await screen.findByText('Não registrada')).toBeTruthy();
  click('Fechar');
  click('Anterior');
  await screen.findByText(/Página 1 de 2/);
  click('Ver evento 1');
  expect(await screen.findByText('8 ms')).toBeTruthy();
  click('Correlacionar eventos');
  await screen.findByText('Nenhum evento encontrado.');
  expect((screen.getByLabelText('Request ID') as HTMLInputElement).value).toBe(id);
  click('Limpar');
  await screen.findByRole('button', { name: 'Ver evento 1' });
  fireEvent.change(screen.getByLabelText('Request ID'), { target: { value: ' ' + id } });
  click('Buscar');
  await screen.findByText('Nenhum evento encontrado.');
  click('Limpar');
  await screen.findByRole('button', { name: 'Ver evento 1' });
  click('Próxima');
  await screen.findByText(/Página 2 de 2/);
  changed = true;
  act(() => Stream.active.dispatchEvent(new Event('logs_changed')));
  await screen.findByText(/Página 1 de 2/);
  await screen.findByText('Dados inválidos');
  click('Sair');
  await screen.findByLabelText('Usuário');
});

it.each([[400, /UUID v4/], [409, /consulta expirou/], [503, /Falha ao consultar/]] as const)(
  'permite recuperar a consulta após HTTP %s', async (code, message) => {
    let recovered = false;
    mount(url => url.pathname.endsWith('/status') ? okStatus()
      : url.pathname.endsWith('/session') ? json({ authenticated: true })
      : recovered ? logs() : json({}, code));
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    recovered = true;
    click('Atualizar');
    await screen.findByText('Nenhum evento encontrado.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

it.each([401, 503])('trata falha HTTP %s ao encerrar sessão', async code => {
  mount(url => url.pathname.endsWith('/status') ? okStatus()
    : url.pathname.endsWith('/session') ? json({ authenticated: true })
    : url.pathname.endsWith('/logout') ? json({}, code) : logs());
  await screen.findByText('Nenhum evento encontrado.');
  click('Sair');
  if (code === 401) await screen.findByLabelText('Usuário');
  else expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível encerrar/);
});

it('retorna ao login quando a sessão da consulta expira', async () => {
  mount(url => url.pathname.endsWith('/status') ? okStatus()
    : url.pathname.endsWith('/session') ? json({ authenticated: true }) : json({}, 401));
  await screen.findByLabelText('Usuário');
});
