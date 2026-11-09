import { beforeEach, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  selectSpace: vi.fn(),
  close: vi.fn(),
  handlePublicMedia: vi.fn(),
  handleAssets: vi.fn(),
}));
vi.mock('#platform', () => ({ env: { MEDIA: {}, IMAGES: {} }, openCache: vi.fn() }));
vi.mock('@storypane/assets', () => ({ ...mocks, copySchemaAsset: vi.fn() }));
vi.mock('./context', () => ({
  authenticate: mocks.authenticate,
  requestedSpace: (request: Request) => new URL(request.url).searchParams.get('space'),
  createServices: () => ({ ...mocks, db: {}, store: {} }),
}));
const { GET, HEAD, POST } = await import('../app/api/cms/[...path]/route');
const space = '11111111-1111-4111-8111-111111111111';
const asset = '22222222-2222-4222-8222-222222222222';
const route = (path = ['assets', asset, 'content']) => ({ params: Promise.resolve({ path }) });
const request = (method = 'GET', path = `assets/${asset}/content`, headers = {}) =>
  new Request(`https://cms.test/api/cms/${path}?space=${space}`, { method, headers });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockRejectedValue(new StorypaneError('unauthenticated', 'Sign in'));
  mocks.handlePublicMedia.mockResolvedValue(
    new Response('image', {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    }),
  );
});
it('serves already-public preview images without third-party cookies through public eligibility checks', async () => {
  const response = await GET(request('GET', undefined, { range: 'bytes=0-4' }), route());
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('image');
  expect(mocks.selectSpace).toHaveBeenCalledWith(space);
  const [forwarded, params] = mocks.handlePublicMedia.mock.calls[0];
  expect(forwarded.url).toBe(`https://cms.test/media/${space}/${asset}/original`);
  expect(forwarded.headers.get('range')).toBe('bytes=0-4');
  expect(params).toEqual({ spaceId: space, assetId: asset, kind: 'original' });
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('keeps disabled-public-media, unpublished, and wrong-space assets behind session authentication', async () => {
  mocks.handlePublicMedia.mockResolvedValue(new Response(null, { status: 404 }));
  expect((await GET(request(), route())).status).toBe(401);
  expect(mocks.handleAssets).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('does not use public fallback for writes, listings, thumbnails, bearer auth, or permission failures', async () => {
  expect((await POST(request('POST'), route())).status).toBe(401);
  expect((await GET(request('GET', 'assets'), route(['assets']))).status).toBe(401);
  expect(
    (await GET(request('GET', `assets/${asset}/thumbnail`), route(['assets', asset, 'thumbnail'])))
      .status,
  ).toBe(401);
  expect(
    (await GET(request('GET', undefined, { authorization: 'Bearer invalid' }), route())).status,
  ).toBe(401);
  mocks.authenticate.mockRejectedValue(new StorypaneError('forbidden', 'No access'));
  expect((await GET(request(), route())).status).toBe(403);
  expect(mocks.handlePublicMedia).not.toHaveBeenCalled();
});
it('preserves authenticated private media access and HEAD requests', async () => {
  mocks.handlePublicMedia.mockResolvedValueOnce(new Response(null));
  expect((await HEAD(request('HEAD'), route())).status).toBe(200);
  expect(mocks.handlePublicMedia.mock.calls[0][0].method).toBe('HEAD');
  mocks.authenticate.mockResolvedValue({ actor: {} });
  mocks.handleAssets.mockResolvedValue(new Response('private-image'));
  expect(await (await GET(request(), route())).text()).toBe('private-image');
  expect(mocks.handlePublicMedia).toHaveBeenCalledTimes(1);
  expect(mocks.handleAssets).toHaveBeenCalledOnce();
});
