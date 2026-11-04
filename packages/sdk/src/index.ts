import { migrationWarning } from './migration-warning.js';
export * from './types.js';
// Keep existing integrations working when they adopt the renamed package.
export { createStorypaneClient as createBlokClient, StorypaneError as BlokError };
export type { StorypaneClientOptions as BlokClientOptions };
import type {
  StorypaneStory,
  StorypaneSchema,
  StorypaneLocale,
  PreviewSession,
  StoryReference,
} from './types.js';

export class StorypaneError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'StorypaneError';
  }
}
export interface StorypaneClientOptions {
  url: string;
  spaceId: string;
  token: string;
  migrationVersion?: number;
  fetch?: typeof fetch;
}
export function createStorypaneClient<TContent = StorypaneStory['content']>(
  options: StorypaneClientOptions,
) {
  const base = new URL(options.url);
  const warnMigration = migrationWarning(options.migrationVersion);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password)
    throw new Error('Use an HTTP(S) CMS URL without credentials');
  async function response(
    resource: string,
    query: Record<string, string>,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = new URL(`/api/delivery/${resource}`, base);
    url.searchParams.set('space', options.spaceId);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await (options.fetch ?? fetch)(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new StorypaneError(
        body?.error?.message ?? `Storypane request failed (${response.status})`,
        response.status,
      );
    }
    return response;
  }
  async function request<T>(
    resource: string,
    query: Record<string, string>,
    init?: RequestInit,
  ): Promise<T> {
    const body = await (await response(resource, query, init)).json();
    if (resource === 'stories')
      warnMigration((body as { migrationVersion?: number })?.migrationVersion);
    return body as T;
  }
  function listStories<T = TContent>(
    query: { locale?: string; limit?: number; offset?: number } = {},
    init?: RequestInit,
  ) {
    return request<{
      migrationVersion?: number;
      stories: StorypaneStory<T>[];
      nextOffset: number | null;
    }>(
      'stories',
      {
        locale: query.locale ?? '',
        limit: String(query.limit ?? 50),
        offset: String(query.offset ?? 0),
      },
      init,
    );
  }
  return {
    listLocales() {
      return request<StorypaneLocale[]>('locales', {}, { cache: 'no-store' });
    },
    /** Server-side tooling only: requires a preview token. Contains the deployed schema, never draft values. */
    getSchema() {
      return request<StorypaneSchema>('schema', {}, { cache: 'no-store' });
    },
    /** Server-side only. Streams an asset referenced by a current publication in this space. */
    getAsset(assetId: string, init?: RequestInit) {
      return response('assets', { id: assetId }, init);
    },
    async getStory<T = TContent>(
      reference: StoryReference,
      init?: RequestInit,
    ): Promise<StorypaneStory<T>> {
      const query = {
        locale: reference.locale ?? '',
        ...(reference.id ? { id: reference.id } : { slug: reference.slug! }),
      };
      const result = await request<{ stories: StorypaneStory<T>[] }>('stories', query, init);
      if (!result.stories[0]) throw new StorypaneError('Published story not found', 404);
      return result.stories[0];
    },
    listStories,
    /** Fetch every published story in one locale, following pagination. Defaults to the Default locale. */
    async listAllStories<T = TContent>(
      query: { locale?: string } = {},
      init?: RequestInit,
    ): Promise<StorypaneStory<T>[]> {
      const stories: StorypaneStory<T>[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page: { stories: StorypaneStory<T>[]; nextOffset: number | null } =
          await listStories<T>({ ...query, offset, limit: 100 }, init);
        stories.push(...page.stories);
        if (
          page.nextOffset !== null &&
          (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset)
        )
          throw new StorypaneError('Invalid story pagination response', 502);
        offset = page.nextOffset;
      }
      return stories;
    },
    /** Server-side only: this client must hold a preview token, never a published token. */
    createPreviewSession(reference: StoryReference & { previewId?: string }) {
      return request<PreviewSession>(
        'preview',
        {},
        { method: 'POST', body: JSON.stringify(reference), cache: 'no-store' },
      );
    },
  };
}
