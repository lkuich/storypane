export * from './types.js';
import type { BlokStory, BlokSchema, BlokLocale, PreviewSession, StoryReference } from './types.js';

export class BlokError extends Error {
  constructor(message:string, public status:number) { super(message); this.name = 'BlokError'; }
}
export interface BlokClientOptions { url:string; spaceId:string; token:string; fetch?:typeof fetch }
export function createBlokClient(options: BlokClientOptions) {
  const base = new URL(options.url);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw new Error('Use an HTTP(S) CMS URL without credentials');
  async function request<T>(resource:string, query:Record<string,string>, init:RequestInit = {}): Promise<T> {
    const url = new URL(`/api/delivery/${resource}`, base);
    url.searchParams.set('space', options.spaceId);
    for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value);
    const response = await (options.fetch ?? fetch)(url, { ...init, headers:{ Authorization:`Bearer ${options.token}`, ...(init.body ? { 'Content-Type':'application/json' } : {}), ...init.headers }, signal:init.signal ?? AbortSignal.timeout(20000) });
    const body = await response.json() as { error?:{ message?:string } } | null;
    if (!response.ok) throw new BlokError(body?.error?.message ?? `Blok request failed (${response.status})`, response.status);
    return body as T;
  }
  return {
    listLocales() { return request<BlokLocale[]>('locales', {}, { cache:'no-store' }); },
    /** Server-side tooling only: requires a preview token. Contains schema, never draft values. */
    getSchema() { return request<BlokSchema>('schema', {}, { cache:'no-store' }); },
    async getStory<T = BlokStory['content']>(reference:StoryReference, init?:RequestInit): Promise<BlokStory<T>> {
      const query = { locale:reference.locale ?? '', ...(reference.id ? { id:reference.id } : { slug:reference.slug! }) };
      const result = await request<{ stories:BlokStory<T>[] }>('stories', query, init);
      if (!result.stories[0]) throw new BlokError('Published story not found',404);
      return result.stories[0];
    },
    listStories<T = BlokStory['content']>(query: { locale?:string; limit?:number; offset?:number } = {}, init?:RequestInit) {
      return request<{ stories:BlokStory<T>[]; nextOffset:number | null }>('stories', { locale:query.locale ?? '', limit:String(query.limit ?? 50), offset:String(query.offset ?? 0) }, init);
    },
    /** Server-side only: this client must hold a preview token, never a published token. */
    createPreviewSession(reference:StoryReference) {
      return request<PreviewSession>('preview', {}, { method:'POST', body:JSON.stringify(reference), cache:'no-store' });
    },
  };
}
