import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorypaneClient, isPreviewMode } from './index.js';
import { connectPreview } from './preview.js';

afterEach(() => vi.unstubAllGlobals());
describe('delivery and preview activation', () => {
  it('preserves the difference between the configured default and an explicit root locale', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ stories: [{ id: 'story' }], nextOffset: null }),
    );
    const client = createStorypaneClient({
      url: 'https://cms.test',
      spaceId: 'space',
      token: 'key',
      fetch,
    });
    await client.getStory({ slug: 'home' });
    await client.getStory({ slug: 'home', locale: '' });
    await client.listAllStories();
    await client.listAllStories({ locale: '' });
    expect(
      fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('locale')),
    ).toEqual([null, '', null, '']);
  });
  it('downloads published assets as bytes with server credentials only in the header', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(
        Response.json({ error: { message: 'Published asset not found' } }, { status: 404 }),
      );
    const client = createStorypaneClient({
      url: 'https://cms.test',
      spaceId: 'space',
      token: 'private-key',
      fetch,
    });
    const response = await client.getAsset('image');
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(fetch.mock.calls[0][0].href).toBe(
      'https://cms.test/api/delivery/assets?space=space&id=image',
    );
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer private-key');
    await expect(client.getAsset('draft-only')).rejects.toMatchObject({ status: 404 });
  });
  it('returns migrated content to outdated and unversioned clients with deduplicated warnings', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let version = 3;
      const fetch = vi.fn(async () =>
        Response.json({
          migrationVersion: version,
          stories: [
            { id: 'story', migrationVersion: version, content: { headline: 'New schema' } },
          ],
          nextOffset: null,
        }),
      );
      const client = createStorypaneClient({
        url: 'https://cms.test',
        spaceId: 'space',
        token: 'key',
        migrationVersion: 2,
        fetch,
      });
      expect((await client.getStory({ slug: 'home' })).content).toEqual({ headline: 'New schema' });
      await client.listStories();
      expect(warning).toHaveBeenCalledTimes(1);
      version = 4;
      await client.listStories();
      expect(warning).toHaveBeenCalledTimes(2);
      const legacy = createStorypaneClient({
        url: 'https://cms.test',
        spaceId: 'space',
        token: 'key',
        fetch,
      });
      await expect(legacy.getStory({ slug: 'home' })).resolves.toMatchObject({
        migrationVersion: 4,
      });
      expect(warning).toHaveBeenCalledTimes(3);
      const current = createStorypaneClient({
        url: 'https://cms.test',
        spaceId: 'space',
        token: 'key',
        migrationVersion: 4,
        fetch,
      });
      await current.listStories();
      expect(warning).toHaveBeenCalledTimes(3);
    } finally {
      warning.mockRestore();
    }
  });
  it('passes a configured preview target to the server without placing credentials in the URL', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ token: 'session' }));
    const client = createStorypaneClient({
      url: 'https://cms.test',
      spaceId: 'space',
      token: 'server-key',
      fetch,
    });
    await client.createPreviewSession({
      slug: 'home',
      locale: 'fr',
      previewId: '22222222-2222-4222-8222-222222222222',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url.href).toBe('https://cms.test/api/delivery/preview?space=space');
    expect(JSON.parse(init.body)).toEqual({
      slug: 'home',
      locale: 'fr',
      previewId: '22222222-2222-4222-8222-222222222222',
    });
    expect(init.headers.Authorization).toBe('Bearer server-key');
  });
  it('activates for configured signals without confusing false flags or unrelated cookies', () => {
    const context = {
      url: 'https://site.test/home?review=yes',
      cookie: 'other=1; editorial=on; broken=%XX',
    };
    expect(isPreviewMode({}, context)).toBe(false);
    expect(isPreviewMode({ draft: true }, context)).toBe(true);
    expect(isPreviewMode({ env: 'false' }, context)).toBe(false);
    expect(isPreviewMode({ env: '1' }, context)).toBe(true);
    expect(isPreviewMode({ query: { name: 'review', value: 'yes' } }, context)).toBe(true);
    expect(isPreviewMode({ query: { name: 'review', value: '1' } }, context)).toBe(false);
    expect(isPreviewMode({ cookie: { name: 'editorial', value: 'on' } }, context)).toBe(true);
    expect(isPreviewMode({ cookie: { name: 'missing' } }, context)).toBe(false);
    expect(isPreviewMode({ query: false }, { url: 'https://site.test/?storypane_preview=1' })).toBe(
      false,
    );
    expect(isPreviewMode({}, { url: 'https://site.test/?storypane_preview=1' })).toBe(true);
  });
  it('makes no browser connection when preview is disabled', () => {
    vi.stubGlobal('window', { location: { href: 'https://site.test/' } });
    vi.stubGlobal('document', { cookie: '' });
    const WebSocket = vi.fn();
    vi.stubGlobal('WebSocket', WebSocket);
    const stop = connectPreview({
      cmsUrl: 'https://cms.test',
      spaceId: 'space',
      story: { slug: 'home' },
      onChange: vi.fn(),
    });
    stop();
    expect(WebSocket).not.toHaveBeenCalled();
  });
  it.each(['', 'ca'])(
    'keeps preview streaming after a migration mismatch with default locale %s',
    async (locale) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const browser = {
        get parent(): unknown {
          return this;
        },
        location: { href: 'https://site.test/' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      vi.stubGlobal('window', browser);
      vi.stubGlobal('document', {
        cookie: '',
        head: { appendChild: vi.fn() },
        createElement: () => ({ remove: vi.fn() }),
        querySelectorAll: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      vi.stubGlobal(
        'MutationObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
      class MockSocket {
        static OPEN = 1;
        readyState = 1;
        onmessage?: (event: { data: string }) => void;
        onopen?: () => void;
        onclose?: ((event: { code: number }) => void) | null;
        send = vi.fn();
        close = vi.fn();
        constructor() {
          sockets.push(this);
        }
      }
      const sockets: MockSocket[] = [];
      vi.stubGlobal('WebSocket', MockSocket);
      const onChange = vi.fn(),
        onStatus = vi.fn();
      const stop = connectPreview({
        cmsUrl: 'https://cms.test',
        spaceId: 'space',
        migrationVersion: 1,
        story: { id: 'story' },
        mode: { draft: true },
        onChange,
        onStatus,
        getSession: async () => ({
          token: 'bp_' + 'a'.repeat(43),
          expiresAt: new Date(Date.now() + 120000).toISOString(),
          spaceId: 'space',
          storyId: 'story',
          localeId: 'locale',
          slug: 'home',
          locale,
        }),
      });
      try {
        await vi.waitFor(() => expect(sockets).toHaveLength(1));
        sockets[0].onopen!();
        for (const revision of [1, 2])
          sockets[0].onmessage!({
            data: JSON.stringify({
              type: 'content',
              story: {
                id: 'story',
                localeId: 'locale',
                revision,
                migrationVersion: 2,
                content: { headline: 'Migrated' },
              },
            }),
          });
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(warning).toHaveBeenCalledTimes(1);
        const references = [{ id: 'footer', content: { text: 'Updated footer' } }];
        sockets[0].onmessage!({
          data: JSON.stringify({
            type: 'content',
            story: {
              id: 'story',
              localeId: 'locale',
              revision: 2,
              migrationVersion: 2,
              references,
              referencesRevision: 'footer-v2',
            },
          }),
        });
        expect(onChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ revision: 2, references, referencesRevision: 'footer-v2' }),
        );
        expect(sockets[0].close).not.toHaveBeenCalled();
        expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything());
      } finally {
        stop();
        warning.mockRestore();
      }
    },
  );
  it('uses bearer authentication and explicit locales for published reads, and throws on unpublished stories', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ stories: [{ id: 'story', content: { title: 'Published' } }] }),
      )
      .mockResolvedValueOnce(Response.json({ stories: [] }));
    const client = createStorypaneClient({
      url: 'https://cms.test',
      spaceId: 'space',
      token: 'key',
      fetch,
    });
    expect((await client.getStory({ slug: 'home', locale: 'fr' })).content).toEqual({
      title: 'Published',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url.href).toBe('https://cms.test/api/delivery/stories?space=space&locale=fr&slug=home');
    expect(init.headers.Authorization).toBe('Bearer key');
    expect(url.href).not.toContain('key');
    await expect(client.getStory({ slug: 'unpublished' })).rejects.toMatchObject({ status: 404 });
  });
});
