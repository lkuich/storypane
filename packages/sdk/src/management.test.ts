import { describe, expect, it, vi } from 'vitest';
import { createManagementClient, ManagementError } from './management.js';

const options = { url: 'https://cms.test', spaceId: 'space', token: 'secret' };

describe('management client', () => {
  it('uses a dedicated versioned endpoint, bearer auth, and no redirects or browser credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ items: [], nextOffset: null, total: 0 }),
    );
    const client = createManagementClient({ ...options, fetch: fetcher });
    await client.stories.list({ offset: 100, limit: 20 });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://cms.test/api/management/v1/spaces/space/stories?offset=100&limit=20',
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    );
  });
  it('rejects insecure destinations and paths that could leak credentials', async () => {
    expect(() => createManagementClient({ ...options, url: 'http://cms.test' })).toThrow('HTTPS');
    const fetcher = vi.fn();
    const client = createManagementClient({ ...options, fetch: fetcher });
    for (const path of [
      'https://evil.test',
      '//evil.test',
      '/../other/stories',
      '/%2e%2e/other',
      '/stories\\evil',
      '/stories%2fsecret',
      '/stories#secret',
    ]) {
      await expect(client.request(path)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves structured conflicts and never retries a write automatically', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: 'stale_revision', message: 'Refresh first', details: { revision: 4 } } },
        { status: 409 },
      ),
    );
    const client = createManagementClient({ ...options, fetch: fetcher });
    await expect(
      client.content.saveBlock('story', 'locale', 'block', {
        fields: { title: 'Hello' },
        mutationId: 'mutation',
        expectedRevision: 3,
        migrationVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'stale_revision', details: { revision: 4 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      type: 'saveBlock',
      mutationId: 'mutation',
      migrationVersion: 2,
      expectedRevisions: { block: 3 },
      payload: { blockId: 'block', fields: { title: 'Hello' } },
    });
  });
  it('uploads exact binary parts and completes only after all succeed', async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith('/uploads')) {
        return Response.json({ id: 'upload', partBytes: 3 });
      }
      if (init?.body instanceof Blob) {
        bodies.push(await init.body.text());
        expect(new Headers(init.headers).get('Content-Length')).toBe(String(init.body.size));
        return Response.json({ partNumber: bodies.length });
      }
      expect(String(url)).toMatch(/\/upload\/complete$/);
      return Response.json({ asset: { id: 'asset' } });
    });
    const result = await createManagementClient({ ...options, fetch: fetcher }).assets.upload(
      new Blob(['abcdefg'], { type: 'text/plain' }),
      'file.txt',
    );
    expect(bodies).toEqual(['abc', 'def', 'g']);
    expect(result.asset.id).toBe('asset');
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('reports the upload ID on interruption without completing or discarding data', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'upload', partBytes: 3 }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'unavailable', message: 'Try later' } }, { status: 503 }),
      );
    await expect(
      createManagementClient({ ...options, fetch: fetcher }).assets.upload(
        new Blob(['abc']),
        'file',
      ),
    ).rejects.toMatchObject({ uploadId: 'upload', status: 503, code: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new ManagementError('failure', 403, 'forbidden')).toBeInstanceOf(Error);
  });
});

it('sends production credentials only to the configured migration boundary', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
  const client = createManagementClient({
    ...options,
    productionToken: 'production-secret',
    fetch: fetcher,
  });
  await client.request('/migrations/environment');
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-storypane-production-token')).toBe(
    'production-secret',
  );
  await client.request('/stories');
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).has('x-storypane-production-token')).toBe(
    false,
  );
});
