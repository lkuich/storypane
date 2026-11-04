import type { Pool, PoolClient } from 'pg';
import {
  StorypaneError,
  canonicalJson,
  parseInput,
  webhookEventInputSchema,
  webhookInputSchema,
  webhookRevisionSchema,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookEventInput,
} from '@storypane/core';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  newWebhookSecret,
  sendWebhook,
  validateWebhookUrl,
  webhookEncryptionConfigured,
  type WebhookTransportOptions,
} from './webhook-transport.js';

export type WebhookOptions = { encryptionKey?: string; allowedHosts: string[] };
type EndpointRow = {
  id: string;
  space_id: string;
  name: string;
  url: string;
  events: WebhookEndpoint['events'];
  enabled: boolean;
  revision: number;
  encrypted_secret: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};
const endpointView = (row: EndpointRow): WebhookEndpoint => ({
  id: row.id,
  name: row.name,
  url: row.url,
  events: row.events,
  enabled: row.enabled,
  revision: row.revision,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const endpointColumns =
  'id,space_id,name,url,events,enabled,revision,created_at,updated_at,deleted_at';
function requireKey(options: WebhookOptions): string {
  if (!webhookEncryptionConfigured(options.encryptionKey))
    throw new StorypaneError('unavailable', 'Webhook encryption is not configured');
  return options.encryptionKey!;
}

export async function recordWebhookEvent(
  client: PoolClient,
  raw: WebhookEventInput,
): Promise<void> {
  const input = parseInput(webhookEventInputSchema, raw);
  const event: WebhookEvent = {
    version: 1,
    id: crypto.randomUUID(),
    type: input.type,
    occurredAt: new Date().toISOString(),
    spaceId: input.spaceId,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    data: input.data,
  };
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO webhook_events(id,space_id,event_key,event_type,payload)
     SELECT $1,$2,$3,$4,$5 WHERE EXISTS (
       SELECT 1 FROM webhook_endpoints WHERE space_id=$2 AND enabled AND deleted_at IS NULL AND $4=ANY(events))
     ON CONFLICT(space_id,event_key) DO NOTHING RETURNING id`,
    [event.id, input.spaceId, input.key, input.type, JSON.stringify(event)],
  );
  if (!inserted.rowCount) {
    const existing = (
      await client.query<{ payload: string }>(
        'SELECT payload FROM webhook_events WHERE space_id=$1 AND event_key=$2',
        [input.spaceId, input.key],
      )
    ).rows[0];
    if (existing) {
      const previous = JSON.parse(existing.payload) as WebhookEvent;
      if (
        canonicalJson({
          type: previous.type,
          actorId: previous.actorId ?? null,
          data: previous.data,
        }) !== canonicalJson({ type: input.type, actorId: input.actorId ?? null, data: input.data })
      )
        throw new StorypaneError('invalid', 'Webhook event key was reused for different data');
    }
    return;
  }
  await client.query(
    `INSERT INTO webhook_deliveries(space_id,endpoint_id,event_id,endpoint_revision)
     SELECT space_id,id,$2,revision FROM webhook_endpoints
     WHERE space_id=$1 AND enabled AND deleted_at IS NULL AND $3=ANY(events)`,
    [input.spaceId, event.id, input.type],
  );
}

export async function listWebhooks(client: PoolClient, spaceId: string, options: WebhookOptions) {
  return {
    configured: webhookEncryptionConfigured(options.encryptionKey),
    endpoints: (
      await client.query<EndpointRow>(
        `SELECT ${endpointColumns} FROM webhook_endpoints WHERE space_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`,
        [spaceId],
      )
    ).rows.map(endpointView),
  };
}
async function lockEndpoint(client: PoolClient, spaceId: string, id: string): Promise<EndpointRow> {
  const row = (
    await client.query<EndpointRow>(
      'SELECT * FROM webhook_endpoints WHERE space_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
      [spaceId, id],
    )
  ).rows[0];
  if (!row) throw new StorypaneError('not_found', 'Webhook not found');
  return row;
}
function checkRevision(row: EndpointRow, expected: number | undefined) {
  if (row.revision !== expected)
    throw new StorypaneError('stale_revision', 'Webhook settings changed; reload before saving');
}
async function cancelQueued(client: PoolClient, endpointId: string) {
  await client.query(
    `UPDATE webhook_deliveries SET status='cancelled',error='Webhook configuration changed',completed_at=clock_timestamp(),claim_token=NULL,claim_expires_at=NULL
     WHERE endpoint_id=$1 AND status IN ('pending','delivering')`,
    [endpointId],
  );
  await client.query(
    `UPDATE webhook_attempts a SET completed_at=clock_timestamp(),error='Webhook configuration changed'
     FROM webhook_deliveries d WHERE a.delivery_id=d.id AND d.endpoint_id=$1 AND a.completed_at IS NULL`,
    [endpointId],
  );
}
export async function saveWebhook(
  client: PoolClient,
  spaceId: string,
  raw: unknown,
  options: WebhookOptions,
  id?: string,
) {
  const input = parseInput(webhookInputSchema, raw),
    encryptionKey = requireKey(options);
  const url = validateWebhookUrl(input.url, options.allowedHosts).toString();
  if (id) {
    const row = await lockEndpoint(client, spaceId, id);
    checkRevision(row, input.expectedRevision);
    const changed =
      row.name !== input.name ||
      row.url !== url ||
      row.enabled !== input.enabled ||
      canonicalJson([...row.events].sort()) !== canonicalJson([...input.events].sort());
    if (changed) await cancelQueued(client, id);
    const updated = (
      await client.query<EndpointRow>(
        `UPDATE webhook_endpoints SET name=$3,url=$4,events=$5,enabled=$6,revision=revision+$7,updated_at=clock_timestamp()
       WHERE space_id=$1 AND id=$2 RETURNING ${endpointColumns}`,
        [spaceId, id, input.name, url, input.events, input.enabled, changed ? 1 : 0],
      )
    ).rows[0];
    return { endpoint: endpointView(updated) };
  }
  const count = await client.query(
    'SELECT id FROM webhook_endpoints WHERE space_id=$1 AND deleted_at IS NULL',
    [spaceId],
  );
  if ((count.rowCount ?? 0) >= 20)
    throw new StorypaneError('invalid', 'A space supports at most 20 webhook endpoints');
  const endpointId = crypto.randomUUID(),
    secret = newWebhookSecret();
  const encrypted = await encryptWebhookSecret(secret, encryptionKey, spaceId + ':' + endpointId);
  const row = (
    await client.query<EndpointRow>(
      `INSERT INTO webhook_endpoints(id,space_id,name,url,events,enabled,encrypted_secret) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${endpointColumns}`,
      [endpointId, spaceId, input.name, url, input.events, input.enabled, encrypted],
    )
  ).rows[0];
  return { endpoint: endpointView(row), secret };
}
export async function rotateWebhookSecret(
  client: PoolClient,
  spaceId: string,
  id: string,
  raw: unknown,
  options: WebhookOptions,
) {
  const { expectedRevision } = parseInput(webhookRevisionSchema, raw),
    key = requireKey(options);
  const row = await lockEndpoint(client, spaceId, id);
  checkRevision(row, expectedRevision);
  const secret = newWebhookSecret(),
    encrypted = await encryptWebhookSecret(secret, key, spaceId + ':' + id);
  await cancelQueued(client, id);
  const updated = (
    await client.query<EndpointRow>(
      `UPDATE webhook_endpoints SET encrypted_secret=$3,revision=revision+1,updated_at=clock_timestamp() WHERE space_id=$1 AND id=$2 RETURNING ${endpointColumns}`,
      [spaceId, id, encrypted],
    )
  ).rows[0];
  return { endpoint: endpointView(updated), secret };
}
export async function deleteWebhook(client: PoolClient, spaceId: string, id: string, raw: unknown) {
  const { expectedRevision } = parseInput(webhookRevisionSchema, raw);
  const row = await lockEndpoint(client, spaceId, id);
  checkRevision(row, expectedRevision);
  await cancelQueued(client, id);
  await client.query(
    'UPDATE webhook_endpoints SET enabled=false,deleted_at=clock_timestamp(),revision=revision+1 WHERE space_id=$1 AND id=$2',
    [spaceId, id],
  );
}
export async function testWebhook(
  client: PoolClient,
  spaceId: string,
  id: string,
  actorId: string,
  options: WebhookOptions,
) {
  requireKey(options);
  const row = await lockEndpoint(client, spaceId, id);
  if (!row.enabled) throw new StorypaneError('invalid', 'Enable the webhook before sending a test');
  const event: WebhookEvent = {
    version: 1,
    id: crypto.randomUUID(),
    type: 'webhook.test',
    occurredAt: new Date().toISOString(),
    spaceId,
    actorId,
    data: {},
  };
  await client.query(
    'INSERT INTO webhook_events(id,space_id,event_key,event_type,payload) VALUES($1,$2,$3,$4,$5)',
    [event.id, spaceId, 'test:' + event.id, event.type, JSON.stringify(event)],
  );
  const delivery = await client.query<{ id: string }>(
    'INSERT INTO webhook_deliveries(space_id,endpoint_id,event_id,endpoint_revision) VALUES($1,$2,$3,$4) RETURNING id',
    [spaceId, id, event.id, row.revision],
  );
  return { deliveryId: delivery.rows[0].id, eventId: event.id };
}
export async function retryWebhook(
  client: PoolClient,
  spaceId: string,
  endpointId: string,
  deliveryId: string,
  options: WebhookOptions,
) {
  requireKey(options);
  const endpoint = await lockEndpoint(client, spaceId, endpointId);
  if (!endpoint.enabled) throw new StorypaneError('invalid', 'Enable the webhook before retrying');
  const result = await client.query(
    `UPDATE webhook_deliveries SET status='pending',endpoint_revision=$4,retry_start=attempt_count,next_attempt_at=clock_timestamp(),completed_at=NULL,
     error=NULL,http_status=NULL,claim_token=NULL,claim_expires_at=NULL
     WHERE space_id=$1 AND endpoint_id=$2 AND id=$3 AND status IN ('failed','cancelled') RETURNING id`,
    [spaceId, endpointId, deliveryId, endpoint.revision],
  );
  if (!result.rowCount)
    throw new StorypaneError('invalid', 'Select a failed or cancelled delivery in this webhook');
}
export async function listWebhookDeliveries(
  client: PoolClient,
  spaceId: string,
  endpointId: string,
  offset: number,
): Promise<{ deliveries: WebhookDelivery[]; nextOffset: number | null }> {
  await lockEndpoint(client, spaceId, endpointId);
  const { rows } = await client.query<{
    id: string;
    event_id: string;
    event_type: WebhookEvent['type'];
    status: WebhookDelivery['status'];
    attempt_count: number;
    next_attempt_at: Date;
    created_at: Date;
    completed_at: Date | null;
    http_status: number | null;
    error: string | null;
    endpoint_revision: number;
    attempts: WebhookDelivery['attempts'];
  }>(
    `SELECT d.*,e.event_type,coalesce((SELECT jsonb_agg(jsonb_build_object('number',a.number,'startedAt',a.started_at,'completedAt',a.completed_at,'httpStatus',a.http_status,'error',a.error) ORDER BY a.number)
       FROM webhook_attempts a WHERE a.delivery_id=d.id),'[]') AS attempts
     FROM webhook_deliveries d JOIN webhook_events e ON e.id=d.event_id WHERE d.space_id=$1 AND d.endpoint_id=$2 ORDER BY d.created_at DESC,d.id DESC LIMIT 51 OFFSET $3`,
    [spaceId, endpointId, offset],
  );
  return {
    deliveries: rows.slice(0, 50).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      type: row.event_type,
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
      httpStatus: row.http_status,
      error: row.error,
      endpointRevision: row.endpoint_revision,
      attempts: row.attempts,
    })),
    nextOffset: rows.length > 50 ? offset + 50 : null,
  };
}

type Claim = {
  id: string;
  space_id: string;
  endpoint_id: string;
  event_id: string;
  endpoint_revision: number;
  attempt_count: number;
  retry_start: number;
  claim_token: string;
  payload: string;
};
async function claimDelivery(pool: Pool): Promise<Claim | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (
      await client.query<Claim>(
        `SELECT d.*,e.payload FROM webhook_deliveries d JOIN webhook_events e ON e.id=d.event_id
       WHERE (d.status='pending' AND d.next_attempt_at<=clock_timestamp()) OR (d.status='delivering' AND d.claim_expires_at<=clock_timestamp())
       ORDER BY d.next_attempt_at,d.created_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
      )
    ).rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    if (row.attempt_count - row.retry_start >= 5) {
      await client.query(
        "UPDATE webhook_deliveries SET status='failed',error='Delivery retry limit reached after an interrupted attempt',completed_at=clock_timestamp(),claim_token=NULL,claim_expires_at=NULL WHERE id=$1",
        [row.id],
      );
      await client.query(
        "UPDATE webhook_attempts SET completed_at=clock_timestamp(),error='Delivery interrupted before its result was recorded' WHERE delivery_id=$1 AND completed_at IS NULL",
        [row.id],
      );
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      "UPDATE webhook_attempts SET completed_at=clock_timestamp(),error='Delivery interrupted before its result was recorded' WHERE delivery_id=$1 AND completed_at IS NULL",
      [row.id],
    );
    row.claim_token = crypto.randomUUID();
    row.attempt_count += 1;
    await client.query(
      "UPDATE webhook_deliveries SET status='delivering',attempt_count=$2,claim_token=$3,claim_expires_at=clock_timestamp()+interval '60 seconds' WHERE id=$1",
      [row.id, row.attempt_count, row.claim_token],
    );
    await client.query(
      'INSERT INTO webhook_attempts(delivery_id,number,claim_token) VALUES($1,$2,$3)',
      [row.id, row.attempt_count, row.claim_token],
    );
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
const retryDelays = [60_000, 300_000, 900_000, 3_600_000];
export async function dispatchWebhooks(
  pool: Pool,
  options: WebhookOptions & Omit<WebhookTransportOptions, 'allowedHosts'>,
  limit = 25,
): Promise<{ attempted: number }> {
  if (!webhookEncryptionConfigured(options.encryptionKey)) {
    await cleanupWebhookHistory(pool);
    return { attempted: 0 };
  }
  let attempted = 0;
  for (let index = 0; index < Math.min(Math.max(limit, 0), 100); index++) {
    const claim = await claimDelivery(pool);
    if (!claim) break;
    const endpoint = (
      await pool.query<EndpointRow>(
        `SELECT w.* FROM webhook_endpoints w JOIN webhook_deliveries d ON d.endpoint_id=w.id
       WHERE d.id=$1 AND d.claim_token=$2 AND d.status='delivering' AND d.claim_expires_at>clock_timestamp() AND w.enabled AND w.deleted_at IS NULL AND w.revision=d.endpoint_revision`,
        [claim.id, claim.claim_token],
      )
    ).rows[0];
    if (!endpoint) {
      await pool.query(
        "UPDATE webhook_deliveries SET status='cancelled',error='Webhook configuration changed',completed_at=clock_timestamp(),claim_token=NULL,claim_expires_at=NULL WHERE id=$1 AND claim_token=$2 AND claim_expires_at>clock_timestamp()",
        [claim.id, claim.claim_token],
      );
      continue;
    }
    let result;
    try {
      const secret = await decryptWebhookSecret(
        endpoint.encrypted_secret,
        options.encryptionKey!,
        claim.space_id + ':' + claim.endpoint_id,
      );
      // Recheck after decrypting: disabled/revised endpoints cannot start another attempt.
      const current = await pool.query(
        "SELECT 1 FROM webhook_endpoints w JOIN webhook_deliveries d ON d.endpoint_id=w.id WHERE d.id=$1 AND d.claim_token=$2 AND d.status='delivering' AND d.claim_expires_at>clock_timestamp() AND w.enabled AND w.deleted_at IS NULL AND w.revision=d.endpoint_revision",
        [claim.id, claim.claim_token],
      );
      if (!current.rowCount) continue;
      result = await sendWebhook(
        { url: endpoint.url, secret },
        { id: claim.event_id, body: claim.payload },
        {
          ...options,
          beforeSend: async () =>
            !!(
              await pool.query(
                "SELECT 1 FROM webhook_endpoints w JOIN webhook_deliveries d ON d.endpoint_id=w.id WHERE d.id=$1 AND d.claim_token=$2 AND d.status='delivering' AND d.claim_expires_at>clock_timestamp() AND w.enabled AND w.deleted_at IS NULL AND w.revision=d.endpoint_revision",
                [claim.id, claim.claim_token],
              )
            ).rowCount,
        },
      );
    } catch {
      result = {
        httpStatus: null,
        error: 'Webhook secret could not be decrypted; check the configured encryption key',
        retryable: false,
      };
    }
    attempted++;
    const attempt = claim.attempt_count - claim.retry_start;
    const retry = result.error !== null && result.retryable && attempt < 5;
    const delay = retry ? Math.max(retryDelays[attempt - 1], result.retryAfterMs ?? 0) : 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE webhook_deliveries SET status=$3,http_status=$4,error=$5,next_attempt_at=clock_timestamp()+($6*interval '1 millisecond'),
         completed_at=CASE WHEN $3='pending' THEN NULL ELSE clock_timestamp() END,claim_token=NULL,claim_expires_at=NULL
         WHERE id=$1 AND claim_token=$2 AND status='delivering' AND claim_expires_at>clock_timestamp() RETURNING id`,
        [
          claim.id,
          claim.claim_token,
          result.error === null ? 'succeeded' : retry ? 'pending' : 'failed',
          result.httpStatus,
          result.error,
          delay,
        ],
      );
      if (updated.rowCount)
        await client.query(
          'UPDATE webhook_attempts SET completed_at=clock_timestamp(),http_status=$3,error=$4 WHERE delivery_id=$1 AND claim_token=$2',
          [claim.id, claim.claim_token, result.httpStatus, result.error],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await cleanupWebhookHistory(pool);
  return { attempted };
}
async function cleanupWebhookHistory(pool: Pool) {
  await pool.query(
    "DELETE FROM webhook_deliveries WHERE status IN ('succeeded','failed','cancelled') AND completed_at<clock_timestamp()-interval '30 days'",
  );
  await pool.query(
    "DELETE FROM webhook_events e WHERE created_at<clock_timestamp()-interval '30 days' AND NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id=e.id)",
  );
}
