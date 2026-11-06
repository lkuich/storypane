import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { StorypaneStore } from './store.js';
import { migrate } from './migrate.js';
import {
  webhookEventTypes,
  type Actor,
  type LocaleSnapshot,
  type WebhookEvent,
} from '@storypane/core';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
)
  throw new Error('Require dedicated local test database');
const schema = 'webhook_review_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schema},public`,
});
const store = new StorypaneStore(pool);
let actor: Actor, state: LocaleSnapshot;
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await pool.query(
    `INSERT INTO "user"(id,name,email) VALUES('review-admin','Review Admin','review@example.invalid')`,
  );
  await pool.query(
    "INSERT INTO cms_sessions VALUES('review-session','review-admin',now()+interval '1 hour')",
  );
});
beforeEach(async () => {
  await pool.query('TRUNCATE spaces CASCADE');
  actor = {
    spaceId: randomUUID(),
    userId: 'review-admin',
    sessionId: 'review-session',
    role: 'admin',
  };
  await store.seed(actor);
  const story = (await store.listStories(actor))[0],
    locale = (await store.listLocales(actor, story.id))[0];
  state = await store.getSnapshot(actor, story.id, locale.id);
  await pool.query(
    "INSERT INTO webhook_endpoints(space_id,name,url,events,encrypted_secret) VALUES($1,'Review','https://example.com/hook',$2,'test')",
    [actor.spaceId, [...webhookEventTypes]],
  );
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
const events = async () =>
  (
    await pool.query(
      'SELECT payload FROM webhook_events WHERE space_id=$1 ORDER BY created_at,id',
      [actor.spaceId],
    )
  ).rows.map((row) => JSON.parse(row.payload) as WebhookEvent);
const reviewed = async (storyId = state.story.id) =>
  (await store.reviewStoryAction(actor, storyId)).locales.map(
    ({ id, checkpointId, publicationId }) => ({ id, checkpointId, publicationId }),
  );

describe('combined lifecycle webhook paths', () => {
  it('restoring a tombstone records one draft save, and replay records none', async () => {
    await store.storyAction(actor, state.story.id, {
      action: 'delete',
      requestId: randomUUID(),
      locales: await reviewed(),
    });
    const restore = { action: 'restore', requestId: randomUUID() };
    await store.storyAction(actor, state.story.id, restore);
    await store.storyAction(actor, state.story.id, restore);
    const saved = (await events()).filter((event) => event.type === 'story.saved');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      actorId: actor.userId,
      data: { storyId: state.story.id, localeId: state.locale.id },
    });
    expect(
      (await store.getSnapshot(actor, state.story.id, state.locale.id)).locale.publishedVersionId,
    ).toBeNull();
  });
  it('duplicate creates a draft-save event with the new identity and stable receipt', async () => {
    const input = { action: 'duplicate', requestId: randomUUID(), folderId: null };
    const duplicate = await store.storyAction(actor, state.story.id, input);
    await store.storyAction(actor, state.story.id, input);
    const emitted = await events();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'story.saved',
      actorId: actor.userId,
      data: { storyId: duplicate.story.id, localeId: duplicate.localeIds[0] },
    });
    expect(duplicate.story.id).not.toBe(state.story.id);
  });
  it('bulk publish emits once per changed locale and receipts prevent retry duplicates', async () => {
    const copy = await store.storyAction(actor, state.story.id, {
      action: 'duplicate',
      requestId: randomUUID(),
      folderId: null,
    });
    const input = {
      items: await Promise.all(
        [state.story.id, copy.story.id].map(async (storyId) => ({
          storyId,
          input: { action: 'publish', requestId: randomUUID(), locales: await reviewed(storyId) },
        })),
      ),
    };
    const first = await store.bulkStoryAction(actor, input),
      second = await store.bulkStoryAction(actor, input);
    expect(first.every((item) => !item.error)).toBe(true);
    expect(second.every((item) => !item.error)).toBe(true);
    const published = (await events()).filter((event) => event.type === 'story.published');
    expect(published).toHaveLength(2);
    expect(new Set(published.map((event) => event.data.storyId))).toEqual(
      new Set([state.story.id, copy.story.id]),
    );
    expect(
      published.every((event) => event.actorId === actor.userId && !!event.data.publicationId),
    ).toBe(true);
  });
  it('rolls back early unpublication events when a later selected locale is stale', async () => {
    const french = await store.createSpaceLocale(actor, { name: 'French', slug: 'fr' });
    await store.createLocale(actor, state.story.id, { spaceLocaleId: french.id });
    await store.storyAction(actor, state.story.id, {
      action: 'publish',
      requestId: randomUUID(),
      locales: await reviewed(),
    });
    const before = await reviewed(),
      count = (await events()).length;
    await expect(
      store.storyAction(actor, state.story.id, {
        action: 'unpublish',
        requestId: randomUUID(),
        locales: [before[0], { ...before[1], publicationId: randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    expect(await reviewed()).toEqual(before);
    expect(await events()).toHaveLength(count);
    expect((await events()).some((event) => event.type === 'story.unpublished')).toBe(false);
  });
  it('rolls scheduled publication back if its outbox insert fails, then retries atomically', async () => {
    const localTime = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
    const schedule = await store.schedulePublication(actor, state.story.id, state.locale.id, {
      requestId: randomUUID(),
      checkpointId: state.checkpointId,
      localTime,
      dueAt: localTime + ':00.000Z',
      timezone: 'UTC',
      expectedScheduleId: null,
      expectedRevision: null,
    });
    const makeDue = () =>
      pool.query(
        "UPDATE publication_schedules SET due_at=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
        [schedule.id],
      );
    await pool.query(
      "ALTER TABLE webhook_events ADD CONSTRAINT review_outbox_failure CHECK(event_type<>'story.published')",
    );
    try {
      await makeDue();
      await store.runScheduledPublications();
      expect(
        (await store.getSnapshot(actor, state.story.id, state.locale.id)).locale.publishedVersionId,
      ).toBeNull();
      expect(await events()).toEqual([]);
      expect((await store.listSchedules(actor, state.story.id, state.locale.id))[0]).toMatchObject({
        status: 'pending',
        attemptCount: 1,
      });
    } finally {
      await pool.query('ALTER TABLE webhook_events DROP CONSTRAINT review_outbox_failure');
    }
    await makeDue();
    await store.runScheduledPublications();
    const emitted = await events();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'story.published',
      actorId: actor.userId,
      data: { checkpointId: state.checkpointId },
    });
    expect((await store.listSchedules(actor, state.story.id, state.locale.id))[0]).toMatchObject({
      status: 'published',
      attemptCount: 2,
    });
  });
});
