import { afterEach, expect, it, vi } from 'vitest';
import { api, post } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

it('envia login em JSON e inclui a sessão nas requisições', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ authenticated: true }));
  vi.stubGlobal('fetch', fetch);

  await expect(post('/session', { user: 'qa' })).resolves.toEqual({ authenticated: true });
  expect(fetch).toHaveBeenCalledWith('/api/session', {
    credentials: 'include', cache: 'no-store', method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'qa' }),
  });
});

it('propaga o status HTTP quando a sessão é recusada', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  await expect(api('/logs')).rejects.toMatchObject({ status: 401 });
});
