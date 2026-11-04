import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { handleAssets, PART_BYTES } from './index';
import type {
  AssetBucket,
  AssetContext,
  AssetMultipart,
  AssetObject,
  AssetObjectBody,
  AssetPart,
  AssetRecord,
  AssetFolder,
} from './types';

class MemoryBucket implements AssetBucket {
  objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  uploads = new Map<string, { key: string; mime: string; parts: Map<number, Uint8Array> }>();
  completeCalls = 0;
  async createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }) {
    const id = crypto.randomUUID();
    this.uploads.set(id, { key, mime: options?.httpMetadata?.contentType ?? '', parts: new Map() });
    return this.resumeMultipartUpload(key, id);
  }
  resumeMultipartUpload(key: string, id: string): AssetMultipart {
    return {
      uploadId: id,
      uploadPart: async (number, body) => {
        const state = this.uploads.get(id);
        if (!state) throw new Error('Missing upload');
        const bytes = new Uint8Array(
          body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer(),
        );
        state.parts.set(number, bytes);
        return { partNumber: number, etag: `part-${number}-${bytes.length}` };
      },
      complete: async (parts: AssetPart[]) => {
        const state = this.uploads.get(id);
        if (!state) throw new Error('Missing upload');
        const arrays = parts.map((p) => state.parts.get(p.partNumber)!);
        const bytes = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
        let offset = 0;
        for (const a of arrays) {
          bytes.set(a, offset);
          offset += a.length;
        }
        this.objects.set(key, { bytes, mime: state.mime });
        this.uploads.delete(id);
        this.completeCalls++;
        return (await this.head(key))!;
      },
      abort: async () => {
        this.uploads.delete(id);
      },
    };
  }
  async head(key: string): Promise<AssetObject | null> {
    const value = this.objects.get(key);
    return value
      ? {
          size: value.bytes.length,
          httpEtag: '"test-etag"',
          httpMetadata: { contentType: value.mime },
        }
      : null;
  }
  async get(
    key: string,
    options?: { range?: Headers | { offset: number; length: number } },
  ): Promise<AssetObjectBody | null> {
    const value = this.objects.get(key),
      head = await this.head(key);
    if (!value || !head) return null;
    const range = options?.range instanceof Headers ? undefined : options?.range;
    const bytes = range
      ? value.bytes.slice(range.offset, range.offset + range.length)
      : value.bytes;
    return {
      ...head,
      range,
      body: new ReadableStream({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
    };
  }
}

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok_test';
const schema = `assets_test_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url });
const db = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const spaceId = crypto.randomUUID(),
  otherSpaceId = crypto.randomUUID();
let context: AssetContext;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0]);
async function call(
  method: string,
  path: string,
  body?: unknown,
  actor = context.actor,
  headers: Record<string, string> = {},
) {
  const request = new Request(`http://localhost/api/cms/assets${path}`, {
    method,
    headers,
    ...(body === undefined
      ? {}
      : {
          body:
            body instanceof Uint8Array
              ? new Blob([new Uint8Array(body).buffer])
              : JSON.stringify(body),
        }),
  });
  return handleAssets(
    request,
    new URL(request.url).pathname.replace('/api/cms/assets', '').split('/').filter(Boolean),
    { ...context, actor },
  );
}
async function begin(bytes = png, extra: Record<string, unknown> = {}) {
  const response = await call('POST', '/uploads', {
    filename: 'picture.png',
    mimeType: 'image/png',
    byteSize: bytes.length,
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string; assetId: string }>;
}
async function send(id: string, bytes = png, part = 1) {
  return call('PUT', `/uploads/${id}/parts/${part}`, bytes, context.actor, {
    'content-length': String(bytes.length),
  });
}
async function finish(id: string) {
  return call('POST', `/uploads/${id}/complete`);
}

beforeAll(async () => {
  if (
    !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    new URL(url).pathname !== '/blok_test'
  )
    throw new Error('Asset integration tests require the disposable local blok_test database');
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.query(
    await readFile(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8'),
  );
  await db.query('INSERT INTO spaces(id,name) VALUES($1,$2),($3,$4)', [
    spaceId,
    'Assets',
    otherSpaceId,
    'Other',
  ]);
});
beforeEach(() => {
  context = {
    db,
    canWrite: true,
    actor: { userId: 'editor', sessionId: 'session', spaceId, role: 'editor' },
    bucket: new MemoryBucket(),
  };
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe('asset service with Postgres and R2 contract', () => {
  it('caches resized previews behind space authorization without exposing originals', async () => {
    const output = vi.fn(async () => ({
      response: () => new Response('resized-webp', { headers: { 'Content-Type': 'image/webp' } }),
    }));
    const transform = vi.fn(() => ({ output }));
    context.images = { input: vi.fn(() => ({ transform })) } as unknown as AssetContext['images'];
    const cached = new Map<string, { bytes: ArrayBuffer; headers: Headers }>();
    const key = (request: RequestInfo | URL) =>
      request instanceof Request ? request.url : String(request);
    context.cache = {
      match: async (request) => {
        const value = cached.get(key(request));
        return value ? new Response(value.bytes.slice(0), { headers: value.headers }) : undefined;
      },
      put: async (request, response) => {
        cached.set(key(request), {
          bytes: await response.arrayBuffer(),
          headers: new Headers(response.headers),
        });
      },
    };
    const upload = await begin();
    await send(upload.id);
    await finish(upload.id);
    const preview = await call('GET', `/${upload.assetId}/thumbnail?width=320`);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toBe('resized-webp');
    expect(preview.headers.get('Content-Type')).toBe('image/webp');
    expect(preview.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(transform).toHaveBeenCalledWith({ width: 320, fit: 'scale-down' });
    expect((await call('GET', `/${upload.assetId}/thumbnail?width=320`)).status).toBe(200);
    expect(output).toHaveBeenCalledTimes(1);
    expect(
      (
        await call('GET', `/${upload.assetId}/thumbnail?width=320`, undefined, {
          ...context.actor,
          spaceId: otherSpaceId,
        })
      ).status,
    ).toBe(404);
    expect((await call('GET', `/${upload.assetId}/thumbnail?width=999999`)).status).toBe(400);
    expect((await call('GET', `/${upload.assetId}/thumbnail?width=640`)).status).toBe(200);
    expect(output).toHaveBeenCalledTimes(2);
    const head = await call('HEAD', `/${upload.assetId}/thumbnail?width=320`);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(
      new Uint8Array(await (await call('GET', `/${upload.assetId}/content`)).arrayBuffer()),
    ).toEqual(png);
  });
  it('uploads, completes idempotently, lists, streams ranges, and archives without losing historical bytes', async () => {
    const upload = await begin();
    expect((await send(upload.id)).status).toBe(200);
    const completed = await finish(upload.id);
    expect(completed.status).toBe(200);
    const result = (await completed.json()) as { asset: AssetRecord };
    expect(result.asset.byteSize).toBe(png.length);
    const repeated = await finish(upload.id);
    expect(((await repeated.json()) as { asset: AssetRecord }).asset.id).toBe(result.asset.id);
    expect((context.bucket as MemoryBucket).completeCalls).toBe(1);
    const range = await call('GET', `/${upload.assetId}/content`, undefined, context.actor, {
      range: 'bytes=0-7',
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe(`bytes 0-7/${png.length}`);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(png.slice(0, 8));
    expect(
      (
        await call('GET', `/${upload.assetId}/content`, undefined, context.actor, {
          range: 'bytes=99-100',
        })
      ).status,
    ).toBe(416);
    expect((await call('DELETE', `/${upload.assetId}`)).status).toBe(200);
    const list = (await (await call('GET', '')).json()) as { items: AssetRecord[] };
    expect(list.items.some((a) => a.id === upload.assetId)).toBe(false);
    expect((await call('GET', `/${upload.assetId}/content`)).status).toBe(200);
  });
  it('rejects wrong-space read, resume, folder placement, and upload destination', async () => {
    const upload = await begin();
    const other = { ...context.actor, spaceId: otherSpaceId };
    expect((await call('GET', `/uploads/${upload.id}`, undefined, other)).status).toBe(404);
    await send(upload.id);
    await finish(upload.id);
    expect((await call('GET', `/${upload.assetId}`, undefined, other)).status).toBe(404);
    const target = (await (
      await call('POST', '/folders', { name: 'Private' }, other)
    ).json()) as AssetFolder;
    expect((await call('POST', `/${upload.assetId}/folders`, { folderId: target.id })).status).toBe(
      404,
    );
    expect(
      (
        await call('POST', '/uploads', {
          filename: 'x.png',
          mimeType: 'image/png',
          byteSize: png.length,
          folderId: target.id,
        })
      ).status,
    ).toBe(404);
  });
  it('resumes accepted parts and rejects incomplete or incorrectly sized uploads', async () => {
    const bytes = new Uint8Array(PART_BYTES + png.length);
    bytes.set(png);
    const upload = await begin(bytes);
    expect((await send(upload.id, png)).status).toBe(400);
    expect((await send(upload.id, bytes.slice(0, PART_BYTES))).status).toBe(200);
    const state = (await (await call('GET', `/uploads/${upload.id}`)).json()) as {
      parts: AssetPart[];
    };
    expect(state.parts).toHaveLength(1);
    expect((await finish(upload.id)).status).toBe(400);
    expect((await send(upload.id, bytes.slice(PART_BYTES), 2)).status).toBe(200);
    expect((await finish(upload.id)).status).toBe(200);
  });
  it('verifies file bytes and keeps rejected files out of the library', async () => {
    const bytes = new TextEncoder().encode('not an image');
    const upload = await begin(bytes);
    await send(upload.id, bytes);
    expect((await finish(upload.id)).status).toBe(415);
    expect((await call('GET', `/${upload.assetId}`)).status).toBe(404);
  });
  it('recovers when R2 completion succeeds before the database insert fails', async () => {
    const upload = await begin();
    await send(upload.id);
    await db.query(
      `CREATE FUNCTION reject_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test commit failure'; END; $$; CREATE TRIGGER reject_asset BEFORE INSERT ON assets FOR EACH ROW EXECUTE FUNCTION reject_asset();`,
    );
    expect((await finish(upload.id)).status).toBe(503);
    await db.query('DROP TRIGGER reject_asset ON assets; DROP FUNCTION reject_asset();');
    expect((await finish(upload.id)).status).toBe(200);
    expect((context.bucket as MemoryBucket).completeCalls).toBe(1);
  });
  it('cancels uploads and prevents later part writes', async () => {
    const upload = await begin();
    expect((await call('DELETE', `/uploads/${upload.id}`)).status).toBe(200);
    expect((await send(upload.id)).status).toBe(409);
    expect((await finish(upload.id)).status).toBe(409);
  });
  it('serializes concurrent part retries before they can overwrite the R2 receipt', async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    class DelayedBucket extends MemoryBucket {
      calls = 0;
      override resumeMultipartUpload(key: string, id: string): AssetMultipart {
        const original = super.resumeMultipartUpload(key, id);
        return {
          ...original,
          uploadPart: async (number, body) => {
            this.calls++;
            const result = await original.uploadPart(number, body);
            if (this.calls === 1) {
              entered();
              await gate;
            }
            return result;
          },
        };
      }
    }
    const bucket = new DelayedBucket();
    context.bucket = bucket;
    const upload = await begin();
    const first = send(upload.id);
    await started;
    const second = send(upload.id);
    try {
      const completedEarly = await Promise.race([
        second.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(completedEarly).toBe(false);
      expect(bucket.calls).toBe(1);
    } finally {
      release();
    }
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(bucket.calls).toBe(2);
    expect((await finish(upload.id)).status).toBe(200);
  });
  it('keeps assets when folder trees are removed and rejects third-level nesting', async () => {
    const root = (await (
      await call('POST', '/folders', { name: 'Campaign' })
    ).json()) as AssetFolder;
    const child = (await (
      await call('POST', '/folders', { name: 'Summer', parentId: root.id })
    ).json()) as AssetFolder;
    expect((await call('POST', '/folders', { name: 'Too deep', parentId: child.id })).status).toBe(
      400,
    );
    const upload = await begin(png, { folderId: child.id });
    await send(upload.id);
    await finish(upload.id);
    expect((await call('DELETE', `/folders/${root.id}`)).status).toBe(200);
    expect((await call('GET', `/${upload.assetId}/content`)).status).toBe(200);
    const result = (await (await call('GET', '?folder=root')).json()) as { items: AssetRecord[] };
    expect(result.items.some((a) => a.id === upload.assetId)).toBe(true);
  });
});

it('allows read-only browsing but denies every asset mutation without write permission', async () => {
  context.canWrite = false;
  context.actor.role = 'viewer';
  expect((await call('GET', '')).status).toBe(200);
  const id = crypto.randomUUID();
  for (const [method, path] of [
    ['POST', '/uploads'],
    ['PUT', `/uploads/${id}/parts/1`],
    ['POST', `/uploads/${id}/complete`],
    ['DELETE', `/uploads/${id}`],
    ['POST', '/folders'],
    ['PATCH', `/folders/${id}`],
    ['DELETE', `/folders/${id}`],
    ['PATCH', `/${id}`],
    ['DELETE', `/${id}`],
    ['POST', `/${id}/folders`],
  ]) {
    expect((await call(method!, path!, {})).status).toBe(403);
  }
  expect((context.bucket as MemoryBucket).uploads.size).toBe(0);
  context.canWrite = true;
  context.actor.role = 'custom-asset-manager';
  expect(
    (await call('POST', '/folders', { name: `Custom role ${crypto.randomUUID()}` })).status,
  ).toBe(201);
});
