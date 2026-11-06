import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authenticateManagement: vi.fn(),
  assertActor: vi.fn(),
  listStories: vi.fn(),
  assets: vi.fn(),
  end: vi.fn(),
  selectSpace: vi.fn(),
}));
vi.mock('#platform', () => ({ env: {}, openCache: vi.fn() }));
vi.mock('./context', () => ({
  authenticate: mocks.authenticate,
  requestedSpace: (request: Request) => request.headers.get('x-storypane-space-id'),
  createServices: () => ({
    db: { end: mocks.end },
    close: mocks.end,
    selectSpace: mocks.selectSpace,
    store: {
      authenticateManagement: mocks.authenticateManagement,
      assertActor: mocks.assertActor,
      listStories: mocks.listStories,
    },
  }),
}));
vi.mock('@storypane/assets', () => ({ handleAssets: mocks.assets }));
const { GET, POST } = await import('../app/api/management/v1/[...path]/route');
const spaceId = 'a53358b5-83f1-49bb-9921-97070a18842b';
const actor = {
  userId: 'admin',
  sessionId: 'management:token',
  spaceId,
  role: 'admin',
  managementTokenId: 'token',
};
const headers = { authorization: `Bearer sm_${'a'.repeat(43)}` };
const params = (resource: string) => ({
  params: Promise.resolve({ path: ['spaces', spaceId, resource] }),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticateManagement.mockResolvedValue(actor);
  mocks.assertActor.mockResolvedValue(undefined);
  mocks.listStories.mockResolvedValue([{ id: 'story' }]);
  mocks.assets.mockResolvedValue(Response.json({ items: [] }));
});
describe('management route authorization', () => {
  it('authenticates tokens without browser sign-in and closes the database connection', async () => {
    const response = await GET(
      new Request('https://cms.test/api/management', { headers }),
      params('stories'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ id: 'story' }], total: 1, nextOffset: null });
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.selectSpace).toHaveBeenCalledWith(spaceId);
    expect(mocks.authenticateManagement).toHaveBeenCalledWith(
      headers.authorization.slice(7),
      spaceId,
      'stories',
    );
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('checks assets:write before touching storage, including for a token issued by an admin', async () => {
    mocks.assertActor.mockImplementation(async (_actor, permission) => {
      if (permission) {
        throw new StorypaneError('forbidden', 'Read only');
      }
    });
    const response = await POST(
      new Request('https://cms.test/api/management', { method: 'POST', headers }),
      params('assets'),
    );
    expect(response.status).toBe(403);
    expect(mocks.assets).not.toHaveBeenCalled();
    expect(mocks.assertActor).toHaveBeenCalledWith(actor, 'assets:write');
  });
  it('rechecks revocation before reading assets', async () => {
    mocks.assertActor.mockRejectedValue(new StorypaneError('unauthenticated', 'Revoked'));
    expect(
      (await GET(new Request('https://cms.test/api/management', { headers }), params('assets')))
        .status,
    ).toBe(401);
    expect(mocks.assets).not.toHaveBeenCalled();
  });
});
