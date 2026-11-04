import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlokClient, isPreviewMode } from './index.js';
import { connectPreview } from './preview.js';

afterEach(() => vi.unstubAllGlobals());
describe('delivery and preview activation', () => {
  it('passes a configured preview target to the server without placing credentials in the URL', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ token:'session' }));
    const client = createBlokClient({ url:'https://cms.test',spaceId:'space',token:'server-key',fetch });
    await client.createPreviewSession({ slug:'home',locale:'fr',previewId:'22222222-2222-4222-8222-222222222222' });
    const [url,init] = fetch.mock.calls[0];
    expect(url.href).toBe('https://cms.test/api/delivery/preview?space=space');
    expect(JSON.parse(init.body)).toEqual({ slug:'home',locale:'fr',previewId:'22222222-2222-4222-8222-222222222222' });
    expect(init.headers.Authorization).toBe('Bearer server-key');
  });
  it('activates for configured signals without confusing false flags or unrelated cookies', () => {
    const context = { url:'https://site.test/home?review=yes', cookie:'other=1; editorial=on; broken=%XX' };
    expect(isPreviewMode({}, context)).toBe(false);
    expect(isPreviewMode({ draft:true }, context)).toBe(true);
    expect(isPreviewMode({ env:'false' }, context)).toBe(false);
    expect(isPreviewMode({ env:'1' }, context)).toBe(true);
    expect(isPreviewMode({ query:{ name:'review',value:'yes' } }, context)).toBe(true);
    expect(isPreviewMode({ query:{ name:'review',value:'1' } }, context)).toBe(false);
    expect(isPreviewMode({ cookie:{ name:'editorial',value:'on' } }, context)).toBe(true);
    expect(isPreviewMode({ cookie:{ name:'missing' } }, context)).toBe(false);
    expect(isPreviewMode({ query:false }, { url:'https://site.test/?blok_preview=1' })).toBe(false);
    expect(isPreviewMode({}, { url:'https://site.test/?blok_preview=1' })).toBe(true);
  });
  it('makes no browser connection when preview is disabled', () => {
    vi.stubGlobal('window',{ location:{ href:'https://site.test/' } }); vi.stubGlobal('document',{ cookie:'' });
    const WebSocket = vi.fn(); vi.stubGlobal('WebSocket',WebSocket);
    const stop = connectPreview({ cmsUrl:'https://cms.test',spaceId:'space',story:{ slug:'home' },onChange:vi.fn() });
    stop(); expect(WebSocket).not.toHaveBeenCalled();
  });
  it('uses bearer authentication and explicit locales for published reads, and throws on unpublished stories', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ stories:[{ id:'story',content:{ title:'Published' } }] })).mockResolvedValueOnce(Response.json({ stories:[] }));
    const client = createBlokClient({ url:'https://cms.test', spaceId:'space', token:'key', fetch });
    expect((await client.getStory({ slug:'home',locale:'fr' })).content).toEqual({ title:'Published' });
    const [url, init] = fetch.mock.calls[0];
    expect(url.href).toBe('https://cms.test/api/delivery/stories?space=space&locale=fr&slug=home');
    expect(init.headers.Authorization).toBe('Bearer key'); expect(url.href).not.toContain('key');
    await expect(client.getStory({ slug:'unpublished' })).rejects.toMatchObject({ status:404 });
  });
});
