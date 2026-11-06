import type { PoolClient } from 'pg';
import { isPublishedAsset, recordWebhookEvent } from '@storypane/db';
import {
  AssetError,
  assert,
  metadata,
  focalPoint,
  PART_BYTES,
  signatureMatches,
  text,
  uploadInput,
} from './validation';
import type { AssetContext, AssetPart, AssetRecord } from './types';
import { imageOptions } from './image-options';
export type {
  AssetBucket,
  AssetImages,
  AssetImageTransform,
  AssetContext,
  AssetRecord,
  AssetFolder,
  AssetPart,
  AssetObject,
  AssetObjectBody,
  AssetMultipart,
} from './types';
export { MAX_ASSET_BYTES, PART_BYTES, ASSET_TYPES } from './validation';

interface AssetRow {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: string;
  title: string;
  alt: string;
  notes: string;
  tags: string[];
  folder_ids?: string[];
  archived_at: Date | null;
  created_at: Date;
  object_key: string;
  focal_x: number | null;
  focal_y: number | null;
  metadata_revision: number;
}
interface UploadRow {
  id: string;
  asset_id: string;
  object_key: string;
  r2_upload_id: string;
  filename: string;
  mime_type: string;
  expected_size: string;
  metadata: ReturnType<typeof metadata> & { folderId: string | null };
  parts: AssetPart[];
  status: 'uploading' | 'completing' | 'complete' | 'cancelled';
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function asset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    title: row.title,
    alt: row.alt,
    notes: row.notes,
    tags: row.tags,
    folderIds: row.folder_ids ?? [],
    archivedAt: row.archived_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    focalPoint: row.focal_x == null ? null : { x: row.focal_x, y: row.focal_y! },
    metadataRevision: row.metadata_revision,
  };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  assert(reader, 'Request body required');
  let value = '';
  let size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new AssetError(413, 'invalid', 'Request too large');
    }
    value += decoder.decode(chunk.value, { stream: true });
  }
  try {
    const parsed: unknown = JSON.parse(value + decoder.decode());
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Object required');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError(400, 'invalid', 'Invalid JSON');
  }
}

async function folder(context: AssetContext, id: unknown) {
  if (!id) return null;
  assert(typeof id === 'string' && uuid(id), 'Invalid folder');
  const result = await context.db.query(
    'SELECT id,parent_id FROM asset_folders WHERE id=$1 AND space_id=$2',
    [id, context.actor.spaceId],
  );
  if (!result.rows[0]) throw new AssetError(404, 'not_found', 'Folder not found');
  return result.rows[0] as { id: string; parent_id: string | null };
}

async function getAsset(
  context: AssetContext,
  id: string,
  db: AssetContext['db'] | PoolClient = context.db,
  lock = false,
) {
  assert(uuid(id), 'Invalid asset ID');
  const result = await db.query<AssetRow>(
    `SELECT * FROM assets WHERE id=$1 AND space_id=$2${lock ? ' FOR UPDATE' : ''}`,
    [id, context.actor.spaceId],
  );
  if (!result.rows[0]) throw new AssetError(404, 'not_found', 'Asset not found');
  return result.rows[0];
}

async function getUpload(
  context: AssetContext,
  id: string,
  db: AssetContext['db'] | PoolClient = context.db,
  lock = false,
) {
  assert(uuid(id), 'Invalid upload ID');
  const result = await db.query<UploadRow>(
    `SELECT * FROM asset_uploads WHERE id=$1 AND space_id=$2 AND user_id=$3${lock ? ' FOR UPDATE' : ''}`,
    [id, context.actor.spaceId, context.actor.userId],
  );
  if (!result.rows[0]) throw new AssetError(404, 'not_found', 'Upload not found');
  return result.rows[0];
}

async function startUpload(request: Request, context: AssetContext) {
  const input = await body(request);
  const file = uploadInput(input);
  const meta = metadata(input, file.filename);
  const target = await folder(context, input.folderId);
  const lastModified = Number.isSafeInteger(input.lastModified) ? Number(input.lastModified) : null;
  const id = crypto.randomUUID(),
    assetId = crypto.randomUUID();
  const key = `${context.actor.spaceId}/${assetId}`;
  const upload = await context.bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: file.mimeType },
  });
  try {
    await context.db.query(
      `INSERT INTO asset_uploads(id,space_id,user_id,asset_id,object_key,r2_upload_id,filename,mime_type,expected_size,metadata,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'uploading')`,
      [
        id,
        context.actor.spaceId,
        context.actor.userId,
        assetId,
        key,
        upload.uploadId,
        file.filename,
        file.mimeType,
        file.byteSize,
        JSON.stringify({ ...meta, folderId: target?.id ?? null, lastModified }),
      ],
    );
  } catch (error) {
    await upload.abort().catch(() => {});
    throw error;
  }
  return json({ id, assetId, partBytes: PART_BYTES, parts: [] }, 201);
}

async function uploadPart(request: Request, context: AssetContext, id: string, part: string) {
  const db = await context.db.connect();
  try {
    await db.query('BEGIN');
    // Serialize R2 and its receipt together so concurrent retries cannot persist stale ETags.
    const row = await getUpload(context, id, db, true);
    const number = Number(part),
      expected = Number(row.expected_size);
    assert(
      Number.isSafeInteger(number) && number >= 1 && number <= Math.ceil(expected / PART_BYTES),
      'Invalid part number',
    );
    if (row.status !== 'uploading')
      throw new AssetError(409, 'conflict', 'Upload no longer accepts parts');
    const size = Number(request.headers.get('content-length'));
    const expectedPartSize = Math.min(PART_BYTES, expected - (number - 1) * PART_BYTES);
    assert(size === expectedPartSize && request.body, 'Part size does not match the upload');
    const uploaded = await context.bucket
      .resumeMultipartUpload(row.object_key, row.r2_upload_id)
      .uploadPart(number, request.body);
    await db.query(
      `UPDATE asset_uploads SET parts=(SELECT coalesce(jsonb_agg(p ORDER BY (p->>'partNumber')::int),'[]') FROM
      (SELECT value AS p FROM jsonb_array_elements(parts) WHERE (value->>'partNumber')::int <> $2 UNION ALL SELECT $3::jsonb) entries),updated_at=now()
      WHERE id=$1`,
      [id, number, JSON.stringify(uploaded)],
    );
    await db.query('COMMIT');
    return json(uploaded);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

async function completeUpload(context: AssetContext, id: string) {
  const db = await context.db.connect();
  try {
    await db.query('BEGIN');
    const row = await getUpload(context, id, db, true);
    if (row.status === 'cancelled') throw new AssetError(409, 'conflict', 'Upload was cancelled');
    if (row.status === 'complete') {
      const result = await db.query<AssetRow>('SELECT * FROM assets WHERE id=$1 AND space_id=$2', [
        row.asset_id,
        context.actor.spaceId,
      ]);
      await db.query('COMMIT');
      return json({ asset: asset(result.rows[0]!) });
    }
    const parts = [...row.parts].sort((a, b) => a.partNumber - b.partNumber);
    assert(
      parts.length === Math.ceil(Number(row.expected_size) / PART_BYTES) &&
        parts.every((p, i) => p.partNumber === i + 1),
      'Upload is missing parts',
    );
    // R2 completion may survive a failed Postgres commit; the immutable key makes retry safe.
    let object = await context.bucket.head(row.object_key);
    if (!object) {
      await context.bucket.resumeMultipartUpload(row.object_key, row.r2_upload_id).complete(parts);
      // Multipart completion can omit HTTP metadata; verify the stored object instead.
      object = await context.bucket.head(row.object_key);
    }
    assert(
      object &&
        object.size === Number(row.expected_size) &&
        object.httpMetadata?.contentType === row.mime_type,
      'Uploaded file size or type does not match',
    );
    const probe = await context.bucket.get(row.object_key, {
      range: { offset: 0, length: Math.min(64, object.size) },
    });
    assert(probe, 'Uploaded object missing');
    const bytes = new Uint8Array(await new Response(probe.body).arrayBuffer());
    if (!signatureMatches(row.mime_type, bytes))
      throw new AssetError(415, 'invalid', 'File content does not match its type');
    if (row.metadata.folderId) {
      const target = await db.query(
        'SELECT id FROM asset_folders WHERE id=$1 AND space_id=$2 FOR SHARE',
        [row.metadata.folderId, context.actor.spaceId],
      );
      assert(target.rowCount, 'Upload folder no longer exists; cancel and select a new folder');
    }
    const result = await db.query<AssetRow>(
      `INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title,alt,notes,tags)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        row.asset_id,
        context.actor.spaceId,
        row.object_key,
        row.filename,
        row.mime_type,
        object.size,
        row.metadata.title,
        row.metadata.alt,
        row.metadata.notes,
        JSON.stringify(row.metadata.tags),
      ],
    );
    if (row.metadata.folderId)
      await db.query('INSERT INTO asset_folder_placements(asset_id,folder_id) VALUES($1,$2)', [
        row.asset_id,
        row.metadata.folderId,
      ]);
    await db.query("UPDATE asset_uploads SET status='complete',updated_at=now() WHERE id=$1", [id]);
    await db.query('COMMIT');
    return json({
      asset: asset({
        ...result.rows[0]!,
        folder_ids: row.metadata.folderId ? [row.metadata.folderId] : [],
      }),
    });
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

async function cancelUpload(context: AssetContext, id: string) {
  const db = await context.db.connect();
  try {
    await db.query('BEGIN');
    const row = await getUpload(context, id, db, true);
    if (row.status === 'complete')
      throw new AssetError(409, 'conflict', 'Completed assets must be archived');
    const referenced = await db.query('SELECT 1 FROM assets WHERE object_key=$1', [row.object_key]);
    if (referenced.rowCount)
      throw new AssetError(409, 'conflict', 'Completed assets must be archived');
    const exists = await context.bucket.head(row.object_key);
    if (exists) await context.bucket.delete(row.object_key);
    else if (row.status !== 'cancelled')
      await context.bucket.resumeMultipartUpload(row.object_key, row.r2_upload_id).abort();
    if (row.status !== 'cancelled') {
      await db.query("UPDATE asset_uploads SET status='cancelled',updated_at=now() WHERE id=$1", [
        id,
      ]);
    }
    await db.query('COMMIT');
    return json({ cancelled: true });
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

async function listAssets(request: Request, context: AssetContext) {
  const params = new URL(request.url).searchParams;
  const limit = 40,
    offset = Number(params.get('cursor') ?? 0);
  assert(Number.isSafeInteger(offset) && offset >= 0 && offset <= 1000000, 'Invalid cursor');
  const search = (params.get('search') ?? '').slice(0, 200),
    folderId = params.get('folder');
  if (folderId && folderId !== 'root') await folder(context, folderId);
  const result = await context.db.query<AssetRow>(
    `SELECT a.*,ARRAY(SELECT p.folder_id FROM asset_folder_placements p WHERE p.asset_id=a.id) folder_ids FROM assets a
    WHERE a.space_id=$1 AND (a.archived_at IS NOT NULL)=$6 AND ($2='' OR a.title ILIKE '%'||$2||'%' OR a.filename ILIKE '%'||$2||'%' OR a.tags::text ILIKE '%'||$2||'%')
    AND ($3::text IS NULL OR ($3='root' AND NOT EXISTS(SELECT 1 FROM asset_folder_placements p WHERE p.asset_id=a.id)) OR EXISTS(SELECT 1 FROM asset_folder_placements p WHERE p.asset_id=a.id AND p.folder_id::text=$3))
    ORDER BY a.created_at DESC,a.id LIMIT $4 OFFSET $5`,
    [context.actor.spaceId, search, folderId, limit + 1, offset, params.get('archived') === 'true'],
  );
  return json({
    items: result.rows.slice(0, limit).map(asset),
    nextCursor: result.rows.length > limit ? String(offset + limit) : null,
  });
}

async function serveAsset(
  request: Request,
  context: Pick<AssetContext, 'bucket'>,
  row: AssetRow,
  cacheControl = 'private, max-age=300',
) {
  const total = Number(row.byte_size),
    requested = request.headers.get('range');
  let range: { offset: number; length: number } | undefined;
  if (requested) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
    const end = match[1]
      ? match[2]
        ? Math.min(Number(match[2]), total - 1)
        : total - 1
      : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    range = { offset: start, length: end - start + 1 };
  }
  const object = await context.bucket.get(row.object_key, { range });
  if (!object) throw new AssetError(404, 'not_found', 'Asset file unavailable');
  const inline = row.mime_type.startsWith('image/') || row.mime_type.startsWith('video/');
  const headers = new Headers({
    'Content-Type': row.mime_type,
    ETag: object.httpEtag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
  });
  if (!range && matchesEtag(request, object.httpEtag)) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  let status = 200;
  if (range) {
    const start = range.offset;
    const length = range.length;
    headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else headers.set('Content-Length', String(object.size));
  if (request.method === 'HEAD') await object.body.cancel();
  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}

async function serveThumbnail(request: Request, context: AssetContext, id: string) {
  // Authorize before checking the edge cache; R2 originals and cached previews stay private.
  const row = await getAsset(context, id);
  const url = new URL(request.url);
  const width = Number(url.searchParams.get('width') ?? 320);
  assert([160, 320, 640, 1280].includes(width), 'Unsupported thumbnail width');
  if (!row.mime_type.startsWith('image/'))
    throw new AssetError(415, 'invalid', 'Thumbnails require an image');
  if (Number(row.byte_size) > 20 * 1024 * 1024)
    throw new AssetError(413, 'invalid', 'Image is too large for a thumbnail');
  if (!context.images) throw new AssetError(503, 'unavailable', 'Image processing is unavailable');
  const key = new Request(
    `${url.origin}/_private-thumbnails/${context.actor.spaceId}/${id}/v1/${width}.webp`,
  );
  let response = await context.cache?.match(key);
  if (!response) {
    const original = await context.bucket.get(row.object_key);
    if (!original) throw new AssetError(404, 'not_found', 'Asset file unavailable');
    const output = await context.images
      .input(original.body)
      .transform({ width, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 80, anim: false });
    response = output.response();
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    await context.cache?.put(key, response.clone());
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  if (request.method === 'HEAD') await response.body?.cancel();
  return new Response(request.method === 'HEAD' ? null : response.body, { headers });
}

function matchesEtag(request: Request, etag: string) {
  return (
    request.headers
      .get('if-none-match')
      ?.split(',')
      .some(
        (value) =>
          value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''),
      ) ?? false
  );
}

export async function handlePublicMedia(
  request: Request,
  params: { spaceId: string; assetId: string; kind: string },
  context: Pick<AssetContext, 'db' | 'bucket' | 'images' | 'cache'>,
): Promise<Response> {
  try {
    // Postgres UUID identity is case-insensitive; cache identity must be canonical too.
    const spaceId = params.spaceId.toLowerCase(),
      assetId = params.assetId.toLowerCase(),
      kind = params.kind;
    if (
      !uuid(spaceId) ||
      !uuid(assetId) ||
      !['original', 'image'].includes(kind) ||
      !['GET', 'HEAD'].includes(request.method)
    )
      throw new AssetError(404, 'not_found', 'Media not found');
    // Eligibility is checked before any edge hit, including conditional responses.
    if (!(await isPublishedAsset(context.db, spaceId, assetId, true)))
      throw new AssetError(404, 'not_found', 'Media not found');
    const row = (
      await context.db.query<AssetRow>('SELECT * FROM assets WHERE id=$1 AND space_id=$2', [
        assetId,
        spaceId,
      ])
    ).rows[0];
    if (!row) throw new AssetError(404, 'not_found', 'Media not found');
    const url = new URL(request.url);
    if (kind === 'original') {
      assert(!url.search, 'Original media does not accept image parameters');
      const response = await serveAsset(request, context, row, 'no-store');
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const options = imageOptions(url.searchParams);
    if (!row.mime_type.startsWith('image/'))
      throw new AssetError(415, 'invalid', 'Image transformations require an image');
    if (Number(row.byte_size) > 20 * 1024 * 1024)
      throw new AssetError(413, 'invalid', 'Image exceeds the 20 MiB transformation limit');
    if (!context.images)
      throw new AssetError(503, 'unavailable', 'Image processing is unavailable');
    const head = await context.bucket.head(row.object_key);
    if (!head) throw new AssetError(404, 'not_found', 'Media file unavailable');
    const identity = JSON.stringify([
      'v1',
      spaceId,
      assetId,
      head.httpEtag,
      row.metadata_revision,
      options,
    ]);
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const etag = `"${hash}"`;
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': options.format,
      ETag: etag,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    if (matchesEtag(request, etag)) return new Response(null, { status: 304, headers });
    const key = new Request(`${url.origin}/_media-variants/v1/${spaceId}/${assetId}/${hash}`);
    let response = await context.cache?.match(key);
    if (!response) {
      const original = await context.bucket.get(row.object_key);
      if (!original) throw new AssetError(404, 'not_found', 'Media file unavailable');
      try {
        const output = await context.images
          .input(original.body)
          .transform({
            width: options.width,
            height: options.height,
            fit: options.fit,
            ...(options.fit === 'cover'
              ? {
                  gravity: {
                    x: row.focal_x ?? 0.5,
                    y: row.focal_y ?? 0.5,
                    mode: 'remainder' as const,
                  },
                }
              : {}),
          })
          .output({ format: options.format, quality: options.quality, anim: false });
        response = output.response();
      } catch {
        throw new AssetError(
          422,
          'invalid',
          'This image cannot be transformed; the original remains available',
        );
      }
      if (!response.ok) throw new AssetError(503, 'unavailable', 'Image processing failed');
      response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      await context.cache?.put(key, response.clone());
    }
    const length = response.headers.get('Content-Length');
    if (length) headers.set('Content-Length', length);
    if (request.method === 'HEAD') await response.body?.cancel();
    return new Response(request.method === 'HEAD' ? null : response.body, { headers });
  } catch (error) {
    if (!(error instanceof AssetError))
      console.error('Public media unavailable', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    const response =
      error instanceof AssetError
        ? json({ error: { code: error.code, message: error.message } }, error.status)
        : json(
            { error: { code: 'unavailable', message: 'Media is temporarily unavailable' } },
            503,
          );
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
}

async function folders(request: Request, segments: string[], context: AssetContext) {
  const id = segments[1];
  if (request.method === 'GET' && !id) {
    const result = await context.db.query(
      'SELECT id,name,parent_id AS "parentId" FROM asset_folders WHERE space_id=$1 ORDER BY name,id',
      [context.actor.spaceId],
    );
    return json({ items: result.rows });
  }
  if (request.method === 'POST' && !id) {
    const input = await body(request),
      name = text(input.name, 'Folder name', 100);
    assert(name, 'Folder name required');
    const parent = await folder(context, input.parentId);
    assert(!parent?.parent_id, 'Folders support two levels');
    const result = await context.db.query(
      'INSERT INTO asset_folders(id,space_id,name,parent_id) VALUES($1,$2,$3,$4) RETURNING id,name,parent_id AS "parentId"',
      [crypto.randomUUID(), context.actor.spaceId, name, parent?.id ?? null],
    );
    return json(result.rows[0], 201);
  }
  if (id) {
    await folder(context, id);
    if (request.method === 'PATCH') {
      const input = await body(request),
        name = text(input.name, 'Folder name', 100);
      assert(name, 'Folder name required');
      await context.db.query('UPDATE asset_folders SET name=$1 WHERE id=$2 AND space_id=$3', [
        name,
        id,
        context.actor.spaceId,
      ]);
      return json({ updated: true });
    }
    if (request.method === 'DELETE') {
      await context.db.query('DELETE FROM asset_folders WHERE id=$1 AND space_id=$2', [
        id,
        context.actor.spaceId,
      ]);
      return json({ deleted: true });
    }
  }
  throw new AssetError(404, 'not_found', 'Asset route not found');
}

export async function handleAssets(
  request: Request,
  segments: string[],
  context: AssetContext,
): Promise<Response> {
  try {
    if (!context.actor.userId || !context.actor.spaceId)
      throw new AssetError(403, 'forbidden', 'Space access required');
    if (!['GET', 'HEAD'].includes(request.method) && !context.canWrite)
      throw new AssetError(403, 'forbidden', 'Your role cannot change assets');
    const [id, action, sub, part] = segments;
    if (id === 'folders') return await folders(request, segments, context);
    if (id === 'uploads') {
      if (!action && request.method === 'POST') return await startUpload(request, context);
      if (!action && request.method === 'GET') {
        const result = await context.db.query(
          'SELECT id,filename,mime_type AS "mimeType",expected_size AS "byteSize",metadata->\'lastModified\' AS "lastModified" FROM asset_uploads WHERE space_id=$1 AND user_id=$2 AND status=\'uploading\' ORDER BY created_at DESC LIMIT 20',
          [context.actor.spaceId, context.actor.userId],
        );
        return json({ items: result.rows });
      }
      if (action && !sub && request.method === 'GET') {
        const row = await getUpload(context, action);
        return json({
          id: row.id,
          assetId: row.asset_id,
          filename: row.filename,
          byteSize: Number(row.expected_size),
          mimeType: row.mime_type,
          parts: row.parts,
          status: row.status,
          partBytes: PART_BYTES,
        });
      }
      if (action && !sub && request.method === 'DELETE') return await cancelUpload(context, action);
      if (action && sub === 'parts' && part && request.method === 'PUT')
        return await uploadPart(request, context, action, part);
      if (action && sub === 'complete' && request.method === 'POST')
        return await completeUpload(context, action);
    }
    if (!id && request.method === 'GET') return await listAssets(request, context);
    if (id && action === 'content' && ['GET', 'HEAD'].includes(request.method))
      return await serveAsset(request, context, await getAsset(context, id));
    if (id && action === 'thumbnail' && ['GET', 'HEAD'].includes(request.method))
      return await serveThumbnail(request, context, id);
    if (id && id !== 'uploads') {
      const row = await getAsset(context, id);
      if (!action && request.method === 'GET') return json({ asset: asset(row) });
      if (!action && request.method === 'PATCH') {
        const input = await body(request);
        const client = await context.db.connect();
        try {
          await client.query('BEGIN');
          const current = await getAsset(context, id, client, true);
          if (
            input.metadataRevision !== undefined &&
            input.metadataRevision !== current.metadata_revision
          )
            throw new AssetError(
              409,
              'stale_revision',
              'Asset details changed. Reopen the asset before saving.',
            );
          const meta = metadata({ ...current, ...input });
          const point =
            input.focalPoint === undefined
              ? current.focal_x === null
                ? null
                : { x: current.focal_x, y: current.focal_y! }
              : focalPoint(input.focalPoint);
          assert(
            !point || current.mime_type.startsWith('image/'),
            'Only images support a focal point',
          );
          const result = await client.query<AssetRow>(
            `UPDATE assets SET title=$1,alt=$2,notes=$3,tags=$4,focal_x=$7,focal_y=$8,
              metadata_revision=metadata_revision+1,updated_at=now()
             WHERE id=$5 AND space_id=$6 AND
               (title,alt,notes,tags,focal_x,focal_y) IS DISTINCT FROM ($1,$2,$3,$4::jsonb,$7::float8,$8::float8)
             RETURNING *`,
            [
              meta.title,
              meta.alt,
              meta.notes,
              JSON.stringify(meta.tags),
              id,
              context.actor.spaceId,
              point?.x ?? null,
              point?.y ?? null,
            ],
          );
          const updated = result.rows[0] ?? current;
          if (result.rowCount)
            await recordWebhookEvent(client, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              type: 'asset.updated',
              key: `asset.updated:${id}:${updated.metadata_revision}`,
              data: { assetId: id, metadataRevision: updated.metadata_revision },
            });
          await client.query('COMMIT');
          return json({ asset: asset(updated) });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
      if (!action && request.method === 'DELETE') {
        await context.db.query(
          'UPDATE assets SET archived_at=coalesce(archived_at,now()),updated_at=now() WHERE id=$1 AND space_id=$2',
          [id, context.actor.spaceId],
        );
        return json({ archived: true });
      }
      if (action === 'folders') {
        const targetId = request.method === 'POST' ? (await body(request)).folderId : sub;
        const target = await folder(context, targetId);
        assert(target, 'Folder required');
        if (request.method === 'POST') {
          assert(!row.archived_at, 'Archived asset cannot be placed');
          await context.db.query(
            'INSERT INTO asset_folder_placements(asset_id,folder_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [id, target.id],
          );
          return json({ placed: true });
        }
        if (request.method === 'DELETE') {
          await context.db.query(
            'DELETE FROM asset_folder_placements WHERE asset_id=$1 AND folder_id=$2',
            [id, target.id],
          );
          return json({ removed: true });
        }
      }
    }
    throw new AssetError(404, 'not_found', 'Asset route not found');
  } catch (error) {
    if (error instanceof AssetError)
      return json({ error: { code: error.code, message: error.message } }, error.status);
    console.error('Asset request failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return json(
      {
        error: {
          code: 'unavailable',
          message: 'Asset operation failed. Your upload can be retried.',
        },
      },
      503,
    );
  }
}

/** Keep each space's original independent, including when a failed clone is retried. */
export async function copySchemaAsset(
  bucket: AssetContext['bucket'],
  asset: { object_key: string; id: string; byte_size: string; mime_type: string },
  destinationKey: string,
) {
  const existing = await bucket.head(destinationKey);
  if (existing) {
    if (existing.size !== Number(asset.byte_size))
      throw new AssetError(409, 'invalid', 'Copied media size differs from its source');
    return;
  }
  const original = await bucket.get(asset.object_key);
  if (!original || original.size !== Number(asset.byte_size))
    throw new AssetError(404, 'not_found', 'Required media original is unavailable');
  const upload = await bucket.createMultipartUpload(destinationKey, {
    httpMetadata: { contentType: asset.mime_type },
  });
  const reader = original.body.getReader();
  const parts: AssetPart[] = [];
  let pending = new Uint8Array(0);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.value) {
        const joined = new Uint8Array(pending.length + chunk.value.length);
        joined.set(pending);
        joined.set(chunk.value, pending.length);
        pending = joined;
      }
      while (pending.length >= PART_BYTES || (chunk.done && pending.length)) {
        const bytes = pending.slice(0, PART_BYTES);
        pending = pending.slice(bytes.length);
        parts.push(await upload.uploadPart(parts.length + 1, bytes.buffer));
      }
      if (chunk.done) break;
    }
    await upload.complete(parts);
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
