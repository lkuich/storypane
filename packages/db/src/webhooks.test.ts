import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, WebhookEvent, WebhookEventInput } from '@storypane/core';
import { definitionInput, webhookEventTypes } from '@storypane/core';
import { migrate } from './migrate.js';
import { StorypaneStore } from './store.js';
import { dispatchWebhooks, recordWebhookEvent } from './webhooks.js';
import { verifyWebhookSignature } from './webhook-transport.js';
import { createRebuildReceiver } from '../../../scripts/webhook-rebuild.js';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
)
  throw new Error('Webhook tests require dedicated local test database');
const schemaName = 'webhooks_test_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName},public`,
  max: 8,
});
const encryptionKey = Buffer.alloc(32, 9).toString('base64');
const allowedHosts = ['hooks.example.com'];
const options = { encryptionKey, allowedHosts, resolve: async () => ['8.8.8.8'] };
const store = new StorypaneStore(pool, {
  webhookHosts: allowedHosts,
  webhookEncryptionKey: encryptionKey,
});
const input = {
  name: 'Build site',
  url: 'https://hooks.example.com/rebuild',
  events: [...webhookEventTypes],
  enabled: true,
};
let alice: Actor, bob: Actor;
async function tx<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
const eventInput = (): WebhookEventInput => ({
  spaceId: alice.spaceId,
  actorId: alice.userId,
  key: randomUUID(),
  type: 'story.published',
  data: {
    storyId: randomUUID(),
    localeId: randomUUID(),
    publicationId: randomUUID(),
    path: 'home',
  },
});
const emit = async (event = eventInput()) => tx((client) => recordWebhookEvent(client, event));
async function firstDelivery(endpointId: string) {
  return (await store.listWebhookDeliveries(alice, endpointId)).deliveries[0];
}
async function due() {
  await pool.query(
    "UPDATE webhook_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE status='pending'",
  );
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await migrate(pool);
  await pool.query(
    `INSERT INTO "user"(id,name,email) VALUES('alice','Alice','alice@test.local'),('bob','Bob','bob@test.local')`,
  );
  await pool.query(
    `INSERT INTO cms_sessions VALUES('alice-session','alice',now()+interval '1 hour'),('bob-session','bob',now()+interval '1 hour')`,
  );
});
beforeEach(async () => {
  await pool.query('TRUNCATE spaces CASCADE');
  alice = { userId: 'alice', sessionId: 'alice-session', spaceId: randomUUID(), role: 'admin' };
  bob = { userId: 'bob', sessionId: 'bob-session', spaceId: alice.spaceId, role: 'editor' };
  await store.seed(alice);
  await pool.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,'bob','editor')", [
    alice.spaceId,
  ]);
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
  await admin.end();
});

describe('transactional webhook configuration and events', () => {
  it('requires admin access and isolates configuration, secrets, logs, tests and retries by space', async () => {
    const created = await store.saveWebhook(alice, input);
    const id = created.endpoint.id;
    const queued = await store.testWebhook(alice, id);
    const operations = (actor: Actor) => [
      () => store.listWebhooks(actor),
      () => store.saveWebhook(actor, input),
      () => store.saveWebhook(actor, { ...input, expectedRevision: 1 }, id),
      () => store.rotateWebhookSecret(actor, id, { expectedRevision: 1 }),
      () => store.deleteWebhook(actor, id, { expectedRevision: 1 }),
      () => store.testWebhook(actor, id),
      () => store.retryWebhook(actor, id, queued.deliveryId),
      () => store.listWebhookDeliveries(actor, id),
    ];
    for (const operation of operations({ ...bob, role: 'admin' }))
      await expect(operation()).rejects.toMatchObject({ code: 'forbidden' });
    const another = await store.createSpace(alice, { name: 'Other space' });
    const outsider = { ...alice, spaceId: another.id };
    expect((await store.listWebhooks(outsider)).endpoints).toEqual([]);
    for (const operation of operations(outsider).slice(2))
      await expect(operation()).rejects.toMatchObject({ code: 'not_found' });
    const settings = JSON.stringify(await store.listWebhooks(alice));
    const ciphertext = (
      await pool.query('SELECT encrypted_secret FROM webhook_endpoints WHERE id=$1', [id])
    ).rows[0].encrypted_secret;
    expect(created.secret).toMatch(/^whsec_/);
    expect(ciphertext).not.toContain(created.secret);
    for (const output of [settings, JSON.stringify(await store.listWebhookDeliveries(alice, id))]) {
      expect(output).not.toContain(created.secret);
      expect(output).not.toContain(ciphertext);
      expect(output).not.toContain(encryptionKey);
    }
  });
  it('rolls back mutation events, commits immutable payloads, and deduplicates logical event keys', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    const event = eventInput();
    await expect(
      tx(async (client) => {
        await client.query('UPDATE spaces SET name=$2 WHERE id=$1', [alice.spaceId, 'Rolled back']);
        await recordWebhookEvent(client, event);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await pool.query('SELECT * FROM webhook_events')).rowCount).toBe(0);
    await emit(event);
    await emit(event);
    const committed = (await pool.query('SELECT payload FROM webhook_events')).rows[0].payload;
    expect((await store.listWebhookDeliveries(alice, endpoint.id)).deliveries).toHaveLength(1);
    await expect(
      emit({ ...event, data: { ...event.data, path: 'changed' } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect((await pool.query('SELECT payload FROM webhook_events')).rows[0].payload).toBe(
      committed,
    );
    expect(JSON.parse(committed)).toMatchObject({
      type: 'story.published',
      spaceId: alice.spaceId,
      data: event.data,
    });
  });
  it('records only subscribed transitions and treats repeated configuration as a no-op', async () => {
    const { endpoint } = await store.saveWebhook(alice, { ...input, events: ['story.published'] });
    await emit({ ...eventInput(), type: 'story.saved' });
    expect((await pool.query('SELECT * FROM webhook_events')).rowCount).toBe(0);
    await emit();
    const unchanged = await store.saveWebhook(
      alice,
      { ...input, events: ['story.published'], expectedRevision: 1 },
      endpoint.id,
    );
    expect(unchanged.endpoint.revision).toBe(1);
    expect((await firstDelivery(endpoint.id)).status).toBe('pending');
    await expect(
      store.saveWebhook(alice, { ...input, expectedRevision: 2 }, endpoint.id),
    ).rejects.toMatchObject({ code: 'stale_revision' });
  });
  it('disables configuration and sending without a valid encryption key', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    const unconfigured = new StorypaneStore(pool, { webhookHosts: allowedHosts });
    expect((await unconfigured.listWebhooks(alice)).configured).toBe(false);
    await expect(unconfigured.saveWebhook(alice, input)).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(unconfigured.testWebhook(alice, endpoint.id)).rejects.toMatchObject({
      code: 'unavailable',
    });
    const send = vi.fn<typeof fetch>();
    expect(
      await dispatchWebhooks(pool, { ...options, encryptionKey: undefined, fetch: send }),
    ).toEqual({ attempted: 0 });
    expect(send).not.toHaveBeenCalled();
    expect((await firstDelivery(endpoint.id)).attemptCount).toBe(0);
  });
});

describe('durable dispatcher and claim fencing', () => {
  it('claims once across concurrent workers and does HTTP outside its transaction', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    let started!: () => void, finish!: () => void;
    const arrived = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const send = vi.fn<typeof fetch>(async () => {
      started();
      await blocked;
      return new Response(null, { status: 204 });
    });
    const worker = dispatchWebhooks(pool, { ...options, fetch: send });
    await arrived;
    expect((await firstDelivery(endpoint.id)).status).toBe('delivering');
    expect(await dispatchWebhooks(pool, { ...options, fetch: send })).toEqual({ attempted: 0 });
    finish();
    await worker;
    expect(send).toHaveBeenCalledOnce();
    expect(await firstDelivery(endpoint.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
    });
  });
  it('recovers an expired claim and ignores the obsolete worker response', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    const bodies: string[] = [],
      ids: string[] = [];
    await dispatchWebhooks(pool, {
      ...options,
      fetch: async (_url, init) => {
        bodies.push(String(init?.body));
        ids.push(new Headers(init?.headers).get('webhook-id')!);
        await pool.query(
          "UPDATE webhook_deliveries SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE endpoint_id=$1",
          [endpoint.id],
        );
        await dispatchWebhooks(pool, {
          ...options,
          fetch: async (_newUrl, next) => {
            bodies.push(String(next?.body));
            ids.push(new Headers(next?.headers).get('webhook-id')!);
            return new Response(null, { status: 204 });
          },
        });
        return new Response(null, { status: 500 });
      },
    });
    const delivery = await firstDelivery(endpoint.id);
    expect(delivery).toMatchObject({ status: 'succeeded', attemptCount: 2, httpStatus: 204 });
    expect(delivery.attempts[0].error).toContain('interrupted');
    expect(delivery.attempts[1].error).toBeNull();
    expect(new Set(ids).size).toBe(1);
    expect(new Set(bodies).size).toBe(1);
  });
  it('retries lost responses with stable event IDs, bounded backoff and five total attempts', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    const ids: string[] = [];
    const send: typeof fetch = async (_url, init) => {
      ids.push(new Headers(init?.headers).get('webhook-id')!);
      throw new Error('receiver accepted but response lost');
    };
    for (const [index, delay] of [60_000, 300_000, 900_000, 3_600_000, 0].entries()) {
      const before = Number(
        (await pool.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now,
      );
      await dispatchWebhooks(pool, { ...options, fetch: send });
      const delivery = await firstDelivery(endpoint.id);
      expect(delivery.attemptCount).toBe(index + 1);
      expect(delivery.status).toBe(index === 4 ? 'failed' : 'pending');
      expect(Date.parse(delivery.nextAttemptAt)).toBeGreaterThanOrEqual(before + delay - 100);
      expect(Date.parse(delivery.nextAttemptAt)).toBeLessThan(Date.now() + delay + 100);
      await due();
    }
    expect(new Set(ids).size).toBe(1);
    expect(await dispatchWebhooks(pool, { ...options, fetch: send })).toEqual({ attempted: 0 });
    const failed = await firstDelivery(endpoint.id);
    await store.retryWebhook(alice, endpoint.id, failed.id);
    await dispatchWebhooks(pool, {
      ...options,
      fetch: async () => new Response(null, { status: 202 }),
    });
    expect(await firstDelivery(endpoint.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 6,
      eventId: failed.eventId,
    });
  });
  it('honors Retry-After and terminal client failures', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    const before = Number(
      (await pool.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now,
    );
    await dispatchWebhooks(pool, {
      ...options,
      fetch: async () => new Response(null, { status: 429, headers: { 'Retry-After': '7200' } }),
    });
    expect(Date.parse((await firstDelivery(endpoint.id)).nextAttemptAt)).toBeGreaterThanOrEqual(
      before + 7_200_000 - 10,
    );
    await due();
    await dispatchWebhooks(pool, {
      ...options,
      fetch: async () => new Response(null, { status: 401 }),
    });
    expect(await firstDelivery(endpoint.id)).toMatchObject({
      status: 'failed',
      attemptCount: 2,
      httpStatus: 401,
    });
  });
  it('cancels and fences configuration changed during DNS preflight', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    const send = vi.fn<typeof fetch>();
    await dispatchWebhooks(pool, {
      ...options,
      fetch: send,
      resolve: async () => {
        await store.saveWebhook(
          alice,
          { ...input, enabled: false, expectedRevision: 1 },
          endpoint.id,
        );
        return ['8.8.8.8'];
      },
    });
    expect(send).not.toHaveBeenCalled();
    const delivery = await firstDelivery(endpoint.id);
    expect(delivery.status).toBe('cancelled');
    expect(delivery.attempts[0].completedAt).not.toBeNull();
    await expect(store.retryWebhook(alice, endpoint.id, delivery.id)).rejects.toMatchObject({
      code: 'invalid',
    });
  });
  it('rotation cancels queued work; manual retry uses the new secret and revision', async () => {
    const created = await store.saveWebhook(alice, input);
    await emit();
    const rotated = await store.rotateWebhookSecret(alice, created.endpoint.id, {
      expectedRevision: 1,
    });
    expect(rotated.secret).not.toBe(created.secret);
    const delivery = await firstDelivery(created.endpoint.id);
    expect(delivery.status).toBe('cancelled');
    await store.retryWebhook(alice, created.endpoint.id, delivery.id);
    await dispatchWebhooks(pool, {
      ...options,
      fetch: async (_url, init) => {
        const headers = new Headers(init?.headers);
        expect(
          await verifyWebhookSignature(
            rotated.secret,
            headers.get('webhook-timestamp')!,
            String(init?.body),
            headers.get('webhook-signature')!,
          ),
        ).toBe(true);
        expect(
          await verifyWebhookSignature(
            created.secret!,
            headers.get('webhook-timestamp')!,
            String(init?.body),
            headers.get('webhook-signature')!,
          ),
        ).toBe(false);
        return new Response(null, { status: 204 });
      },
    });
    expect(await firstDelivery(created.endpoint.id)).toMatchObject({
      status: 'succeeded',
      endpointRevision: 2,
      eventId: delivery.eventId,
    });
    await store.deleteWebhook(alice, created.endpoint.id, { expectedRevision: 2 });
    expect((await store.listWebhooks(alice)).endpoints).toEqual([]);
    await expect(store.testWebhook(alice, created.endpoint.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('retains encrypted endpoints and event identity after a wrong key, then recovers with the original key', async () => {
    const { endpoint, secret } = await store.saveWebhook(alice, input);
    await emit();
    const original = await firstDelivery(endpoint.id);
    const send = vi.fn<typeof fetch>();
    await dispatchWebhooks(pool, {
      ...options,
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      fetch: send,
    });
    expect(send).not.toHaveBeenCalled();
    const failed = await firstDelivery(endpoint.id);
    expect(failed).toMatchObject({
      id: original.id,
      eventId: original.eventId,
      status: 'failed',
      attemptCount: 1,
    });
    expect(failed.error).toContain('could not be decrypted');
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(JSON.stringify(failed)).not.toContain(encryptionKey);
    await store.retryWebhook(alice, endpoint.id, failed.id);
    await dispatchWebhooks(pool, {
      ...options,
      fetch: async (_url, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('webhook-id')).toBe(original.eventId);
        expect(
          await verifyWebhookSignature(
            secret!,
            headers.get('webhook-timestamp')!,
            String(init?.body),
            headers.get('webhook-signature')!,
          ),
        ).toBe(true);
        return new Response(null, { status: 204 });
      },
    });
    expect(await firstDelivery(endpoint.id)).toMatchObject({
      id: original.id,
      eventId: original.eventId,
      status: 'succeeded',
      attemptCount: 2,
    });
  });

  it('continues the batch after exhausting an interrupted delivery', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    const exhausted = await firstDelivery(endpoint.id);
    const token = randomUUID();
    await pool.query(
      "UPDATE webhook_deliveries SET status='delivering',attempt_count=5,claim_token=$2,claim_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [exhausted.id, token],
    );
    await pool.query(
      'INSERT INTO webhook_attempts(delivery_id,number,claim_token) VALUES($1,5,$2)',
      [exhausted.id, token],
    );
    await emit();
    const pending = await firstDelivery(endpoint.id);
    expect(pending.id).not.toBe(exhausted.id);
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    expect(await dispatchWebhooks(pool, { ...options, fetch: send })).toEqual({ attempted: 1 });
    const deliveries = (await store.listWebhookDeliveries(alice, endpoint.id)).deliveries;
    expect(deliveries.find((delivery) => delivery.id === exhausted.id)).toMatchObject({
      status: 'failed',
      attemptCount: 5,
    });
    expect(deliveries.find((delivery) => delivery.id === pending.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('marks a crashed fifth attempt terminal and keeps history bounded without dropping pending work', async () => {
    const { endpoint } = await store.saveWebhook(alice, input);
    await emit();
    const delivery = await firstDelivery(endpoint.id);
    const token = randomUUID();
    await pool.query(
      "UPDATE webhook_deliveries SET status='delivering',attempt_count=5,claim_token=$2,claim_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [delivery.id, token],
    );
    await pool.query(
      'INSERT INTO webhook_attempts(delivery_id,number,claim_token) VALUES($1,5,$2)',
      [delivery.id, token],
    );
    const send = vi.fn<typeof fetch>();
    await dispatchWebhooks(pool, { ...options, fetch: send });
    expect(send).not.toHaveBeenCalled();
    expect((await firstDelivery(endpoint.id)).status).toBe('failed');
    await pool.query(
      "UPDATE webhook_deliveries SET completed_at=clock_timestamp()-interval '31 days'",
    );
    await emit();
    await pool.query("UPDATE webhook_events SET created_at=clock_timestamp()-interval '31 days'");
    await pool.query(
      "UPDATE webhook_deliveries SET created_at=clock_timestamp()-interval '31 days' WHERE status='pending'",
    );
    await dispatchWebhooks(pool, options, 0);
    expect((await pool.query('SELECT * FROM webhook_deliveries')).rows).toMatchObject([
      { status: 'pending' },
    ]);
    expect((await pool.query('SELECT * FROM webhook_events')).rowCount).toBe(1);
    expect((await pool.query('SELECT * FROM webhook_attempts')).rowCount).toBe(0);
  });
});

describe('content hooks', () => {
  it('records path changes once without changing the live publication', async () => {
    await store.saveWebhook(alice, input);
    const story = (await store.listStories(alice))[0];
    const locale = (await store.listLocales(alice, story.id))[0];
    const before = await store.getSnapshot(alice, story.id, locale.id);
    const target = { folderId: null, slug: 'new-path', localeSlugs: {} };
    await store.updateStoryLocation(alice, story.id, target);
    await store.updateStoryLocation(alice, story.id, target);
    const after = await store.getSnapshot(alice, story.id, locale.id);
    const events = (
      await pool.query('SELECT event_type,payload FROM webhook_events ORDER BY event_type')
    ).rows;
    expect(events.map((row) => row.event_type)).toEqual(['story.moved', 'story.saved']);
    expect(JSON.parse(events[0].payload).data).toMatchObject({
      oldPath: before.locale.urlSlug,
      path: 'new-path',
      localeId: locale.id,
    });
    expect(after.locale.publishedVersionId).toBe(before.locale.publishedVersionId);
  });
  it('schema deployment emits one migration event and no synthetic draft/publication events', async () => {
    await store.saveWebhook(alice, input);
    const definition = (await store.listDefinitions(alice))[0];
    await store.updateDefinition(alice, definition.id, {
      ...definitionInput(definition),
      displayName: 'Updated component name',
    });
    const migration = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const review = await store.reviewMigration(alice, migration.id);
    expect(review.blockers).toEqual([]);
    await store.deployMigration(alice, migration.id, review.token, {
      confirmation: review.confirmation ?? undefined,
    });
    await store.deployMigration(alice, migration.id, review.token, {
      confirmation: review.confirmation ?? undefined,
    });
    const events = (await pool.query('SELECT event_type,payload FROM webhook_events')).rows;
    expect(events.map((row) => row.event_type)).toEqual(['schema.deployed']);
    expect(JSON.parse(events[0].payload).data).toEqual({ migrationVersion: migration.version });
  });

  it('draft saves never trigger publish; publication is durable, signed, and can build from current delivery content', async () => {
    const created = await store.saveWebhook(alice, input);
    const story = (await store.listStories(alice))[0];
    const locale = (await store.listLocales(alice, story.id))[0];
    const snapshot = await store.getSnapshot(alice, story.id, locale.id);
    const block = snapshot.blocks.find((item) => Object.hasOwn(item.fields, 'title'))!;
    const lease = await store.acquireLease(alice, story.id, locale.id, block.id);
    const saved = await store.command(alice, story.id, locale.id, {
      mutationId: randomUUID(),
      expectedRevisions: { [block.id]: block.revision },
      leaseTokens: { [block.id]: lease.token! },
      type: 'saveBlock',
      payload: { blockId: block.id, fields: { ...block.fields, title: 'Published build title' } },
    });
    expect((await pool.query('SELECT event_type FROM webhook_events')).rows).toEqual([
      { event_type: 'story.saved' },
    ]);
    const mutation = {
      mutationId: randomUUID(),
      expectedRevisions: {},
      leaseTokens: {},
      type: 'publishCheckpoint' as const,
      payload: { checkpointId: saved.checkpointId },
    };
    await store.command(alice, story.id, locale.id, mutation);
    await store.command(alice, story.id, locale.id, mutation);
    expect(
      (await pool.query("SELECT * FROM webhook_events WHERE event_type='story.published'"))
        .rowCount,
    ).toBe(1);
    const credential = await store.createDeliveryToken(alice, {
      name: 'Static build',
      scope: 'published',
    });
    const builds: unknown[] = [];
    const receiver = createRebuildReceiver({
      databasePath: ':memory:',
      secret: created.secret!,
      spaceId: alice.spaceId,
      build: async () => {
        builds.push(
          await store.publishedStories(credential.token, alice.spaceId, { id: story.id }),
        );
      },
    });
    await dispatchWebhooks(pool, {
      ...options,
      fetch: async (_url, init) => {
        const headers = new Headers(init?.headers),
          payload = String(init?.body);
        expect(
          await verifyWebhookSignature(
            created.secret!,
            headers.get('webhook-timestamp')!,
            payload,
            headers.get('webhook-signature')!,
          ),
        ).toBe(true);
        const event = JSON.parse(payload) as WebhookEvent;
        expect(payload).not.toContain('Published build title');
        expect(payload).not.toContain(credential.token);
        expect(event.spaceId).toBe(alice.spaceId);
        return receiver.receive(new Request('https://site.example.com/webhook', init));
      },
    });
    await receiver.runPending();
    await receiver.close();
    expect(builds).toHaveLength(1);
    expect(JSON.stringify(builds)).toContain('Published build title');
  });
});
