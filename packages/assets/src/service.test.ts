import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { handleAssets, handlePublicMedia, copySchemaAsset, PART_BYTES } from './index';
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

const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
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

async function publishAsset(assetId: string) {
  const storyId = crypto.randomUUID(),
    localeId = crypto.randomUUID(),
    checkpointId = crypto.randomUUID(),
    publicationId = crypto.randomUUID();
  await db.query(
    'INSERT INTO stories(id,space_id,name,slug) VALUES($1::uuid,$2,$1::text,$1::text)',
    [storyId, spaceId],
  );
  await db.query(
    "INSERT INTO story_locales(id,story_id,slug,name,url_slug,root_block_id) VALUES($1,$2::uuid,'en','English',$2::text,$3)",
    [localeId, storyId, crypto.randomUUID()],
  );
  const content = JSON.stringify({ image: { assetId } });
  await db.query(
    "INSERT INTO checkpoints(id,locale_id,revision,actor_id,reason,snapshot,content) VALUES($1,$2,1,'editor','test','{}',$3)",
    [checkpointId, localeId, content],
  );
  await db.query(
    "INSERT INTO publications(id,locale_id,checkpoint_id,revision,actor_id,snapshot,content) VALUES($1,$2,$3,1,'editor','{}',$4)",
    [publicationId, localeId, checkpointId, content],
  );
  await db.query('UPDATE story_locales SET published_version_id=$2 WHERE id=$1', [
    localeId,
    publicationId,
  ]);
  return { storyId, localeId, publicationId };
}
function publicMedia(
  assetId: string,
  suffix = 'image?width=320',
  method = 'GET',
  headers: Record<string, string> = {},
  requestedSpace = spaceId,
) {
  const request = new Request(`http://localhost/media/${requestedSpace}/${assetId}/${suffix}`, {
    method,
    headers,
  });
  return handlePublicMedia(
    request,
    { spaceId: requestedSpace, assetId, kind: suffix.split('?')[0] },
    context,
  );
}
function installImages() {
  const output = vi.fn(async () => ({
    response: () => new Response('transformed', { headers: { 'Content-Type': 'image/webp' } }),
  }));
  const transform = vi.fn(() => ({ output }));
  context.images = { input: vi.fn(() => ({ transform })) } as unknown as AssetContext['images'];
  const cached = new Map<string, ArrayBuffer>();
  const key = (request: RequestInfo | URL) =>
    request instanceof Request ? request.url : String(request);
  const match = vi.fn(async (request: RequestInfo | URL) => {
    const bytes = cached.get(key(request));
    return bytes ? new Response(bytes.slice(0)) : undefined;
  });
  context.cache = {
    match,
    put: async (request, response) => {
      cached.set(key(request), await response.arrayBuffer());
    },
  };
  return { output, transform, match };
}

beforeAll(async () => {
  if (
    !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    new URL(url).pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
  ) {
    throw new Error('Asset integration tests require the disposable local test database');
  }
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.query(
    await readFile(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8'),
  );
  for (const name of ['015_story_lifecycle', '016_webhooks', '018_production_media'])
    await db.query(
      await readFile(new URL(`../../db/migrations/${name}.sql`, import.meta.url), 'utf8'),
    );
  await db.query('INSERT INTO spaces(id,name) VALUES($1,$2),($3,$4)', [
    spaceId,
    'Assets',
    otherSpaceId,
    'Other',
  ]);
});
beforeEach(async () => {
  await db.query('UPDATE spaces SET public_media=false');
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
  it('requires current publication and explicit opt-in before cache hits or conditional responses', async () => {
    const upload = await begin();
    await send(upload.id);
    await finish(upload.id);
    const { match, output } = installImages();
    expect((await publicMedia(upload.assetId)).status).toBe(404);
    const first = await publishAsset(upload.assetId),
      second = await publishAsset(upload.assetId);
    expect((await publicMedia(upload.assetId)).status).toBe(404);
    await db.query('UPDATE spaces SET public_media=true WHERE id=$1', [spaceId]);
    expect((await publicMedia(upload.assetId, 'original', 'GET', {}, otherSpaceId)).status).toBe(
      404,
    );
    const response = await publicMedia(upload.assetId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('transformed');
    const etag = response.headers.get('etag')!;
    expect(
      (await publicMedia(upload.assetId, 'image?width=320&quality=80&fit=contain&aspect=original'))
        .status,
    ).toBe(200);
    expect(output).toHaveBeenCalledTimes(1);
    const uppercase = await publicMedia(
      upload.assetId.toUpperCase(),
      'image?width=320',
      'GET',
      {},
      spaceId.toUpperCase(),
    );
    expect(uppercase.status).toBe(200);
    expect(uppercase.headers.get('etag')).toBe(etag);
    expect(output).toHaveBeenCalledTimes(1);
    expect(
      (await publicMedia(upload.assetId, 'image?width=320', 'GET', { 'If-None-Match': etag }))
        .status,
    ).toBe(304);
    await call('DELETE', `/${upload.assetId}`);
    expect((await publicMedia(upload.assetId)).status).toBe(200);
    await db.query('UPDATE story_locales SET published_version_id=NULL WHERE id=$1', [
      first.localeId,
    ]);
    expect((await publicMedia(upload.assetId)).status).toBe(200);
    await db.query('UPDATE stories SET deleted_at=now() WHERE id=$1', [second.storyId]);
    match.mockClear();
    expect(
      (await publicMedia(upload.assetId, 'image?width=320', 'GET', { 'If-None-Match': etag }))
        .status,
    ).toBe(404);
    expect(match).not.toHaveBeenCalled();
    await db.query('UPDATE stories SET deleted_at=NULL WHERE id=$1', [second.storyId]);
    await db.query('UPDATE spaces SET public_media=false WHERE id=$1', [spaceId]);
    expect((await publicMedia(upload.assetId)).status).toBe(404);
    expect((await call('GET', `/${upload.assetId}/content`)).status).toBe(200);
    await db.query('UPDATE spaces SET public_media=true WHERE id=$1', [spaceId]);
    await db.query('UPDATE story_locales SET published_version_id=NULL WHERE id=$1', [
      second.localeId,
    ]);
    expect((await publicMedia(upload.assetId)).status).toBe(404); // Historical publications still exist.
  });
  it('revises focal metadata atomically with its webhook, invalidates crop identity, and preserves original bytes', async () => {
    const upload = await begin();
    await send(upload.id);
    await finish(upload.id);
    await publishAsset(upload.assetId);
    await db.query('UPDATE spaces SET public_media=true WHERE id=$1', [spaceId]);
    await db.query(
      "INSERT INTO webhook_endpoints(space_id,name,url,events,encrypted_secret) VALUES($1,'Assets','https://example.com/hook',ARRAY['asset.updated'],'test')",
      [spaceId],
    );
    const { output, transform } = installImages();
    const before = await publicMedia(upload.assetId, 'image?width=640&aspect=1:1');
    expect(transform).toHaveBeenLastCalledWith({
      width: 640,
      height: 640,
      fit: 'cover',
      gravity: { x: 0.5, y: 0.5, mode: 'remainder' },
    });
    const patch = await call('PATCH', `/${upload.assetId}`, {
      focalPoint: { x: 0, y: 1 },
      metadataRevision: 1,
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { asset: AssetRecord }).asset).toMatchObject({
      focalPoint: { x: 0, y: 1 },
      metadataRevision: 2,
    });
    expect(
      (
        await call('PATCH', `/${upload.assetId}`, {
          focalPoint: { x: 1, y: 1 },
          metadataRevision: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('PATCH', `/${upload.assetId}`, {
          focalPoint: { x: 0, y: 1 },
          metadataRevision: 2,
        })
      ).status,
    ).toBe(200);
    const events = (
      await db.query('SELECT payload FROM webhook_events WHERE event_key=$1', [
        `asset.updated:${upload.assetId}:2`,
      ])
    ).rows;
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload).data).toEqual({
      assetId: upload.assetId,
      metadataRevision: 2,
    });
    const after = await publicMedia(upload.assetId, 'image?width=640&aspect=1:1');
    expect(after.headers.get('etag')).not.toBe(before.headers.get('etag'));
    expect(output).toHaveBeenCalledTimes(2);
    expect(transform).toHaveBeenLastCalledWith({
      width: 640,
      height: 640,
      fit: 'cover',
      gravity: { x: 0, y: 1, mode: 'remainder' },
    });
    expect(output).toHaveBeenLastCalledWith({ format: 'image/webp', quality: 80, anim: false });
    expect(
      new Uint8Array(await (await publicMedia(upload.assetId, 'original')).arrayBuffer()),
    ).toEqual(png);
    const reset = await call('PATCH', `/${upload.assetId}`, { focalPoint: null });
    expect(((await reset.json()) as { asset: AssetRecord }).asset).toMatchObject({
      focalPoint: null,
      metadataRevision: 3,
    });
    expect(
      (await call('PATCH', `/${upload.assetId}`, { focalPoint: { x: -1, y: 0 } })).status,
    ).toBe(400);
  });
  it('streams safe public originals and rejects invalid transforms without caching failures', async () => {
    const upload = await begin();
    await send(upload.id);
    await finish(upload.id);
    await publishAsset(upload.assetId);
    await db.query('UPDATE spaces SET public_media=true WHERE id=$1', [spaceId]);
    const original = await publicMedia(upload.assetId, 'original');
    expect(original.headers.get('content-type')).toBe('image/png');
    expect(original.headers.get('x-content-type-options')).toBe('nosniff');
    expect(original.headers.get('content-security-policy')).toContain('sandbox');
    const head = await publicMedia(upload.assetId, 'original', 'HEAD');
    expect(head.headers.get('content-length')).toBe(String(png.length));
    expect(await head.text()).toBe('');
    expect(
      (await publicMedia(upload.assetId, 'original', 'GET', { 'If-None-Match': 'W/"test-etag"' }))
        .status,
    ).toBe(304);
    const range = await publicMedia(upload.assetId, 'original', 'GET', { Range: 'bytes=-4' });
    expect(range.status).toBe(206);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(png.slice(-4));
    for (const range of ['bytes=99-', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=8-2']) {
      const rejected = await publicMedia(upload.assetId, 'original', 'GET', { Range: range });
      expect(rejected.status).toBe(416);
      expect(rejected.headers.get('cache-control')).toBe('no-store');
    }
    expect((await publicMedia(upload.assetId)).status).toBe(503);
    const { output } = installImages();
    expect((await publicMedia(upload.assetId, 'image?width=999999')).status).toBe(400);
    expect(
      (await publicMedia(upload.assetId, 'image?width=320&quality=80&format=png')).status,
    ).toBe(400);
    expect(output).not.toHaveBeenCalled();
    const transformedHead = await publicMedia(upload.assetId, 'image?width=320', 'HEAD');
    expect(transformedHead.status).toBe(200);
    expect(await transformedHead.text()).toBe('');
    await db.query("UPDATE assets SET mime_type='text/plain' WHERE id=$1", [upload.assetId]);
    expect((await publicMedia(upload.assetId)).status).toBe(415);
    expect((await call('PATCH', `/${upload.assetId}`, { focalPoint: { x: 0, y: 0 } })).status).toBe(
      400,
    );
    expect(
      (await call('PATCH', `/${upload.assetId}`, { title: 'Text remains editable' })).status,
    ).toBe(200);
    await db.query("UPDATE assets SET mime_type='image/png',byte_size=20971521 WHERE id=$1", [
      upload.assetId,
    ]);
    expect((await publicMedia(upload.assetId)).status).toBe(413);
    await db.query('UPDATE assets SET byte_size=$2 WHERE id=$1', [upload.assetId, png.length]);
    output.mockRejectedValueOnce(new Error('unsupported image'));
    expect((await publicMedia(upload.assetId, 'image?width=640')).status).toBe(422);
    expect((await publicMedia(upload.assetId, 'image?width=640')).status).toBe(200);
  });
  it('fails closed when the eligibility query is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = vi.spyOn(db, 'query').mockRejectedValueOnce(new Error('database down'));
    const { match } = installImages();
    try {
      const response = await publicMedia(crypto.randomUUID());
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(match).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      log.mockRestore();
    }
  });
  it('keeps public HEAD errors bodyless and passes format/contain options without crop gravity', async () => {
    const missing = await publicMedia(crypto.randomUUID(), 'original', 'HEAD');
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('');
    expect(missing.headers.get('cache-control')).toBe('no-store');
    const upload = await begin();
    await send(upload.id);
    await finish(upload.id);
    await publishAsset(upload.assetId);
    await db.query('UPDATE spaces SET public_media=true WHERE id=$1', [spaceId]);
    const { transform, output } = installImages();
    const pngVariant = await publicMedia(
      upload.assetId,
      'image?width=320&aspect=3:4&fit=contain&format=png',
    );
    expect(pngVariant.status).toBe(200);
    expect(pngVariant.headers.get('content-type')).toBe('image/png');
    expect(transform).toHaveBeenLastCalledWith({ width: 320, height: 427, fit: 'contain' });
    expect(output).toHaveBeenLastCalledWith({
      format: 'image/png',
      quality: undefined,
      anim: false,
    });
    const jpegVariant = await publicMedia(
      upload.assetId,
      'image?width=1920&format=jpeg&quality=60',
    );
    expect(jpegVariant.status).toBe(200);
    expect(jpegVariant.headers.get('content-type')).toBe('image/jpeg');
    expect(transform).toHaveBeenLastCalledWith({
      width: 1920,
      height: undefined,
      fit: 'scale-down',
    });
    expect(output).toHaveBeenLastCalledWith({ format: 'image/jpeg', quality: 60, anim: false });
    const invalid = await publicMedia(upload.assetId, 'image?width=9000', 'HEAD');
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe('');
  });
  it('rolls metadata back when its webhook outbox write fails', async () => {
    const upload = await begin();
    await send(upload.id);
    await finish(upload.id);
    await db.query(
      "INSERT INTO webhook_endpoints(space_id,name,url,events,encrypted_secret) VALUES($1,'Atomic save','https://example.com/hook',ARRAY['asset.updated'],'test')",
      [spaceId],
    );
    await db.query(
      `ALTER TABLE webhook_events ADD CONSTRAINT media_outbox_failure CHECK(event_key <> 'asset.updated:${upload.assetId}:2')`,
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await call('PATCH', `/${upload.assetId}`, {
        focalPoint: { x: 1, y: 0 },
        metadataRevision: 1,
      });
      expect(response.status).toBe(503);
      const unchanged = (await (await call('GET', `/${upload.assetId}`)).json()) as {
        asset: AssetRecord;
      };
      expect(unchanged.asset).toMatchObject({ focalPoint: null, metadataRevision: 1 });
      expect(
        (
          await db.query('SELECT id FROM webhook_events WHERE event_key=$1', [
            `asset.updated:${upload.assetId}:2`,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await db.query('ALTER TABLE webhook_events DROP CONSTRAINT media_outbox_failure');
      log.mockRestore();
    }
  });
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
  it('verifies stored metadata when multipart completion omits it', async () => {
    const upload = await begin();
    await send(upload.id);
    const bucket = context.bucket as MemoryBucket;
    const resume = bucket.resumeMultipartUpload.bind(bucket);
    vi.spyOn(bucket, 'resumeMultipartUpload').mockImplementation((key, id) => {
      const multipart = resume(key, id);
      return {
        ...multipart,
        complete: async (parts) => ({
          ...(await multipart.complete(parts)),
          httpMetadata: undefined,
        }),
      };
    });
    const completed = await finish(upload.id);
    expect(completed.status).toBe(200);
    const result = (await completed.json()) as { asset: AssetRecord };
    expect(result.asset.byteSize).toBe(png.length);
    expect(bucket.completeCalls).toBe(1);
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

it('copies original media to an independent space key and resumes completed copies', async () => {
  const bucket = new MemoryBucket();
  const bytes = new Uint8Array(PART_BYTES + 17).fill(123);
  bucket.objects.set('source/original', { bytes, mime: 'image/png' });
  const asset = {
    object_key: 'source/original',
    id: crypto.randomUUID(),
    byte_size: String(bytes.length),
    mime_type: 'image/png',
  };
  await copySchemaAsset(bucket, asset, 'target/original');
  await copySchemaAsset(bucket, asset, 'target/original');
  expect(bucket.completeCalls).toBe(1);
  expect(bucket.objects.get('target/original')?.bytes).toEqual(bytes);
  bucket.objects.delete('source/original');
  expect(bucket.objects.get('target/original')?.bytes.length).toBe(bytes.length);
  await expect(copySchemaAsset(bucket, asset, 'another/original')).rejects.toThrow('unavailable');
});
