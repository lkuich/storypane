import { beforeEach, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), remove: vi.fn(), close: vi.fn() }));
vi.mock('#platform', () => ({ env: { APP_URL: 'https://cms.test' } }));
vi.mock('./context', () => ({
  authenticateSession: mocks.authenticate,
  createServices: () => ({ installation: { deleteSpace: mocks.remove }, close: mocks.close }),
}));
const { DELETE } = await import('../app/api/spaces/route');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ user: { id: 'admin' }, session: { id: 'session' } });
});
const input = { id: '11111111-1111-4111-8111-111111111111', name: 'Space', deleteDatabase: true };
const request = (origin?: string) =>
  new Request('https://cms.test/api/spaces', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(input),
  });
it('rejects cross-origin deletion without invoking the database operation', async () => {
  for (const origin of [undefined, 'https://foreign.test'])
    expect((await DELETE(request(origin))).status).toBe(403);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('requires a session and installation administrator and always closes services', async () => {
  mocks.authenticate.mockRejectedValueOnce(new StorypaneError('unauthenticated', 'Expired'));
  expect((await DELETE(request('https://cms.test'))).status).toBe(401);
  expect(mocks.remove).not.toHaveBeenCalled();
  mocks.remove.mockRejectedValueOnce(new StorypaneError('forbidden', 'Admin required'));
  expect((await DELETE(request('https://cms.test'))).status).toBe(403);
  expect(mocks.close).toHaveBeenCalledTimes(2);
});
it('forwards the confirmed choice for the authenticated administrator', async () => {
  const result = await DELETE(request('https://cms.test'));
  expect(result.status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith('admin', input);
  expect(result.headers.get('cache-control')).toBe('no-store');
});
