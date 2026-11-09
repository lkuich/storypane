import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';
import { createStorypaneClient } from '../../../../packages/sdk/src/index';

const mocks = vi.hoisted(() => ({
  rooms: { ready: true },
  selectSpace: vi.fn(),
  close: vi.fn(),
  publishedStories: vi.fn(),
  deliveryLocales: vi.fn(),
  authorizePublishedAsset: vi.fn(),
  assertProvider: vi.fn(),
  forEachSpace: vi.fn(),
  handleAssets: vi.fn(),
  handlePublicMedia: vi.fn(),
}));
vi.mock('#platform', () => ({
  env: { MEDIA: {}, IMAGES: {}, ROOMS: mocks.rooms },
  openCache: vi.fn(),
}));
vi.mock('@storypane/assets', () => ({
  handleAssets: mocks.handleAssets,
  handlePublicMedia: mocks.handlePublicMedia,
}));
vi.mock('./context', () => ({
  createServices: () => ({
    selectSpace: mocks.selectSpace,
    close: mocks.close,
    db: {},
    store: mocks,
    installation: mocks,
  }),
}));
const { createDeliveryServer } = await import('../delivery-server');
const server = createDeliveryServer();
const spaceId = crypto.randomUUID();
const assetId = crypto.randomUUID();
let origin: string;
beforeAll(async () => {
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rooms.ready = true;
  mocks.publishedStories.mockResolvedValue({ stories: [], nextOffset: null });
  mocks.deliveryLocales.mockResolvedValue([{ slug: '', isDefault: true }]);
  mocks.forEachSpace.mockResolvedValue([]);
});

it('serves existing SDK reads with credentials, space selection and publication queries intact', async () => {
  const client = createStorypaneClient({ url: origin, spaceId, token: 'published-token' });
  expect(await client.listStories({ locale: 'fr', limit: 10 })).toEqual({
    stories: [],
    nextOffset: null,
  });
  expect(mocks.publishedStories).toHaveBeenCalledWith('published-token', spaceId, {
    locale: 'fr',
    offset: 0,
    limit: 10,
  });
  expect(await client.listLocales()).toEqual([{ slug: '', isDefault: true }]);
  expect(mocks.deliveryLocales).toHaveBeenCalledWith('published-token', spaceId);
  expect(mocks.selectSpace).toHaveBeenCalledWith(spaceId);
  expect(mocks.close).toHaveBeenCalledTimes(2);
});

it('retains CORS preflight and supports HEAD without returning a body', async () => {
  const url = `${origin}/api/delivery/stories?space=${spaceId}`;
  const preflight = await fetch(url, { method: 'OPTIONS' });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
  expect(mocks.selectSpace).not.toHaveBeenCalled();
  const head = await fetch(url, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(mocks.publishedStories).toHaveBeenCalledOnce();
});

it.each([401, 403])(
  'preserves a %i authorization failure and releases the database',
  async (status) => {
    mocks.publishedStories.mockRejectedValue(
      new StorypaneError(status === 401 ? 'unauthenticated' : 'forbidden', 'Access denied'),
    );
    const response = await fetch(`${origin}/api/delivery/stories?space=${spaceId}`);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(mocks.close).toHaveBeenCalledOnce();
  },
);

it('authorizes published assets before streaming ranges and preserves HEAD', async () => {
  const client = createStorypaneClient({ url: origin, spaceId, token: 'published-token' });
  mocks.authorizePublishedAsset.mockRejectedValueOnce(
    new StorypaneError('forbidden', 'Unpublished asset'),
  );
  await expect(client.getAsset(assetId)).rejects.toMatchObject({ status: 403 });
  expect(mocks.handleAssets).not.toHaveBeenCalled();
  mocks.handleAssets.mockImplementation(async (request: Request) => {
    expect(request.headers.get('range')).toBe('bytes=2-4');
    return new Response(request.method === 'HEAD' ? null : new Uint8Array([2, 3, 4]), {
      status: 206,
      headers: { 'Content-Range': 'bytes 2-4/10', 'Content-Type': 'application/octet-stream' },
    });
  });
  const response = await client.getAsset(assetId, { headers: { Range: 'bytes=2-4' } });
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]));
  const head = await client.getAsset(assetId, { method: 'HEAD', headers: { Range: 'bytes=2-4' } });
  expect(head.status).toBe(206);
  expect(await head.text()).toBe('');
  expect(mocks.authorizePublishedAsset).toHaveBeenCalledWith('published-token', spaceId, assetId);
  expect(mocks.close).toHaveBeenCalledTimes(3);
});

it('uses the existing public-media policy and image handler', async () => {
  mocks.handlePublicMedia.mockResolvedValue(new Response(null, { status: 404 }));
  const path = `/media/${spaceId}/${assetId}/image?width=320`;
  expect((await fetch(origin + path)).status).toBe(404);
  expect(mocks.handlePublicMedia).toHaveBeenCalledWith(
    expect.any(Request),
    { spaceId, assetId, kind: 'image' },
    expect.objectContaining({ db: {} }),
  );
  const [request] = mocks.handlePublicMedia.mock.calls[0];
  expect(request.url).toBe(origin + path);
  expect(mocks.close).toHaveBeenCalledOnce();
});

it.each([
  '/',
  '/api/session',
  '/api/cms/stories',
  '/api/management/v1/stories',
  '/api/delivery/preview',
  '/api/delivery/schema',
  '/api/preview/live',
])('does not expose editor or preview route %s', async (path) => {
  expect((await fetch(origin + path)).status).toBe(404);
  expect(mocks.selectSpace).not.toHaveBeenCalled();
  expect(mocks.assertProvider).not.toHaveBeenCalled();
});

it('rejects writes before acquiring a database', async () => {
  const response = await fetch(`${origin}/api/delivery/stories?space=${spaceId}`, {
    method: 'POST',
  });
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  expect(mocks.selectSpace).not.toHaveBeenCalled();
});

it('serves health checks and reports an installation outage', async () => {
  expect(await (await fetch(`${origin}/api/ready`)).json()).toEqual({ ready: true });
  mocks.assertProvider.mockRejectedValueOnce(new Error('Database unavailable'));
  expect((await fetch(`${origin}/api/ready`)).status).toBe(503);
});

it('reports an interrupted room listener as unready before accepting new editor traffic', async () => {
  mocks.rooms.ready = false;
  expect((await fetch(`${origin}/api/ready`)).status).toBe(503);
  expect(mocks.assertProvider).not.toHaveBeenCalled();
});

it('rejects WebSocket upgrades rather than opening a local room', async () => {
  const response = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(`${origin}/api/preview/live`, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
    });
    request.on('response', (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      reject(new Error('Unexpected upgrade'));
    });
    request.on('error', reject);
    request.end();
  });
  expect(response).toBe(404);
  expect(mocks.selectSpace).not.toHaveBeenCalled();
});
