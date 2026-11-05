import { describe, expect, it, vi } from 'vitest';
import { managementRequest } from './management-api';

const spaceId = 'a53358b5-83f1-49bb-9921-97070a18842b';
const path = ['spaces', spaceId, 'stories'];
const authorization = `Bearer sm_${'a'.repeat(43)}`;
const request = (query = '') =>
  new Request(`https://cms.test/api/management/v1/spaces/${spaceId}/stories${query}`, {
    headers: { authorization, cookie: 'session=browser', 'x-storypane-space-id': 'wrong-space' },
  });

describe('management HTTP boundary', () => {
  it('requires a bearer token even when a browser session is present', async () => {
    const handle = vi.fn();
    const response = await managementRequest(
      new Request('https://cms.test', { headers: { cookie: 'session=browser' } }),
      path,
      handle,
    );
    expect(response.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
  it('pins the space to the URL, removes cookies, and pages authorized lists', async () => {
    const handle = vi.fn(async (req: Request, route: { params: Promise<{ path: string[] }> }) => {
      expect(req.headers.get('cookie')).toBeNull();
      expect(req.headers.get('authorization')).toBe(authorization);
      expect(req.headers.get('x-storypane-space-id')).toBe(spaceId);
      expect(await route.params).toEqual({ path: ['stories'] });
      return Response.json(['one', 'two', 'three']);
    });
    const response = await managementRequest(request('?offset=1&limit=1'), path, handle);
    expect(await response.json()).toEqual({ items: ['two'], total: 3, nextOffset: 2 });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['?limit=0', '?limit=1001', '?offset=-1', '?offset=1.5', '?limit=NaN'])(
    'rejects invalid pagination %s',
    async (query) => {
      const handle = vi.fn();
      expect((await managementRequest(request(query), path, handle)).status).toBe(400);
      expect(handle).not.toHaveBeenCalled();
    },
  );
  it('does not expose session routes or repaginate cursor responses', async () => {
    const handle = vi.fn(async () => Response.json({ items: [1], nextCursor: 'next' }));
    expect(
      (await managementRequest(request(), ['spaces', spaceId, 'presence'], handle)).status,
    ).toBe(404);
    const response = await managementRequest(request(), ['spaces', spaceId, 'assets'], handle);
    expect(await response.json()).toEqual({ items: [1], nextCursor: 'next' });
  });
  it('preserves binary bodies and error codes without caching drafts', async () => {
    const response = await managementRequest(
      request(),
      path,
      async () =>
        new Response('binary', {
          headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' },
        }),
    );
    expect(await response.text()).toBe('binary');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const failure = await managementRequest(request(), path, async () =>
      Response.json({ error: { code: 'locked' } }, { status: 423 }),
    );
    expect(failure.status).toBe(423);
    expect(await failure.json()).toEqual({ error: { code: 'locked' } });
  });
});

it('forwards streamed writes from framework request wrappers without native Request identity', async () => {
  const native = new Request('https://cms.test/api/management', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'New story' }),
  });
  const wrapped = {
    url: native.url,
    method: native.method,
    headers: native.headers,
    body: native.body,
  } as Request;
  const response = await managementRequest(wrapped, path, async (forwarded) => {
    expect(forwarded.method).toBe('POST');
    expect(await forwarded.json()).toEqual({ name: 'New story' });
    return Response.json({ id: 'story' }, { status: 201 });
  });
  expect(response.status).toBe(201);
});
