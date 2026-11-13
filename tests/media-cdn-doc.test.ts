import { describe, it, expect } from 'vitest';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const guide = await readFile(new URL('../docs/media-cdn.md', import.meta.url), 'utf8');
const source = guide.match(/```js\n([\s\S]*?)\n```/)![1];
const { exportPublishedImage } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

describe('documented published-image export', () => {
  it('preserves originals, versions changed bytes, and keeps IDs and credentials out of public paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storypane-cdn-doc-'));
    try {
      let bytes = 'first original';
      const client = {
        getAsset: async () => new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } }),
      };
      const first = await exportPublishedImage(client, 'published-asset', directory);
      expect(first).toMatch(/^\/storypane-media\/[a-f0-9]{64}\.jpg$/);
      expect(await readFile(join(directory, first.split('/').at(-1)!), 'utf8')).toBe(bytes);
      expect(await exportPublishedImage(client, 'same-bytes', directory)).toBe(first);
      bytes = 'changed original';
      expect(await exportPublishedImage(client, 'published-asset', directory)).not.toBe(first);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not write rejected or unavailable media to the public directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storypane-cdn-doc-'));
    try {
      await expect(
        exportPublishedImage(
          {
            getAsset: async () => {
              throw new Error('Not published');
            },
          },
          'draft',
          directory,
        ),
      ).rejects.toThrow('Not published');
      await expect(
        exportPublishedImage(
          {
            getAsset: async () =>
              new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
          },
          'svg',
          directory,
        ),
      ).rejects.toThrow('supported raster');
      await expect(
        exportPublishedImage(
          { getAsset: async () => new Response('error', { status: 503 }) },
          'unavailable',
          directory,
        ),
      ).rejects.toThrow('503');
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it('documents bounded responsive variants without CMS credentials or arbitrary source hosts', () => {
  const html = guide.match(/```html\n([\s\S]*?)\n```/)![1];
  const urls = [...html.matchAll(/https:\/\/images\.example\.com\/[^\s"]+/g)].map(
    ([value]) => new URL(value),
  );
  expect(urls).toHaveLength(4);
  expect(urls.every((url) => !url.search && !url.username && !url.password)).toBe(true);
  expect(
    urls.every((url) =>
      /^\/cdn-cgi\/image\/width=(320|640|1280),quality=80,format=auto,fit=scale-down\/storypane-media\/CONTENT_HASH\.jpg$/.test(
        url.pathname,
      ),
    ),
  ).toBe(true);
  expect(html).not.toMatch(/STORYPANE_.*TOKEN|Bearer|api\/cms|api\/preview/);
});
