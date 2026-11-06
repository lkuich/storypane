export type ManagementJson =
  null | boolean | number | string | ManagementJson[] | { [key: string]: ManagementJson };
export type ManagementPage<T> = { items: T[]; total: number; nextOffset: number | null };
export type ManagementStory = {
  id: string;
  name: string;
  slug: string;
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ManagementLocale = {
  id: string;
  storyId: string;
  name: string;
  slug: string;
  urlSlug: string;
  rootBlockId: string;
  spaceLocaleId: string;
  revision: number;
  checkpointId: string | null;
  publishedVersionId: string | null;
};
export type ManagementBlock = {
  id: string;
  definitionId: string;
  schemaVersionId: string;
  parentId: string | null;
  parentField: string | null;
  position: number;
  revision: number;
  fields: Record<string, ManagementJson>;
};
export type ManagementSnapshot = {
  story: ManagementStory;
  locale: ManagementLocale;
  blocks: ManagementBlock[];
  revision: number;
  checkpointId: string | null;
  migrationVersion?: number;
};
export type ManagementCommit = {
  mutationId: string;
  localeRevision: number;
  checkpointId: string;
  changedBlockIds: string[];
  snapshot: ManagementSnapshot;
  publicationId?: string;
};
export type ManagementAsset = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  title: string;
  alt: string;
  metadataRevision: number;
  archivedAt: string | null;
};
export type ManagementRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  body?: unknown;
  signal?: AbortSignal;
};
export type ManagementClientOptions = {
  url: string;
  spaceId: string;
  token: string;
  productionToken?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class ManagementError extends Error {
  uploadId?: string;
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ManagementError';
  }
}

/** Server-side access to drafts and configuration. Never expose this token in browser code. */
export function createManagementClient(options: ManagementClientOptions) {
  const base = new URL(options.url);
  if (
    base.username ||
    base.password ||
    !(
      base.protocol === 'https:' ||
      (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
    )
  ) {
    throw new Error('Management requests require HTTPS or localhost HTTP');
  }
  if (!options.spaceId || !options.token) {
    throw new Error('A space ID and management token are required');
  }
  const prefix = `/api/management/v1/spaces/${encodeURIComponent(options.spaceId)}/`;
  const fetcher = options.fetch ?? globalThis.fetch;
  async function requestRaw(path: string, init: ManagementRequestOptions = {}): Promise<Response> {
    if (!path.startsWith('/') || path.startsWith('//') || /\\|%2f|%5c/i.test(path.split('?')[0]!)) {
      throw new Error('Use a space-relative management path, such as /stories');
    }
    const url = new URL(prefix + path.slice(1), base.origin);
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.hash) {
      throw new Error('Management requests must stay within the configured space');
    }
    const binary = init.body instanceof Blob;
    const response = await fetcher(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(options.productionToken && path.startsWith('/migrations/')
          ? { 'X-Storypane-Production-Token': options.productionToken }
          : {}),
        ...(binary
          ? {
              'Content-Type': 'application/octet-stream',
              'Content-Length': String((init.body as Blob).size),
            }
          : { 'Content-Type': 'application/json' }),
      },
      body:
        init.body === undefined
          ? undefined
          : binary
            ? (init.body as Blob)
            : JSON.stringify(init.body),
      signal: init.signal ?? AbortSignal.timeout(options.timeoutMs ?? 30_000),
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string; code?: string; details?: unknown };
      } | null;
      throw new ManagementError(
        body?.error?.message ?? `Management request failed (${response.status})`,
        response.status,
        body?.error?.code ?? 'unavailable',
        body?.error?.details,
      );
    }
    return response;
  }
  async function request<T = unknown>(
    path: string,
    init: ManagementRequestOptions = {},
  ): Promise<T> {
    const response = await requestRaw(path, init);
    if (response.status === 204 || init.method === 'HEAD') {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }
  const segment = (value: string) => encodeURIComponent(value);
  const localePath = (storyId: string, localeId: string) =>
    `/stories/${segment(storyId)}/locales/${segment(localeId)}`;
  const command = (storyId: string, localeId: string, input: unknown) =>
    request<ManagementCommit>(`${localePath(storyId, localeId)}/commands`, {
      method: 'POST',
      body: input,
    });

  return {
    request,
    requestRaw,
    stories: {
      list: (query: { offset?: number; limit?: number; deleted?: boolean } = {}) =>
        request<ManagementPage<ManagementStory>>(
          `/stories?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
        ),
      get: (id: string) => request<ManagementStory>(`/stories/${segment(id)}`),
      create: (input: {
        name: string;
        slug: string;
        definitionId: string;
        folderId?: string | null;
      }) => request<ManagementStory>('/stories', { method: 'POST', body: input }),
      locales: (id: string) =>
        request<ManagementPage<ManagementLocale>>(`/stories/${segment(id)}/locales`),
    },
    content: {
      get: (storyId: string, localeId: string) =>
        request<ManagementSnapshot>(localePath(storyId, localeId)),
      command,
      saveBlock: (
        storyId: string,
        localeId: string,
        blockId: string,
        input: {
          fields: Record<string, ManagementJson>;
          expectedRevision: number;
          mutationId: string;
          migrationVersion?: number;
        },
      ) =>
        command(storyId, localeId, {
          type: 'saveBlock',
          mutationId: input.mutationId,
          migrationVersion: input.migrationVersion,
          expectedRevisions: { [blockId]: input.expectedRevision },
          payload: { blockId, fields: input.fields },
        }),
      publish: (
        storyId: string,
        localeId: string,
        input: {
          mutationId: string;
          checkpointId: string;
          referenceChoices?: {
            localeId: string;
            checkpointId: string;
            publicationId?: string | null;
            action: 'publish' | 'omit';
          }[];
        },
      ) =>
        command(storyId, localeId, {
          type: 'publishCheckpoint',
          mutationId: input.mutationId,
          payload: {
            checkpointId: input.checkpointId,
            ...(input.referenceChoices ? { referenceChoices: input.referenceChoices } : {}),
          },
        }),
    },
    assets: {
      list: (
        query: { cursor?: string; search?: string; archived?: boolean; folder?: string } = {},
      ) =>
        request<{ items: ManagementAsset[]; nextCursor: string | null }>(
          `/assets?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
        ),
      get: (id: string) => request<{ asset: ManagementAsset }>(`/assets/${segment(id)}`),
      download: (id: string) => requestRaw(`/assets/${segment(id)}/content`),
      async upload(
        file: Blob,
        filename: string,
        metadata: { title?: string; alt?: string; folderId?: string } = {},
      ) {
        const upload = await request<{ id: string; partBytes: number }>('/assets/uploads', {
          method: 'POST',
          body: { ...metadata, filename, mimeType: file.type, byteSize: file.size },
        });
        try {
          if (!Number.isSafeInteger(upload.partBytes) || upload.partBytes < 1) {
            throw new Error('Invalid upload part size');
          }
          for (let offset = 0, part = 1; offset < file.size; offset += upload.partBytes, part++) {
            await request(`/assets/uploads/${segment(upload.id)}/parts/${part}`, {
              method: 'PUT',
              body: file.slice(offset, offset + upload.partBytes),
            });
          }
          return await request<{ asset: ManagementAsset }>(
            `/assets/uploads/${segment(upload.id)}/complete`,
            { method: 'POST' },
          );
        } catch (cause) {
          const error =
            cause instanceof ManagementError
              ? cause
              : new ManagementError('Asset upload interrupted', 0, 'upload_interrupted', {
                  cause: cause instanceof Error ? cause.message : String(cause),
                });
          error.uploadId = upload.id;
          throw error;
        }
      },
    },
  };
}
export type ManagementClient = ReturnType<typeof createManagementClient>;
