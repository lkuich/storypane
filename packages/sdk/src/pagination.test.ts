import { expect, expectTypeOf, it, vi } from 'vitest';
import { createStorypaneClient } from './index.js';

it('collects all pages in the requested locale with typed content and caller fetch options', async () => {
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    return Response.json({
      stories: [{ content: { title: url.searchParams.get('offset')! } }],
      nextOffset: url.searchParams.get('offset') === '0' ? 100 : null,
    });
  });
  const client = createStorypaneClient<{ title: string }>({
    url: 'https://cms.test',
    spaceId: 'space',
    token: 'key',
    fetch,
  });
  const stories = await client.listAllStories({ locale: 'fr' }, { cache: 'no-store' });
  expectTypeOf(stories[0]!.content.title).toEqualTypeOf<string>();
  expect(stories.map((story) => story.content.title)).toEqual(['0', '100']);
  expect(
    fetch.mock.calls.map(([url]) => Object.fromEntries(new URL(String(url)).searchParams)),
  ).toEqual([
    { space: 'space', locale: 'fr', limit: '100', offset: '0' },
    { space: 'space', locale: 'fr', limit: '100', offset: '100' },
  ]);
  for (const call of fetch.mock.calls)
    expect(call).toEqual([
      expect.any(URL),
      expect.objectContaining({ cache: 'no-store', headers: { Authorization: 'Bearer key' } }),
    ]);
  expectTypeOf((await client.getStory({ slug: 'home' })).content.title).toEqualTypeOf<string>();
});

it('handles empty locales, pagination loops, and failed pages without returning partial content', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ stories: [], nextOffset: null }))
    .mockResolvedValueOnce(Response.json({ stories: [], nextOffset: 0 }))
    .mockResolvedValueOnce(Response.json({ stories: [{ id: 'first' }], nextOffset: 100 }))
    .mockResolvedValueOnce(new Response('<h1>Unavailable</h1>', { status: 503 }));
  const client = createStorypaneClient({
    url: 'https://cms.test',
    spaceId: 'space',
    token: 'key',
    fetch,
  });
  expect(await client.listAllStories()).toEqual([]);
  expect(fetch.mock.calls[0]![0].searchParams.has('locale')).toBe(false);
  await expect(client.listAllStories()).rejects.toThrow('Invalid story pagination');
  await expect(client.listAllStories()).rejects.toMatchObject({
    name: 'StorypaneError',
    status: 503,
  });
});
