import { beforeEach, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), pageMap: vi.fn(), close: vi.fn() }));
vi.mock('#platform', () => ({ env: {}, openCache: vi.fn() }));
vi.mock('./context', () => ({
  authenticate: mocks.authenticate,
  requestedSpace: vi.fn(),
  createServices: () => ({ store: { pageMap: mocks.pageMap }, close: mocks.close }),
}));
const { GET } = await import('../app/api/cms/[...path]/route');
const root = '20000000-0000-4000-8000-000000000001';
const actor = { userId: 'editor', sessionId: 'session', spaceId: root, role: 'editor' };
const graph = { nodes: [], edges: [], truncated: false, limits: { nodes: 100, edges: 500 } };
const params = (path = ['page-map']) => ({ params: Promise.resolve({ path }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ actor });
  mocks.pageMap.mockResolvedValue(graph);
});
it('passes only graph filters to the authenticated store and closes the connection', async () => {
  const response = await GET(
    new Request(`https://cms.test/api/cms/page-map?space=${root}&root=${root}&references=true`),
    params(),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(graph);
  expect(mocks.pageMap).toHaveBeenCalledWith(actor, { root, references: 'true' });
  expect(mocks.close).toHaveBeenCalledOnce();
});
it.each(['pages', 'orphans'])('no longer serves the %s endpoint', async (name) => {
  const response = await GET(
    new Request(`https://cms.test/api/cms/page-map/${name}`),
    params(['page-map', name]),
  );
  expect(response.status).toBe(404);
  expect(mocks.pageMap).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('does not query the graph before authentication', async () => {
  mocks.authenticate.mockRejectedValue(new StorypaneError('unauthenticated', 'Sign in'));
  const response = await GET(new Request('https://cms.test/api/cms/page-map'), params());
  expect(response.status).toBe(401);
  expect(mocks.pageMap).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
