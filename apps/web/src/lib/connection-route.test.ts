import { beforeEach, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), details: vi.fn(), close: vi.fn() }));
vi.mock('#platform', () => ({ env: { APP_URL: 'https://cms.test' } }));
vi.mock('./context', () => ({
  authenticateSession: mocks.authenticate,
  createServices: () => ({
    installation: { connectionDetails: mocks.details },
    close: mocks.close,
  }),
}));
const { GET, POST } = await import('../app/api/spaces/[spaceId]/connection/route');
const params = { params: Promise.resolve({ spaceId: 'space' }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ user: { id: 'operator' } });
  mocks.details.mockResolvedValue({ status: 'ready', url: 'url' });
});
it('masks GET reads even with a reveal query, and never caches responses', async () => {
  const result = await GET(
    new Request('https://cms.test/api/spaces/space/connection?reveal=true'),
    params,
  );
  expect(mocks.details).toHaveBeenCalledWith('operator', 'space', false);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('requires the editor origin for explicit reveals, with no secret lookup on rejection', async () => {
  for (const origin of [undefined, 'https://foreign.test']) {
    const result = await POST(
      new Request('https://cms.test/api/spaces/space/connection', {
        method: 'POST',
        headers: origin ? { origin } : {},
      }),
      params,
    );
    expect(result.status).toBe(403);
  }
  expect(mocks.details).not.toHaveBeenCalled();
  const result = await POST(
    new Request('https://cms.test/api/spaces/space/connection', {
      method: 'POST',
      headers: { origin: 'https://cms.test' },
    }),
    params,
  );
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(mocks.details).toHaveBeenCalledWith('operator', 'space', true);
});
it('requires a live session and propagates installation-admin denial', async () => {
  mocks.authenticate.mockRejectedValueOnce(new StorypaneError('unauthenticated', 'Expired'));
  const request = new Request('https://cms.test/api/spaces/space/connection', {
    method: 'POST',
    headers: { origin: 'https://cms.test' },
  });
  expect((await POST(request, params)).status).toBe(401);
  expect(mocks.details).not.toHaveBeenCalled();
  mocks.details.mockRejectedValueOnce(
    new StorypaneError('forbidden', 'Installation admin required'),
  );
  expect((await POST(request, params)).status).toBe(403);
});
