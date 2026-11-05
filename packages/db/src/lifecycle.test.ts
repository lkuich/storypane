import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StorypaneStore } from './store.js';
import { contentScopesSchema, definitionInput } from '@storypane/core';
import { migrate } from './migrate.js';
import type {
  Actor,
  BlockDraft,
  Command,
  Lease,
  LocaleSnapshot,
  PublicationReferenceChoice,
} from '@storypane/core';

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok_test';
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/blok_test')
  throw new Error('Integration tests require the disposable local blok_test database');
const schemaName = `data_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName},public`,
  max: 8,
});
const store = new StorypaneStore(pool);
let alice: Actor;
let bob: Actor;
let snapshot: LocaleSnapshot;
const blockNamed = (state: LocaleSnapshot, name: string) =>
  state.blocks.find(
    (block) => state.definitions.find((d) => d.versionId === block.schemaVersionId)?.name === name,
  )!;
const commandBase = (...entries: { block: BlockDraft; lease: Lease }[]) => ({
  mutationId: randomUUID(),
  expectedRevisions: Object.fromEntries(entries.map(({ block }) => [block.id, block.revision])),
  leaseTokens: Object.fromEntries(entries.map(({ block, lease }) => [block.id, lease.token!])),
});
const lease = (actor: Actor, state: LocaleSnapshot, block: BlockDraft) =>
  store.acquireLease(actor, state.story.id, state.locale.id, block.id);
const run = (actor: Actor, state: LocaleSnapshot, command: Command) =>
  store.command(actor, state.story.id, state.locale.id, command);
async function save(
  actor: Actor,
  state: LocaleSnapshot,
  block: BlockDraft,
  fields: BlockDraft['fields'],
) {
  const ownLease = await lease(actor, state, block);
  return run(actor, state, {
    ...commandBase({ block, lease: ownLease }),
    type: 'saveBlock',
    payload: { blockId: block.id, fields },
  });
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await pool.query(
    'CREATE TABLE "session" (id text PRIMARY KEY,"userId" text NOT NULL,"expiresAt" timestamptz NOT NULL)',
  );
  await pool.query(
    'CREATE TABLE "user" (id text PRIMARY KEY,name text NOT NULL,email text NOT NULL)',
  );
  await pool.query(
    `INSERT INTO "user" VALUES('alice','Alice','alice@test.local'),('bob','Bob','bob@test.local')`,
  );
  await migrate(pool);
  await pool.query(
    `INSERT INTO cms_sessions VALUES('alice-session','alice',now()+interval '1 hour'),('bob-session','bob',now()+interval '1 hour')`,
  );
});
beforeEach(async () => {
  const spaceId = randomUUID();
  alice = { userId: 'alice', sessionId: 'alice-session', spaceId, role: 'admin' };
  bob = { userId: 'bob', sessionId: 'bob-session', spaceId, role: 'editor' };
  await pool.query("UPDATE cms_sessions SET expires_at=now()+interval '1 hour'");
  await store.seed(alice);
  await pool.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,'bob','editor')", [
    spaceId,
  ]);
  const story = (await store.listStories(alice))[0],
    locale = (await store.listLocales(alice, story.id))[0];
  snapshot = await store.getSnapshot(alice, story.id, locale.id);
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
  await admin.end();
});
async function deletion(storyId = snapshot.story.id) {
  const review = await store.reviewStoryAction(alice, storyId);
  return {
    action: 'delete',
    requestId: randomUUID(),
    locales: review.locales.map(({ id, checkpointId, publicationId }) => ({
      id,
      checkpointId,
      publicationId,
    })),
  };
}
async function schedule(
  checkpointId = snapshot.checkpointId!,
  referenceChoices?: PublicationReferenceChoice[],
) {
  const localTime = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
  return store.schedulePublication(alice, snapshot.story.id, snapshot.locale.id, {
    requestId: randomUUID(),
    checkpointId,
    referenceChoices,
    localTime,
    dueAt: localTime + ':00.000Z',
    timezone: 'UTC',
    expectedScheduleId: null,
    expectedRevision: null,
  });
}
async function due(id: string) {
  await pool.query(
    "UPDATE publication_schedules SET next_attempt_at=now()-interval '1 minute',due_at=now()-interval '1 minute' WHERE id=$1",
    [id],
  );
}

describe('Story lifecycle', () => {
  it('clones saved locales with fresh block IDs and replays a lost response exactly once', async () => {
    const input = { action: 'duplicate', requestId: randomUUID(), folderId: null };
    const first = await store.storyAction(alice, snapshot.story.id, input),
      retry = await store.storyAction(alice, snapshot.story.id, input);
    expect(retry).toEqual(first);
    expect(first.story.id).not.toBe(snapshot.story.id);
    const copied = await store.getSnapshot(alice, first.story.id, first.localeIds[0]);
    expect(copied.locale.publishedVersionId).toBeNull();
    expect(copied.blocks).toHaveLength(snapshot.blocks.length);
    expect(
      copied.blocks.every((block) => !snapshot.blocks.some((source) => source.id === block.id)),
    ).toBe(true);
    for (const block of copied.blocks)
      expect(block.fields).toEqual(
        snapshot.blocks.find((source) => source.definitionId === block.definitionId)!.fields,
      );
    await expect(
      store.storyAction(alice, snapshot.story.id, { ...input, slug: 'different' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('requires reviewed publication IDs, cancels schedules, and preserves immutable publications', async () => {
    const first = await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const second = await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    await expect(
      run(alice, snapshot, {
        ...commandBase(),
        type: 'unpublishLocale',
        payload: { publicationId: first.publicationId!, acknowledgeReferences: false },
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    const job = await schedule();
    const unpublished = await run(alice, snapshot, {
      ...commandBase(),
      type: 'unpublishLocale',
      payload: { publicationId: second.publicationId!, acknowledgeReferences: false },
    });
    expect(unpublished.snapshot.locale.publishedVersionId).toBeNull();
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id)).find(
        (item) => item.id === job.id,
      )?.status,
    ).toBe('cancelled');
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM publications WHERE locale_id=$1', [
          snapshot.locale.id,
        ])
      ).rows[0].count,
    ).toBe(2);
  });
  it('deletes safely, reserves its path, rejects stale access, and restores unpublished drafts', async () => {
    const job = await schedule(),
      before = await pool.query(
        'SELECT count(*)::int AS count FROM checkpoints WHERE locale_id=$1',
        [snapshot.locale.id],
      );
    const input = await deletion();
    await store.storyAction(alice, snapshot.story.id, input);
    await store.storyAction(alice, snapshot.story.id, input);
    expect(await store.listStories(alice)).toEqual([]);
    expect((await store.listStories(alice, true))[0].deletedAt).toBeTruthy();
    await expect(
      store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.createStory(alice, {
        name: 'Collision',
        slug: snapshot.story.slugSegment,
        definitionId: snapshot.blocks[0].definitionId,
        folderId: null,
      }),
    ).rejects.toBeDefined();
    await expect(
      run(alice, snapshot, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: snapshot.checkpointId! },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const restored = await store.storyAction(alice, snapshot.story.id, {
      action: 'restore',
      requestId: randomUUID(),
    });
    expect(restored.story.deletedAt).toBeNull();
    const state = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(state.locale.publishedVersionId).toBeNull();
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM checkpoints WHERE locale_id=$1', [
          snapshot.locale.id,
        ])
      ).rows[0].count,
    ).toBeGreaterThan(before.rows[0].count);
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id)).find(
        (item) => item.id === job.id,
      )?.status,
    ).toBe('cancelled');
  });
  it('rejects changed reviews and competing leases without deleting anything', async () => {
    const input = await deletion(),
      block = blockNamed(snapshot, 'hero');
    await save(alice, snapshot, block, { ...block.fields, title: 'New revision' });
    await expect(store.storyAction(alice, snapshot.story.id, input)).rejects.toMatchObject({
      code: 'stale_revision',
    });
    await pool.query('DELETE FROM edit_leases WHERE locale_id=$1', [snapshot.locale.id]);
    await lease(bob, snapshot, block);
    await expect(
      store.storyAction(alice, snapshot.story.id, await deletion()),
    ).rejects.toMatchObject({ code: 'locked' });
    expect(await store.listStories(alice)).toHaveLength(1);
  });
  it('blocks active typed references and reports partial batch results safely on replay', async () => {
    const copied = await store.storyAction(alice, snapshot.story.id, {
      action: 'duplicate',
      requestId: randomUUID(),
      folderId: null,
    });
    const copy = await store.getSnapshot(alice, copied.story.id, copied.localeIds[0]);
    const footer = blockNamed(copy, 'footer');
    await save(alice, copy, footer, {
      ...footer.fields,
      link: { type: 'story', storyId: snapshot.story.id },
    });
    expect(
      (await store.reviewStoryAction(alice, snapshot.story.id)).incomingReferences,
    ).toHaveLength(1);
    const payload = {
      items: [
        { storyId: snapshot.story.id, input: await deletion() },
        { storyId: copied.story.id, input: await deletion(copied.story.id) },
      ],
    };
    const results = await store.bulkStoryAction(alice, payload);
    expect(results[0].error?.code).toBe('invalid');
    expect(results[1].result?.story.deletedAt).toBeTruthy();
    const replay = await store.bulkStoryAction(alice, { items: [payload.items[1]] });
    expect(replay[0].result).toEqual(results[1].result);
  });
});
describe('Durable fixed-checkpoint scheduling', () => {
  it('publishes the fixed revision once across concurrent ticks even after the browser session expires', async () => {
    const job = await schedule();
    const block = blockNamed(snapshot, 'hero');
    await save(alice, snapshot, block, { ...block.fields, title: 'Later draft' });
    await due(job.id);
    await pool.query(
      "UPDATE cms_sessions SET expires_at=now()-interval '1 minute' WHERE id='alice-session'",
    );
    const ticks = await Promise.all([
      store.runScheduledPublications(),
      store.runScheduledPublications(),
    ]);
    expect(ticks.flat()).toHaveLength(1);
    const row = (
      await pool.query(
        'SELECT s.status,p.checkpoint_id,p.content FROM publication_schedules s JOIN publications p ON p.id=s.publication_id WHERE s.id=$1',
        [job.id],
      )
    ).rows[0];
    expect(row.status).toBe('published');
    expect(row.checkpoint_id).toBe(snapshot.checkpointId);
    expect(JSON.stringify(row.content)).not.toContain('Later draft');
  });
  it('fails after creator permission revocation without a publication', async () => {
    const job = await schedule();
    await due(job.id);
    await pool.query("UPDATE memberships SET role='viewer' WHERE space_id=$1 AND user_id='alice'", [
      alice.spaceId,
    ]);
    await store.runScheduledPublications();
    const row = (await pool.query('SELECT * FROM publication_schedules WHERE id=$1', [job.id]))
      .rows[0];
    expect(row.status).toBe('failed');
    expect(row.publication_id).toBeNull();
    expect(row.error).toContain('permission');
  });
  it('fences stale replacements and cancellations, and manual publication cancels pending work', async () => {
    const job = await schedule();
    await expect(schedule()).rejects.toMatchObject({ code: 'stale_revision' });
    await expect(
      store.cancelSchedule(alice, snapshot.story.id, snapshot.locale.id, job.id, {
        requestId: randomUUID(),
        revision: job.revision + 1,
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    await due(job.id);
    expect(await store.runScheduledPublications()).toEqual([]);
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id))[0].status,
    ).toBe('cancelled');
  });
  it('rejects nonexistent wall times and mismatched explicit offsets', async () => {
    await expect(
      store.schedulePublication(alice, snapshot.story.id, snapshot.locale.id, {
        requestId: randomUUID(),
        checkpointId: snapshot.checkpointId!,
        localTime: '2027-03-14T02:30',
        dueAt: '2027-03-14T10:30:00.000Z',
        timezone: 'America/Los_Angeles',
        expectedScheduleId: null,
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('Lifecycle and scheduling boundary cases', () => {
  it('keeps translations independent and cancels only the explicitly unpublished locale', async () => {
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const translated = await store.createLocale(alice, snapshot.story.id, {
      spaceLocaleId: french.id,
    });
    const first = await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const second = await run(alice, translated, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: translated.checkpointId! },
    });
    const input = {
      action: 'unpublish',
      requestId: randomUUID(),
      acknowledgeReferences: false,
      locales: [
        {
          id: snapshot.locale.id,
          checkpointId: snapshot.checkpointId,
          publicationId: first.publicationId,
        },
      ],
    };
    await store.storyAction(alice, snapshot.story.id, input);
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, translated.locale.id)).locale
        .publishedVersionId,
    ).toBe(second.publicationId);
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)).locale
        .publishedVersionId,
    ).toBeNull();
  });
  it('restores tombstones through intervening schema renames and immediately fails old schedules', async () => {
    const copied = await store.storyAction(alice, snapshot.story.id, {
      action: 'duplicate',
      requestId: randomUUID(),
      folderId: null,
    });
    await store.storyAction(alice, copied.story.id, await deletion(copied.story.id));
    const job = await schedule(),
      hero = blockNamed(snapshot, 'hero'),
      definition = snapshot.definitions.find((item) => item.id === hero.definitionId)!;
    await store.updateDefinition(
      alice,
      definition.id,
      {
        ...definitionInput(definition),
        fields: definition.fields.map((field) =>
          field.name === 'title' ? { ...field, name: 'headline' } : field,
        ),
      },
      definition.versionId,
      1,
    );
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!,
      review = await store.reviewMigration(alice, active.id);
    expect(review.blockers).toEqual([]);
    await store.deployMigration(alice, active.id, review.token, {
      confirmation: review.confirmation ?? undefined,
    });
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id)).find(
        (item) => item.id === job.id,
      )?.status,
    ).toBe('failed');
    await store.storyAction(alice, copied.story.id, { action: 'restore', requestId: randomUUID() });
    const restored = await store.getSnapshot(alice, copied.story.id, copied.localeIds[0]);
    expect(blockNamed(restored, 'hero').fields.headline).toBe(hero.fields.title);
    expect(restored.locale.publishedVersionId).toBeNull();
  });
  it('retries transient failures at bounded intervals and leaves the last live publication intact', async () => {
    const live = await run(alice, snapshot, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: snapshot.checkpointId! },
      }),
      job = await schedule();
    await pool.query(
      `CREATE FUNCTION fail_publication_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.locale_id='${snapshot.locale.id}'::uuid THEN RAISE EXCEPTION 'temporary failure' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      'CREATE TRIGGER publication_failure BEFORE INSERT ON publications FOR EACH ROW EXECUTE FUNCTION fail_publication_for_test()',
    );
    try {
      expect(await store.runScheduledPublications()).toEqual([]);
      for (let attempt = 1; attempt <= 5; attempt++) {
        await due(job.id);
        await store.runScheduledPublications();
        const row = (
          await pool.query(
            'SELECT *,extract(epoch FROM(next_attempt_at-updated_at))/60 AS delay FROM publication_schedules WHERE id=$1',
            [job.id],
          )
        ).rows[0];
        expect(row.attempt_count).toBe(attempt);
        expect(row.status).toBe(attempt === 5 ? 'failed' : 'pending');
        expect(Number(row.delay)).toBeCloseTo([1, 5, 15, 60, 60][attempt - 1], 1);
      }
      expect(
        (await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)).locale
          .publishedVersionId,
      ).toBe(live.publicationId);
    } finally {
      await pool.query('DROP TRIGGER publication_failure ON publications');
      await pool.query('DROP FUNCTION fail_publication_for_test()');
    }
  });
  it('serializes cancellation against due publication and never publishes twice', async () => {
    const job = await schedule();
    await due(job.id);
    const results = await Promise.allSettled([
      store.runScheduledPublications(),
      store.cancelSchedule(alice, snapshot.story.id, snapshot.locale.id, job.id, {
        requestId: randomUUID(),
        revision: job.revision,
      }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    const row = (
      await pool.query('SELECT status,publication_id FROM publication_schedules WHERE id=$1', [
        job.id,
      ])
    ).rows[0];
    expect(['published', 'cancelled']).toContain(row.status);
    expect(await store.runScheduledPublications()).toEqual([]);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM publications WHERE locale_id=$1', [
          snapshot.locale.id,
        ])
      ).rows[0].count,
    ).toBe(row.status === 'published' ? 1 : 0);
  });
  it('checks live URL collisions again when the fixed checkpoint becomes due', async () => {
    const job = await schedule();
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: null,
      slug: 'moved-home',
      localeSlugs: {},
    });
    const copied = await store.storyAction(alice, snapshot.story.id, {
      action: 'duplicate',
      requestId: randomUUID(),
      folderId: null,
      slug: 'home',
    });
    const copy = await store.getSnapshot(alice, copied.story.id, copied.localeIds[0]);
    await run(alice, copy, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: copy.checkpointId! },
    });
    await due(job.id);
    await store.runScheduledPublications();
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id))[0],
    ).toMatchObject({ status: 'failed', publicationId: null });
  });
});

describe('Lifecycle visibility and transactional events', () => {
  it('requires incoming-publication acknowledgment and uses the live path in review', async () => {
    const published = await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const copied = await store.storyAction(alice, snapshot.story.id, {
      action: 'duplicate',
      requestId: randomUUID(),
      folderId: null,
    });
    const copy = await store.getSnapshot(alice, copied.story.id, copied.localeIds[0]),
      footer = blockNamed(copy, 'footer');
    const saved = await save(alice, copy, footer, {
      ...footer.fields,
      link: { type: 'story', storyId: snapshot.story.id },
    });
    await run(alice, saved.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: saved.checkpointId },
    });
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: null,
      slug: 'new-home',
      localeSlugs: {},
    });
    expect((await store.reviewStoryAction(alice, snapshot.story.id)).locales[0]).toMatchObject({
      urlSlug: 'new-home',
      publishedUrlSlug: 'home',
    });
    const command = {
      ...commandBase(),
      type: 'unpublishLocale' as const,
      payload: { publicationId: published.publicationId!, acknowledgeReferences: false },
    };
    await expect(run(alice, snapshot, command)).rejects.toMatchObject({ code: 'invalid' });
    expect(
      (
        await run(alice, snapshot, {
          ...command,
          mutationId: randomUUID(),
          payload: { ...command.payload, acknowledgeReferences: true },
        })
      ).snapshot.locale.publishedVersionId,
    ).toBeNull();
  });
  it('hides deleted delivery and previews and prevents new references to tombstones', async () => {
    const token = await store.createDeliveryToken(alice, { name: 'Site', scope: 'published' });
    await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const previewId = randomUUID();
    await store.updateDeliverySettings(alice, {
      previewUrls: [{ id: previewId, name: 'Site', url: 'http://localhost:3132/{slug}' }],
      defaultPreviewId: previewId,
    });
    const preview = await store.createEditorPreview(alice, snapshot.story.id, snapshot.locale.id);
    const authenticated = await store.authenticatePreview(preview.token, 'http://localhost:3132');
    const copy = await store.storyAction(alice, snapshot.story.id, {
      action: 'duplicate',
      requestId: randomUUID(),
      folderId: null,
    });
    await store.storyAction(alice, snapshot.story.id, await deletion());
    expect(
      (await store.publishedStories(token.token, alice.spaceId, { id: snapshot.story.id })).stories,
    ).toEqual([]);
    await expect(store.previewStory(authenticated.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const state = await store.getSnapshot(alice, copy.story.id, copy.localeIds[0]),
      footer = blockNamed(state, 'footer');
    await expect(
      save(alice, state, footer, {
        ...footer.fields,
        link: { type: 'story', storyId: snapshot.story.id },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('records one scheduled publication event and one deletion event despite retries', async () => {
    await pool.query(
      "INSERT INTO webhook_endpoints(space_id,name,url,events,encrypted_secret) VALUES($1,'Test','https://example.com/hook',ARRAY['story.published','story.unpublished','story.deleted'],'test-ciphertext')",
      [alice.spaceId],
    );
    const job = await schedule();
    await due(job.id);
    await Promise.all([store.runScheduledPublications(), store.runScheduledPublications()]);
    const input = await deletion();
    await store.storyAction(alice, snapshot.story.id, input);
    await store.storyAction(alice, snapshot.story.id, input);
    const events = (
      await pool.query(
        'SELECT event_type,count(*)::int AS count FROM webhook_events WHERE space_id=$1 GROUP BY event_type ORDER BY event_type',
        [alice.spaceId],
      )
    ).rows;
    expect(events).toEqual([
      { event_type: 'story.deleted', count: 1 },
      { event_type: 'story.published', count: 1 },
      { event_type: 'story.unpublished', count: 1 },
    ]);
  });
  it('rolls back all selected locales when one reviewed publication is stale', async () => {
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' }),
      translated = await store.createLocale(alice, snapshot.story.id, { spaceLocaleId: french.id });
    const first = await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const second = await run(alice, translated, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: translated.checkpointId! },
    });
    await expect(
      store.storyAction(alice, snapshot.story.id, {
        action: 'unpublish',
        requestId: randomUUID(),
        acknowledgeReferences: true,
        locales: [
          {
            id: snapshot.locale.id,
            checkpointId: snapshot.checkpointId,
            publicationId: first.publicationId,
          },
          {
            id: translated.locale.id,
            checkpointId: translated.checkpointId,
            publicationId: randomUUID(),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)).locale
        .publishedVersionId,
    ).toBe(first.publicationId);
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, translated.locale.id)).locale
        .publishedVersionId,
    ).toBe(second.publicationId);
  });
});

describe('Lifecycle authorization and reference races', () => {
  it('retains the original publishing requirement on a receipt replay after deleting a scheduled draft', async () => {
    await schedule();
    const input = await deletion();
    await store.storyAction(alice, snapshot.story.id, input);
    await pool.query(
      "UPDATE space_roles SET permissions=ARRAY['content:edit'] WHERE space_id=$1 AND id='editor'",
      [alice.spaceId],
    );
    await pool.query("UPDATE memberships SET role='editor' WHERE space_id=$1 AND user_id='alice'", [
      alice.spaceId,
    ]);
    await expect(store.storyAction(alice, snapshot.story.id, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
  it('serializes a new story reference against deletion so both cannot commit', async () => {
    const copied = await store.storyAction(alice, snapshot.story.id, {
      action: 'duplicate',
      requestId: randomUUID(),
      folderId: null,
    });
    const copy = await store.getSnapshot(alice, copied.story.id, copied.localeIds[0]),
      footer = blockNamed(copy, 'footer'),
      owned = await lease(alice, copy, footer),
      input = await deletion();
    const results = await Promise.allSettled([
      store.storyAction(alice, snapshot.story.id, input),
      run(alice, copy, {
        ...commandBase({ block: footer, lease: owned }),
        type: 'saveBlock',
        payload: {
          blockId: footer.id,
          fields: { ...footer.fields, link: { type: 'story', storyId: snapshot.story.id } },
        },
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'invalid' });
  });
});

async function scopedEditor(raw: unknown) {
  const scopes = contentScopesSchema.parse(raw);
  await pool.query(
    "UPDATE space_roles SET permissions=ARRAY['content:read','content:edit','content:publish','assets:write'],content_scopes=$2 WHERE space_id=$1 AND id='editor'",
    [alice.spaceId, JSON.stringify(scopes)],
  );
}
async function scheduleAs(actor: Actor, state: LocaleSnapshot) {
  const localTime = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
  return store.schedulePublication(actor, state.story.id, state.locale.id, {
    requestId: randomUUID(),
    checkpointId: state.checkpointId!,
    localTime,
    dueAt: localTime + ':00.000Z',
    timezone: 'UTC',
    expectedScheduleId: null,
    expectedRevision: null,
  });
}
describe('Scoped lifecycle, scheduling, and media integration', () => {
  it('filters schedule summaries and review locales without exposing inaccessible translations', async () => {
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' }),
      translated = await store.createLocale(alice, snapshot.story.id, { spaceLocaleId: french.id });
    const first = await schedule(),
      second = await scheduleAs(alice, translated);
    await scopedEditor({
      read: { localeIds: [french.id] },
      edit: { localeIds: [french.id] },
      publish: { localeIds: [french.id] },
    });
    const stories = await store.listStories(bob);
    expect(stories[0].schedules?.map((job) => job.id)).toEqual([second.id]);
    expect(
      (await store.reviewStoryAction(bob, snapshot.story.id)).locales.map((locale) => locale.id),
    ).toEqual([translated.locale.id]);
    await expect(
      store.listSchedules(bob, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.cancelSchedule(bob, snapshot.story.id, snapshot.locale.id, first.id, {
        requestId: randomUUID(),
        revision: first.revision,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.storyAction(bob, snapshot.story.id, {
        action: 'duplicate',
        folderId: null,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await store.listSchedules(bob, snapshot.story.id, translated.locale.id))[0].id).toBe(
      second.id,
    );
  });
  it('redacts incoming reference names and IDs while keeping deletion blocked', async () => {
    const copied = await store.storyAction(alice, snapshot.story.id, {
      action: 'duplicate',
      folderId: null,
      requestId: randomUUID(),
    });
    const copy = await store.getSnapshot(alice, copied.story.id, copied.localeIds[0]),
      footer = blockNamed(copy, 'footer');
    await save(alice, copy, footer, {
      ...footer.fields,
      link: { type: 'story', storyId: snapshot.story.id },
    });
    await scopedEditor({ read: { locations: { folderIds: [], storyIds: [snapshot.story.id] } } });
    const review = await store.reviewStoryAction(bob, snapshot.story.id);
    expect(review.incomingReferences).toEqual([
      { storyId: '', localeId: '', storyName: 'Restricted story', published: false },
    ]);
    await expect(store.storyAction(bob, snapshot.story.id, await deletion())).rejects.toMatchObject(
      { code: 'invalid' },
    );
  });
  it('uses current locations for scheduling, manual publishing, and retries without changing snapshot bytes', async () => {
    const allowed = await store.saveFolder(alice, { name: 'Allowed', slug: 'allowed' }),
      outside = await store.saveFolder(alice, { name: 'Outside', slug: 'outside' });
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: allowed.id,
      slug: 'home',
      localeSlugs: {},
    });
    const pinned = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    await scopedEditor({ publish: { locations: { folderIds: [allowed.id], storyIds: [] } } });
    const job = await scheduleAs(bob, pinned);
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: outside.id,
      slug: 'home',
      localeSlugs: {},
    });
    await due(job.id);
    await store.runScheduledPublications();
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id))[0].status,
    ).toBe('failed');
    const command = {
      ...commandBase(),
      type: 'publishCheckpoint' as const,
      payload: { checkpointId: pinned.checkpointId! },
    };
    await expect(run(bob, pinned, command)).rejects.toMatchObject({ code: 'forbidden' });
    await scopedEditor({ publish: { locations: { folderIds: [outside.id], storyIds: [] } } });
    const published = await run(bob, pinned, command);
    const bytes = (
      await pool.query('SELECT snapshot FROM publications WHERE id=$1', [published.publicationId])
    ).rows[0].snapshot;
    expect(bytes.story.folderId).toBe(allowed.id);
    await scopedEditor({ publish: { locations: { folderIds: [allowed.id], storyIds: [] } } });
    await expect(run(bob, pinned, command)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('blocks publishing and duplication when a typed reference is hidden, and rejects echoed hidden values', async () => {
    const allowed = await store.saveFolder(alice, { name: 'Allowed', slug: 'allowed' });
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: allowed.id,
      slug: 'home',
      localeSlugs: {},
    });
    const current = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id),
      target = await store.storyAction(alice, snapshot.story.id, {
        action: 'duplicate',
        folderId: null,
        requestId: randomUUID(),
      });
    const footer = blockNamed(current, 'footer'),
      saved = await save(alice, current, footer, {
        ...footer.fields,
        link: { type: 'story', storyId: target.story.id },
      });
    await pool.query('DELETE FROM edit_leases WHERE locale_id=$1', [snapshot.locale.id]);
    await scopedEditor({ read: { locations: { folderIds: [allowed.id], storyIds: [] } } });
    const visible = await store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id);
    expect(visible.access?.complete).toBe(false);
    await expect(
      run(bob, visible, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: saved.checkpointId },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.storyAction(bob, snapshot.story.id, {
        action: 'duplicate',
        folderId: allowed.id,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(scheduleAs(bob, saved.snapshot)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      save(bob, visible, blockNamed(visible, 'footer'), {
        ...footer.fields,
        link: { type: 'story', storyId: target.story.id },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const omitted = await save(bob, visible, blockNamed(visible, 'footer'), {
      text: 'Allowed text',
    });
    expect(blockNamed(omitted.snapshot, 'footer').fields.link).toBeUndefined();
  });
  it('does not lease a block whose only editable field is a hidden reference', async () => {
    const target = await store.storyAction(alice, snapshot.story.id, {
        action: 'duplicate',
        folderId: null,
        requestId: randomUUID(),
      }),
      footer = blockNamed(snapshot, 'footer');
    await save(alice, snapshot, footer, {
      ...footer.fields,
      link: { type: 'story', storyId: target.story.id },
    });
    await pool.query('DELETE FROM edit_leases WHERE locale_id=$1', [snapshot.locale.id]);
    const link = snapshot.definitions
      .find((definition) => definition.id === footer.definitionId)!
      .fields.find((field) => field.name === 'link')!;
    await scopedEditor({
      read: { locations: { folderIds: [], storyIds: [snapshot.story.id] } },
      edit: { fieldIds: [link.id!] },
    });
    await expect(
      store.acquireLease(bob, snapshot.story.id, snapshot.locale.id, footer.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('authorizes restore through the deleted view and refuses restoring another folder', async () => {
    const folder = await store.saveFolder(alice, { name: 'Allowed', slug: 'allowed' });
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: folder.id,
      slug: 'home',
      localeSlugs: {},
    });
    await store.storyAction(alice, snapshot.story.id, await deletion());
    await scopedEditor({
      read: { locations: { folderIds: [folder.id], storyIds: [] } },
      edit: { locations: { folderIds: [folder.id], storyIds: [] } },
    });
    expect((await store.listStories(bob, true))[0].id).toBe(snapshot.story.id);
    expect(
      (
        await store.storyAction(bob, snapshot.story.id, {
          action: 'restore',
          requestId: randomUUID(),
        })
      ).story.deletedAt,
    ).toBeNull();
    await store.storyAction(alice, snapshot.story.id, await deletion());
    await scopedEditor({ read: { locations: { folderIds: [], storyIds: [] } } });
    await expect(store.reviewStoryAction(bob, snapshot.story.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      store.storyAction(bob, snapshot.story.id, { action: 'restore', requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('filters media usage locations and fields before pagination', async () => {
    const assetId = randomUUID(),
      footer = blockNamed(snapshot, 'footer'),
      root = snapshot.blocks.find((block) => block.id === snapshot.locale.rootBlockId)!;
    await pool.query(
      "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title) VALUES($1::uuid,$2,$1::text,'image.png','image/png',10,'Image')",
      [assetId, alice.spaceId],
    );
    await pool.query(
      "INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) SELECT gen_random_uuid(),$1,$2,$3,'body',n,$4::jsonb FROM generate_series(10,54) n",
      [
        snapshot.locale.id,
        footer.schemaVersionId,
        root.id,
        JSON.stringify({ text: 'Hidden usage', link: { type: 'asset', assetId } }),
      ],
    );
    const visibleId = 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      localeId = randomUUID(),
      rootId = randomUUID(),
      footerId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO stories(id,space_id,name,slug,slug_segment) VALUES($1,$2,'Visible usage','visible-usage','visible-usage')",
        [visibleId, alice.spaceId],
      );
      await client.query(
        "INSERT INTO story_locales(id,story_id,space_locale_id,slug,name,url_slug,slug_segment,root_block_id) VALUES($1,$2,$3,'','Default','visible-usage','visible-usage',$4)",
        [localeId, visibleId, snapshot.locale.spaceLocaleId, rootId],
      );
      await client.query(
        'INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)',
        [rootId, localeId, root.schemaVersionId, JSON.stringify(root.fields)],
      );
      await client.query(
        "INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,'body',0,$5)",
        [
          footerId,
          localeId,
          footer.schemaVersionId,
          rootId,
          JSON.stringify({ text: 'Visible usage', link: { type: 'asset', assetId } }),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const link = snapshot.definitions
      .find((definition) => definition.id === footer.definitionId)!
      .fields.find((field) => field.name === 'link')!;
    await scopedEditor({
      read: { locations: { folderIds: [], storyIds: [visibleId] }, fieldIds: [link.id!] },
    });
    const usage = await store.listAssetUsage(bob, assetId);
    expect(usage.items).toHaveLength(1);
    expect(usage.items[0].storyId).toBe(visibleId);
    expect(usage.nextCursor).toBeNull();
    await scopedEditor({ read: { fieldIds: [] } });
    expect((await store.listAssetUsage(bob, assetId)).items).toEqual([]);
  });
});

async function copiedStory(name = 'Shared footer') {
  const copied = await store.storyAction(alice, snapshot.story.id, {
    action: 'duplicate',
    requestId: randomUUID(),
    folderId: null,
    name,
  });
  return store.getSnapshot(alice, copied.story.id, copied.localeIds[0]);
}
async function linkStory(parent: LocaleSnapshot, target: LocaleSnapshot) {
  const footer = blockNamed(parent, 'footer');
  return (
    await save(alice, parent, footer, {
      ...footer.fields,
      link: { type: 'story', storyId: target.story.id },
    })
  ).snapshot;
}
const referenceReview = (state: LocaleSnapshot, actor = alice) =>
  store.reviewPublication(actor, state.story.id, state.locale.id, state.checkpointId!);
const publishWith = (
  state: LocaleSnapshot,
  referenceChoices: PublicationReferenceChoice[] = [],
  actor = alice,
) =>
  run(actor, state, {
    ...commandBase(),
    type: 'publishCheckpoint',
    payload: { checkpointId: state.checkpointId!, referenceChoices },
  });

describe('Publication reference choices', () => {
  it('rolls back the page publication when a linked publication fails after writes begin', async () => {
    const original = await copiedStory();
    await publishWith(original);
    await store.storyAction(alice, original.story.id, {
      action: 'move',
      requestId: randomUUID(),
      location: { folderId: null, slug: 'moved-footer', localeSlugs: {} },
    });
    const linked = await store.createStory(alice, {
      name: 'Replacement footer',
      slug: original.story.slugSegment!,
      definitionId: blockNamed(snapshot, 'page').definitionId,
    });
    snapshot = await linkStory(snapshot, linked);
    await expect(
      publishWith(snapshot, [
        { localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'publish' },
      ]),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('Another page still publishes this URL'),
    });
    expect(await store.getPublication(alice, snapshot.story.id, snapshot.locale.id)).toBeNull();
    expect(await store.getPublication(alice, linked.story.id, linked.locale.id)).toBeNull();
    expect(await store.getPublication(alice, original.story.id, original.locale.id)).not.toBeNull();
  });
  it('requires an explicit choice, publishes pinned linked revisions atomically, and replays safely', async () => {
    const linked = await copiedStory();
    snapshot = await linkStory(snapshot, linked);
    const review = await referenceReview(snapshot);
    expect(review.references).toMatchObject([
      {
        storyName: 'Shared footer',
        canPublish: true,
        checkpointId: linked.checkpointId,
        usages: [{ canOmit: true }],
      },
    ]);
    await expect(publishWith(snapshot)).rejects.toMatchObject({ code: 'invalid' });
    const hero = blockNamed(linked, 'hero');
    await save(alice, linked, hero, { ...hero.fields, title: 'Unreviewed later edit' });
    const input: Command = {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: {
        checkpointId: snapshot.checkpointId!,
        referenceChoices: [
          { localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'publish' },
        ],
      },
    };
    const first = await run(alice, snapshot, input);
    expect((await run(alice, snapshot, input)).publicationId).toBe(first.publicationId);
    expect(
      (await store.getPublication(alice, linked.story.id, linked.locale.id))?.checkpointId,
    ).toBe(linked.checkpointId);
    expect(
      JSON.stringify(
        (await store.getPublication(alice, linked.story.id, linked.locale.id))?.content,
      ),
    ).not.toContain('Unreviewed later edit');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM publications WHERE locale_id=ANY($1::uuid[])',
          [[snapshot.locale.id, linked.locale.id]],
        )
      ).rows[0].count,
    ).toBe(2);
  });
  it('omits only the published reference and leaves both drafts intact', async () => {
    const linked = await copiedStory();
    snapshot = await linkStory(snapshot, linked);
    await publishWith(snapshot, [
      { localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'omit' },
    ]);
    const published = (
      await pool.query('SELECT snapshot FROM publications WHERE locale_id=$1', [snapshot.locale.id])
    ).rows[0].snapshot as LocaleSnapshot;
    expect(blockNamed(published, 'footer').fields.link).toBeNull();
    const draft = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(blockNamed(draft, 'footer').fields.link).toEqual({
      type: 'story',
      storyId: linked.story.id,
    });
    expect(draft.publicationStatus).toBe('changed');
    expect(await store.getPublication(alice, linked.story.id, linked.locale.id)).toBeNull();
  });
  it('respects linked-story publishing scopes and rolls back the entire selection', async () => {
    const linked = await copiedStory();
    snapshot = await linkStory(snapshot, linked);
    await scopedEditor({
      publish: { locations: { folderIds: [], storyIds: [snapshot.story.id] } },
    });
    const review = await referenceReview(snapshot, bob);
    expect(review.references[0].canPublish).toBe(false);
    await expect(
      publishWith(
        snapshot,
        [{ localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'publish' }],
        bob,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await store.getPublication(alice, snapshot.story.id, snapshot.locale.id)).toBeNull();
    expect(await store.getPublication(alice, linked.story.id, linked.locale.id)).toBeNull();
    await publishWith(
      snapshot,
      [{ localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'omit' }],
      bob,
    );
    await scopedEditor({ read: { locations: { folderIds: [], storyIds: [snapshot.story.id] } } });
    const restrictedReview = await referenceReview(snapshot, bob);
    expect(restrictedReview.references).toEqual([]);
    expect(restrictedReview.snapshot.access?.publish).toBe(false);
    expect(JSON.stringify(restrictedReview)).not.toContain(linked.story.id);
  });
  it('rejects omission of required references', async () => {
    const linked = await copiedStory();
    snapshot = await linkStory(snapshot, linked);
    const definition = snapshot.definitions.find((item) => item.name === 'footer')!;
    await store.updateDefinition(alice, definition.id, {
      ...definitionInput(definition),
      fields: definition.fields.map((field) =>
        field.name === 'link' ? { ...field, required: true } : field,
      ),
    });
    const migration = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const migrationReview = await store.reviewMigration(alice, migration.id);
    await store.deployMigration(alice, migration.id, migrationReview.token, {
      confirmation: migrationReview.confirmation ?? undefined,
    });
    snapshot = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    const review = await referenceReview(snapshot);
    expect(review.references[0].usages[0].canOmit).toBe(false);
    await expect(
      publishWith(snapshot, [
        {
          localeId: linked.locale.id,
          checkpointId: review.references[0].checkpointId,
          action: 'omit',
        },
      ]),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(await store.getPublication(alice, snapshot.story.id, snapshot.locale.id)).toBeNull();
  });
  it('handles nested references and cycles without implicitly publishing anything', async () => {
    let linked = await copiedStory(),
      nested = await copiedStory('Nested');
    linked = await linkStory(linked, nested);
    nested = await linkStory(nested, linked);
    snapshot = await linkStory(snapshot, linked);
    const review = await referenceReview(snapshot);
    expect(review.references).toHaveLength(2);
    const choices = review.references.map(({ localeId, checkpointId }) => ({
      localeId,
      checkpointId,
      action: 'publish' as const,
    }));
    await expect(publishWith(snapshot, choices.slice(0, 1))).rejects.toMatchObject({
      code: 'invalid',
    });
    await publishWith(snapshot, choices);
    expect(await store.getPublication(alice, linked.story.id, linked.locale.id)).not.toBeNull();
    expect(await store.getPublication(alice, nested.story.id, nested.locale.id)).not.toBeNull();
  });
  it('prunes omitted subtrees and rejects unrelated selections', async () => {
    let linked = await copiedStory();
    const nested = await copiedStory('Nested');
    linked = await linkStory(linked, nested);
    snapshot = await linkStory(snapshot, linked);
    const review = await referenceReview(snapshot);
    expect(review.references).toHaveLength(2);
    await expect(
      publishWith(
        snapshot,
        review.references.map(({ localeId, checkpointId }) => ({
          localeId,
          checkpointId,
          action: 'omit',
        })),
      ),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    await publishWith(snapshot, [
      { localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'omit' },
    ]);
    expect(await store.getPublication(alice, linked.story.id, linked.locale.id)).toBeNull();
    expect(await store.getPublication(alice, nested.story.id, nested.locale.id)).toBeNull();
  });
  it('keeps using the published Default fallback without publishing newer drafts', async () => {
    const linked = await copiedStory();
    const published = await publishWith(linked);
    const hero = blockNamed(linked, 'hero');
    await save(alice, linked, hero, { ...hero.fields, title: 'Still a draft' });
    snapshot = await linkStory(snapshot, linked);
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const translation = await store.createLocale(alice, snapshot.story.id, {
      spaceLocaleId: french.id,
    });
    const translated = await store.getSnapshot(alice, snapshot.story.id, translation.locale.id);
    expect((await referenceReview(translated)).references).toEqual([]);
    await publishWith(translated);
    expect(
      (await store.getSnapshot(alice, linked.story.id, linked.locale.id)).locale.publishedVersionId,
    ).toBe(published.publicationId);
  });
  it('persists scheduled choices and uses the pinned linked checkpoint when due', async () => {
    const linked = await copiedStory();
    snapshot = await linkStory(snapshot, linked);
    const job = await schedule(snapshot.checkpointId!, [
      { localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'publish' },
    ]);
    const hero = blockNamed(linked, 'hero');
    await save(alice, linked, hero, { ...hero.fields, title: 'Not scheduled' });
    await due(job.id);
    await store.runScheduledPublications();
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id))[0].status,
    ).toBe('published');
    expect(
      (await store.getPublication(alice, linked.story.id, linked.locale.id))?.checkpointId,
    ).toBe(linked.checkpointId);
  });
  it('fails a schedule as a unit if linked-story publishing access is lost', async () => {
    const linked = await copiedStory();
    snapshot = await linkStory(snapshot, linked);
    const job = await schedule(snapshot.checkpointId!, [
      { localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'publish' },
    ]);
    await scopedEditor({
      publish: { locations: { folderIds: [], storyIds: [snapshot.story.id] } },
    });
    await pool.query("UPDATE memberships SET role='editor' WHERE space_id=$1 AND user_id='alice'", [
      alice.spaceId,
    ]);
    await due(job.id);
    await store.runScheduledPublications();
    expect(
      (await store.listSchedules(alice, snapshot.story.id, snapshot.locale.id))[0].status,
    ).toBe('failed');
    expect(await store.getPublication(alice, snapshot.story.id, snapshot.locale.id)).toBeNull();
    expect(await store.getPublication(alice, linked.story.id, linked.locale.id)).toBeNull();
  });
  it('supports bulk publishing shared dependencies without overwriting an unrelated publication', async () => {
    const linked = await copiedStory(),
      second = await copiedStory('Second page');
    const parents = [await linkStory(snapshot, linked), await linkStory(second, linked)];
    const items = await Promise.all(
      parents.map(async (parent) => {
        const review = await store.reviewStoryAction(alice, parent.story.id);
        return {
          storyId: parent.story.id,
          input: {
            requestId: randomUUID(),
            action: 'publish',
            locales: review.locales.map((locale) => ({
              id: locale.id,
              checkpointId: locale.checkpointId,
              publicationId: locale.publicationId,
              referenceChoices: [
                {
                  localeId: linked.locale.id,
                  checkpointId: linked.checkpointId!,
                  action: 'publish',
                },
              ],
            })),
          },
        };
      }),
    );
    const result = await store.bulkStoryAction(alice, { items });
    expect(result.every((item) => item.result)).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM publications WHERE locale_id=$1', [
          linked.locale.id,
        ])
      ).rows[0].count,
    ).toBe(1);
    const hero = blockNamed(linked, 'hero');
    const changed = (
      await save(alice, linked, hero, { ...hero.fields, title: 'Published independently' })
    ).snapshot;
    await publishWith(changed);
    await expect(
      publishWith(parents[0], [
        { localeId: linked.locale.id, checkpointId: linked.checkpointId!, action: 'publish' },
      ]),
    ).rejects.toMatchObject({ code: 'stale_revision' });
  });
});
