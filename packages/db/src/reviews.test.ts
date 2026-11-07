import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import {
  contentScopesSchema,
  definitionInput,
  type Json,
  type Actor,
  type LocaleSnapshot,
  type Permission,
  type ContentScopes,
} from '@storypane/core';
import { StorypaneStore } from './store.js';
import { migrate } from './migrate.js';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
const target = new URL(connectionString);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
)
  throw new Error('Reviews tests require the dedicated local test database');
const schema = `reviews_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema},public`, max: 8 });
const store = new StorypaneStore(pool);
let author: Actor, bob: Actor, cara: Actor, dana: Actor, snapshot: LocaleSnapshot;
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(
    'CREATE TABLE "user"(id text PRIMARY KEY,name text NOT NULL,email text NOT NULL)',
  );
  await pool.query(
    `INSERT INTO "user" VALUES('author','Author','author@test.local'),('bob','Bob','bob@test.local'),('cara','Cara','cara@test.local'),('dana','Dana','dana@test.local')`,
  );
  await migrate(pool);
  await migrate(pool);
  for (const id of ['author', 'bob', 'cara', 'dana'])
    await pool.query("INSERT INTO cms_sessions VALUES($1,$2,now()+interval '1 day')", [
      `${id}-session`,
      id,
    ]);
});
beforeEach(async () => {
  const spaceId = randomUUID();
  [author, bob, cara, dana] = ['author', 'bob', 'cara', 'dana'].map((userId) => ({
    userId,
    sessionId: `${userId}-session`,
    spaceId,
    role: userId === 'author' ? 'admin' : 'editor',
  }));
  await store.seed(author);
  for (const actor of [bob, cara, dana])
    await pool.query("INSERT INTO memberships VALUES($1,$2,'editor')", [spaceId, actor.userId]);
  const story = (await store.listStories(author))[0];
  const locale = (await store.listLocales(author, story.id))[0];
  snapshot = await store.getSnapshot(author, story.id, locale.id);
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
const current = () => store.getSnapshot(author, snapshot.story.id, snapshot.locale.id);
async function request(
  options: {
    blockId?: string;
    reviewerIds?: string[];
    teamIds?: string[];
    kind?: 'comment';
    message?: string;
  } = {},
) {
  const directory = await store.reviewDirectory(author, {
    storyId: snapshot.story.id,
    localeId: snapshot.locale.id,
    blockId: options.blockId ?? null,
  });
  return store.createDiscussion(author, {
    storyId: snapshot.story.id,
    localeId: snapshot.locale.id,
    kind: 'review',
    reviewerIds: [bob.userId],
    ...options,
    expectedVersion: directory.version,
  });
}
async function thread(id: string, actor = author) {
  return (await store.listDiscussions(actor)).find((item) => item.id === id)!;
}
async function approve(id: string, actor = bob) {
  return store.actOnDiscussion(actor, id, {
    action: 'approve',
    expectedVersion: (await thread(id, actor)).version,
  });
}
const publish = async (state?: LocaleSnapshot) => {
  const value = state ?? (await current());
  return store.command(author, value.story.id, value.locale.id, {
    mutationId: randomUUID(),
    expectedRevisions: {},
    leaseTokens: {},
    type: 'publishCheckpoint',
    payload: { checkpointId: value.checkpointId! },
  });
};
async function edit(blockId: string, value: string) {
  const state = await current(),
    block = state.blocks.find((item) => item.id === blockId)!;
  const definition = state.definitions.find((item) => item.versionId === block.schemaVersionId)!;
  const field = definition.fields.find((item) => item.type === 'text')!;
  const lease = await store.acquireLease(author, state.story.id, state.locale.id, block.id);
  return store.command(author, state.story.id, state.locale.id, {
    mutationId: randomUUID(),
    expectedRevisions: { [block.id]: block.revision },
    leaseTokens: { [block.id]: lease.token! },
    type: 'saveBlock',
    payload: { blockId, fields: { ...block.fields, [field.name]: value } },
  });
}
async function role(
  actor: Actor,
  permissions: Permission[],
  contentScopes: ContentScopes = contentScopesSchema.parse({}),
) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO space_roles(space_id,id,name,permissions,content_scopes) VALUES($1,$2,$2,$3,$4)',
    [author.spaceId, id, permissions, JSON.stringify(contentScopes)],
  );
  await store.updateSpaceMember(author, actor.userId, { role: id });
}
const schedule = async (options: Record<string, unknown> = {}) => {
  const state = await current();
  const localTime = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
  return store.schedulePublication(author, state.story.id, state.locale.id, {
    requestId: randomUUID(),
    checkpointId: state.checkpointId!,
    localTime,
    timezone: 'UTC',
    dueAt: `${localTime}:00.000Z`,
    expectedScheduleId: null,
    expectedRevision: null,
    ...options,
  });
};

describe('Teams, discussions and content approvals', () => {
  it('requires all people and each team threshold, freezes team assignments, and records decisions without publishing', async () => {
    const team = await store.saveTeam(author, {
      name: 'Legal',
      memberIds: ['bob', 'cara', 'dana'],
      minimumApprovals: 2,
    });
    const { id } = await request({ reviewerIds: ['dana'], teamIds: [team.id] });
    expect((await thread(id, bob)).canDecide).toBe(true);
    await expect(approve(id, author)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(publish()).rejects.toThrow('outstanding review');
    await approve(id, bob);
    await expect(approve(id, bob)).rejects.toMatchObject({ code: 'forbidden' });
    expect((await thread(id)).teams[0].approvals).toBe(1);
    await store.saveTeam(
      author,
      { name: 'Legal renamed', memberIds: ['bob'], minimumApprovals: 1 },
      team.id,
    );
    expect((await thread(id)).teams[0]).toMatchObject({
      name: 'Legal',
      minimumApprovals: 2,
      memberIds: ['bob', 'cara', 'dana'],
    });
    await store.deleteTeam(author, team.id);
    await approve(id, cara);
    await expect(publish()).rejects.toThrow('outstanding review');
    await approve(id, dana);
    expect((await thread(id)).status).toBe('approved');
    expect((await current()).locale.publishedVersionId).toBeNull();
    expect(
      (await thread(id)).messages.filter((message) => message.event === 'approve'),
    ).toHaveLength(3);
    expect(
      (await thread(id)).messages.find((message) => message.event === 'approve'),
    ).toMatchObject({ contentVersion: (await thread(id)).version });
    await publish();
    expect((await thread(id)).status).toBe('published');
    await store.removeSpaceMember(author, 'bob');
    expect((await thread(id)).teams[0].approvals).toBe(3);
  });
  it('passes once a team reaches its configured threshold without requiring unanimity', async () => {
    const team = await store.saveTeam(author, {
      name: 'Editorial',
      memberIds: ['bob', 'cara', 'dana'],
      minimumApprovals: 2,
    });
    const { id } = await request({ reviewerIds: [], teamIds: [team.id] });
    await store.actOnDiscussion(bob, id, {
      action: 'request_changes',
      expectedVersion: (await thread(id, bob)).version,
      message: 'I would prefer another heading.',
    });
    await approve(id, cara);
    expect((await thread(id)).status).toBe('changes_requested');
    await approve(id, dana);
    expect((await thread(id)).status).toBe('approved');
    await publish();
  });
  it('invalidates whole-story approval on edits, rejects stale decisions and old checkpoints, and requires renewed approval', async () => {
    const { id } = await request();
    const before = await thread(id, bob);
    await approve(id);
    await edit(snapshot.locale.rootBlockId, 'New title');
    expect(await thread(id, bob)).toMatchObject({
      status: 'pending',
      canDecide: true,
      changed: true,
    });
    await expect(
      store.actOnDiscussion(bob, id, { action: 'approve', expectedVersion: before.version }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    await expect(publish()).rejects.toThrow('outstanding review');
    await approve(id);
    await expect(publish(snapshot)).rejects.toThrow('outstanding review');
    expect(
      (
        await store.reviewPublication(
          author,
          snapshot.story.id,
          snapshot.locale.id,
          (await current()).checkpointId!,
        )
      ).reviewBlocked,
    ).toBe(false);
    await publish();
  });
  it('keeps block approvals for unrelated edits and does not resurrect approvals on revert', async () => {
    const block = snapshot.blocks.find((item) => item.parentId === snapshot.locale.rootBlockId)!;
    const { id } = await request({ blockId: block.id });
    await approve(id);
    await edit(snapshot.locale.rootBlockId, 'Unrelated root change');
    expect((await thread(id)).status).toBe('approved');
    const version = (await thread(id)).version;
    await edit(block.id, 'New block title');
    expect((await thread(id)).status).toBe('pending');
    await edit(block.id, String(Object.values(block.fields)[0]));
    expect((await thread(id)).version).not.toBe(version);
    await expect(publish()).rejects.toThrow('outstanding review');
  });
  it('does not block republishing an unchanged published block, or close its pending review', async () => {
    await publish();
    const block = snapshot.blocks.find((item) => item.parentId === snapshot.locale.rootBlockId)!;
    const old = await current();
    await edit(block.id, 'Pending draft change');
    const { id } = await request({ blockId: block.id });
    await publish(old);
    expect((await thread(id)).status).toBe('pending');
    await expect(publish()).rejects.toThrow('outstanding review');
  });
  it('blocks bulk publishing and invalidates a component review when its nested content changes', async () => {
    const { id } = await request({ blockId: snapshot.locale.rootBlockId });
    const reviewed = await store.reviewStoryAction(author, snapshot.story.id);
    const input = {
      action: 'publish',
      requestId: randomUUID(),
      locales: reviewed.locales.map(({ id, checkpointId, publicationId }) => ({
        id,
        checkpointId,
        publicationId,
      })),
    };
    expect(
      (await store.bulkStoryAction(author, { items: [{ storyId: snapshot.story.id, input }] }))[0]
        .error?.message,
    ).toContain('outstanding review');
    await approve(id);
    await edit(
      snapshot.blocks.find((block) => block.parentId === snapshot.locale.rootBlockId)!.id,
      'Changed nested copy',
    );
    expect((await thread(id)).status).toBe('pending');
    expect((await current()).locale.publishedVersionId).toBeNull();
  });
  it('keeps deleted block discussions protected by their original content scope', async () => {
    const block = snapshot.blocks.find((item) => item.parentId === snapshot.locale.rootBlockId)!;
    const { id } = await request({ blockId: block.id });
    const scopes = contentScopesSchema.parse({});
    scopes.read.definitionIds = [
      ...new Set(
        snapshot.blocks.filter((item) => item.id !== block.id).map((item) => item.definitionId),
      ),
    ];
    await role(bob, ['content:read', 'content:review'], scopes);
    const parent = snapshot.blocks.find((item) => item.id === block.parentId)!;
    const leases = await Promise.all(
      [parent, block].map((item) =>
        store.acquireLease(author, snapshot.story.id, snapshot.locale.id, item.id),
      ),
    );
    await store.command(author, snapshot.story.id, snapshot.locale.id, {
      mutationId: randomUUID(),
      expectedRevisions: { [parent.id]: parent.revision, [block.id]: block.revision },
      leaseTokens: { [parent.id]: leases[0].token!, [block.id]: leases[1].token! },
      type: 'deleteBlock',
      payload: { blockId: block.id },
    });
    expect(
      (await store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id)).access?.complete,
    ).toBe(true);
    expect(await store.listDiscussions(bob)).toEqual([]);
    await expect(
      store.actOnDiscussion(bob, id, { action: 'reply', message: 'Cannot read original block' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.actOnDiscussion(author, id, {
        action: 'reply',
        message: '@Bob cannot read the original discussion',
        mentionIds: ['bob'],
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('treats comments, replies, mentions and resolution separately from publication approval', async () => {
    const { id } = await request({
      kind: 'comment',
      reviewerIds: [],
      message: '@Bob check this please',
    });
    await store.actOnDiscussion(bob, id, {
      action: 'reply',
      message: '@Author Looks good',
      mentionIds: ['author'],
    });
    await store.actOnDiscussion(bob, id, { action: 'resolve' });
    expect((await thread(id)).status).toBe('resolved');
    await store.actOnDiscussion(author, id, { action: 'reopen' });
    expect((await thread(id)).messages.at(-2)?.event).toBe('resolve');
    expect(
      (await thread(id)).messages.find((message) => message.event === 'reply')?.mentionIds,
    ).toEqual(['author']);
    await publish();
    const review = await request();
    await expect(
      store.actOnDiscussion(bob, review.id, { action: 'resolve' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('keeps changes requested blocking until renewed approval, and records withdrawal', async () => {
    const { id } = await request();
    await expect(
      store.actOnDiscussion(bob, id, {
        action: 'request_changes',
        expectedVersion: (await thread(id, bob)).version,
        message: 'Private note',
        mentionIds: ['outsider'],
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect((await thread(id)).status).toBe('pending');
    await store.actOnDiscussion(bob, id, {
      action: 'request_changes',
      expectedVersion: (await thread(id, bob)).version,
      message: '@Author Please clarify the introduction.',
      mentionIds: ['author'],
    });
    expect(
      (await thread(id)).messages.find((message) => message.event === 'request_changes')
        ?.mentionIds,
    ).toEqual(['author']);
    expect((await thread(id)).status).toBe('changes_requested');
    await expect(publish()).rejects.toThrow('outstanding review');
    await expect(store.actOnDiscussion(bob, id, { action: 'withdraw' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await store.actOnDiscussion(author, id, { action: 'withdraw' });
    expect(await thread(id)).toMatchObject({ status: 'withdrawn', canDecide: false });
    await publish();
  });
  it('blocks scheduling and rechecks a review requested after scheduling before release execution', async () => {
    const { id } = await request();
    await expect(schedule()).rejects.toThrow('outstanding review');
    await approve(id);
    const scheduled = await schedule();
    const second = await request();
    await pool.query(
      "UPDATE publication_schedules SET due_at=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' WHERE id=$1",
      [scheduled.id],
    );
    await pool.query("UPDATE content_releases SET due_at=now()-interval '1 minute' WHERE id=$1", [
      scheduled.releaseId,
    ]);
    await store.runScheduledPublications();
    expect((await current()).locale.publishedVersionId).toBeNull();
    expect((await thread(second.id)).status).toBe('pending');
    expect(
      (await store.listSchedules(author, snapshot.story.id, snapshot.locale.id))[0],
    ).toMatchObject({ status: 'failed' });
  });
  it('publishes approved release A while later draft B stays private', async () => {
    await edit(snapshot.locale.rootBlockId, 'Approved release A');
    const { id } = await request();
    await approve(id);
    const approved = await current();
    const versionA = (await thread(id)).version;
    const scheduled = await schedule();
    await edit(snapshot.locale.rootBlockId, 'Later draft B');
    expect((await thread(id)).status).toBe('pending');
    await expect(publish(approved)).rejects.toThrow('outstanding review');
    await pool.query("UPDATE content_releases SET due_at=now()-interval '1 minute' WHERE id=$1", [
      scheduled.releaseId,
    ]);
    await pool.query(
      "UPDATE publication_schedules SET due_at=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' WHERE id=$1",
      [scheduled.id],
    );
    await store.runScheduledPublications();
    expect(
      JSON.stringify(await store.getPublication(author, snapshot.story.id, snapshot.locale.id)),
    ).toContain('Approved release A');
    expect(JSON.stringify(await current())).toContain('Later draft B');
    expect(await thread(id)).toMatchObject({ status: 'published', version: versionA });
  });
  it('retains A approval when B is reviewed and does not apply a new B request to release A', async () => {
    await edit(snapshot.locale.rootBlockId, 'Approved release A');
    const { id } = await request();
    await approve(id);
    const scheduled = await schedule();
    await edit(snapshot.locale.rootBlockId, 'Later approved B');
    await approve(id);
    const newer = await request();
    await pool.query("UPDATE content_releases SET due_at=now()-interval '1 minute' WHERE id=$1", [
      scheduled.releaseId,
    ]);
    await pool.query(
      "UPDATE publication_schedules SET due_at=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' WHERE id=$1",
      [scheduled.id],
    );
    await store.runScheduledPublications();
    expect(
      JSON.stringify(await store.getPublication(author, snapshot.story.id, snapshot.locale.id)),
    ).toContain('Approved release A');
    expect(await thread(id)).toMatchObject({ status: 'published' });
    expect(await thread(newer.id)).toMatchObject({ status: 'pending' });
    expect(
      (await pool.query('SELECT version FROM review_decisions WHERE discussion_id=$1', [id]))
        .rowCount,
    ).toBe(2);
  });

  it('enforces review ability, team eligibility, space boundaries, and current membership', async () => {
    await expect(
      store.saveTeam(bob, { name: 'Escalation', memberIds: ['bob'], minimumApprovals: 1 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.saveTeam(author, { name: 'Outsiders', memberIds: ['outsider'], minimumApprovals: 1 }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(request({ reviewerIds: ['author'] })).rejects.toMatchObject({ code: 'invalid' });
    await role(cara, ['content:read']);
    const team = await store.saveTeam(author, {
      name: 'Too few reviewers',
      memberIds: ['bob', 'cara'],
      minimumApprovals: 2,
    });
    await expect(request({ reviewerIds: [], teamIds: [team.id] })).rejects.toMatchObject({
      code: 'invalid',
    });
    const { id } = await request();
    await expect(approve(id, cara)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.actOnDiscussion({ ...bob, spaceId: randomUUID() }, id, {
        action: 'approve',
        expectedVersion: 'x',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await approve(id);
    await store.removeSpaceMember(author, 'bob');
    expect((await thread(id)).status).toBe('pending');
    await expect(publish()).rejects.toThrow('outstanding review');
  });
  it('uses locale-specific review state and allows a commenter without editing or publishing access', async () => {
    await role(bob, ['content:read', 'content:review']);
    const { id } = await request();
    await approve(id);
    await expect(
      store.command(bob, snapshot.story.id, snapshot.locale.id, {
        mutationId: randomUUID(),
        expectedRevisions: {},
        leaseTokens: {},
        type: 'publishCheckpoint',
        payload: { checkpointId: snapshot.checkpointId! },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const french = await store.createSpaceLocale(author, { name: 'French', slug: 'fr' });
    const locale = await store.createLocale(author, snapshot.story.id, {
      spaceLocaleId: french.id,
    });
    await store.createDiscussion(author, {
      storyId: snapshot.story.id,
      localeId: locale.locale.id,
      kind: 'review',
      reviewerIds: ['bob'],
      expectedVersion: (
        await store.reviewDirectory(author, {
          storyId: snapshot.story.id,
          localeId: locale.locale.id,
        })
      ).version,
    });
    await publish();
    expect(
      (await store.listDiscussions(author)).find((item) => item.localeId === locale.locale.id)
        ?.status,
    ).toBe('pending');
  });
  it('filters discussions and mentions by full target access and does not leak lease tokens or review snapshots', async () => {
    const hero = snapshot.blocks.find((item) => item.parentId === snapshot.locale.rootBlockId)!;
    const { id } = await request({ blockId: hero.id });
    const scopes = contentScopesSchema.parse({});
    scopes.read.definitionIds = [
      snapshot.blocks.find((item) => item.id === snapshot.locale.rootBlockId)!.definitionId,
    ];
    await role(bob, ['content:read', 'content:review'], scopes);
    expect(await store.listDiscussions(bob)).toEqual([]);
    await expect(
      store.actOnDiscussion(bob, id, { action: 'reply', message: 'Hidden' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(request({ blockId: hero.id, reviewerIds: ['bob'] })).rejects.toMatchObject({
      code: 'invalid',
    });
    const directory = await store.reviewDirectory(author, {
      storyId: snapshot.story.id,
      localeId: snapshot.locale.id,
      blockId: hero.id,
    });
    expect(directory.members.some((person) => person.id === 'bob')).toBe(false);
    const lease = await store.acquireLease(author, snapshot.story.id, snapshot.locale.id, hero.id);
    const serialized = JSON.stringify(await store.listDiscussions(author));
    expect(serialized).not.toContain(lease.token);
    expect(serialized).not.toContain('scope_snapshot');
  });
});

describe('Read-only release versions', () => {
  async function preview(scheduled: { id: string; revision: number }, actor = author) {
    const previewId = randomUUID();
    await store.updateDeliverySettings(author, {
      previewUrls: [{ id: previewId, name: 'Local', url: 'http://localhost:3131/{slug}' }],
      defaultPreviewId: previewId,
    });
    const session = await store.createEditorPreview(actor, snapshot.story.id, snapshot.locale.id, {
      scheduleId: scheduled.id,
      scheduleRevision: scheduled.revision,
    });
    return store.authenticatePreview(session.token, 'http://localhost:3131');
  }
  async function save(state: LocaleSnapshot, fields: Record<string, Json>) {
    const block = state.blocks.find((item) => item.id === state.locale.rootBlockId)!;
    const lease = await store.acquireLease(author, state.story.id, state.locale.id, block.id);
    return (
      await store.command(author, state.story.id, state.locale.id, {
        mutationId: randomUUID(),
        expectedRevisions: { [block.id]: block.revision },
        leaseTokens: { [block.id]: lease.token! },
        type: 'saveBlock',
        payload: { blockId: block.id, fields: { ...block.fields, ...fields } },
      })
    ).snapshot;
  }
  it('pins fields and SDK preview to A, filters readers, and revokes changed or canceled approvals', async () => {
    await edit(snapshot.locale.rootBlockId, 'Approved release A');
    const scheduled = await schedule();
    await edit(snapshot.locale.rootBlockId, 'Later private B');
    const frozen = await store.getScheduledSnapshot(
      author,
      snapshot.story.id,
      snapshot.locale.id,
      scheduled.id,
      scheduled.revision,
    );
    expect(JSON.stringify(frozen)).toContain('Approved release A');
    expect(JSON.stringify(frozen)).not.toContain('Later private B');
    expect(frozen.leases).toEqual([]);
    const connection = await preview(scheduled);
    expect(JSON.stringify(await store.previewStory(connection.id))).toContain('Approved release A');
    expect(JSON.stringify(await store.previewStory(connection.id))).not.toContain(
      'Later private B',
    );
    await expect(
      store.getScheduledSnapshot(
        author,
        snapshot.story.id,
        snapshot.locale.id,
        scheduled.id,
        scheduled.revision + 1,
      ),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    await expect(
      store.getScheduledSnapshot(
        { ...author, spaceId: randomUUID() },
        snapshot.story.id,
        snapshot.locale.id,
        scheduled.id,
        scheduled.revision,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await role(
      bob,
      ['content:read'],
      contentScopesSchema.parse({
        read: {
          definitionIds: [
            snapshot.blocks.find((item) => item.id === snapshot.locale.rootBlockId)!.definitionId,
          ],
        },
      }),
    );
    const scoped = await store.getScheduledSnapshot(
      bob,
      snapshot.story.id,
      snapshot.locale.id,
      scheduled.id,
      scheduled.revision,
    );
    expect(scoped.access?.complete).toBe(false);
    await expect(preview(scheduled, bob)).rejects.toMatchObject({ code: 'forbidden' });
    await pool.query('UPDATE publication_schedules SET revision=revision+1 WHERE id=$1', [
      scheduled.id,
    ]);
    await expect(store.previewStory(connection.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await pool.query('UPDATE publication_schedules SET revision=revision-1 WHERE id=$1', [
      scheduled.id,
    ]);
    await store.cancelSchedule(author, snapshot.story.id, snapshot.locale.id, scheduled.id, {
      requestId: randomUUID(),
      revision: scheduled.revision,
    });
    await expect(store.previewStory(connection.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      store.getScheduledSnapshot(
        author,
        snapshot.story.id,
        snapshot.locale.id,
        scheduled.id,
        scheduled.revision,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('previews same-release linked checkpoints, published fallback, and omitted references without later drafts', async () => {
    const definitions = await store.listDefinitions(author);
    const page = definitions.find((item) => item.name === 'page')!;
    await store.updateDefinition(author, page.id, {
      ...definitionInput(page),
      fields: [
        ...page.fields,
        { name: 'related', label: 'Related', type: 'options', source: { type: 'stories' } },
      ],
    });
    const migration = (await store.listMigrations(author)).find(
      (item) => item.status === 'active',
    )!;
    const review = await store.reviewMigration(author, migration.id);
    await store.deployMigration(author, migration.id, review.token, {
      confirmation: review.confirmation ?? undefined,
    });
    const linked = await store.createStory(author, {
      name: 'Linked',
      slug: 'linked',
      definitionId: page.id,
    });
    let shared = await save(linked, { title: 'Linked approved A' });
    await save(await current(), { title: 'Root A', related: [linked.story.id] });
    const scheduled = await schedule({
      referenceChoices: [
        {
          localeId: shared.locale.id,
          checkpointId: shared.checkpointId,
          action: 'publish',
          publicationId: null,
        },
      ],
    });
    const connection = await preview(scheduled);
    shared = await save(shared, { title: 'Linked private B' });
    await edit(snapshot.locale.rootBlockId, 'Root private B');
    const content = await store.previewStory(connection.id);
    expect(content.content).toMatchObject({ title: 'Root A' });
    expect(content.references?.[0].content).toMatchObject({ title: 'Linked approved A' });
    expect(JSON.stringify(content)).not.toContain('private B');
    await pool.query("UPDATE publication_schedules SET status='cancelled' WHERE release_id=$1", [
      scheduled.releaseId,
    ]);
    await store.command(author, shared.story.id, shared.locale.id, {
      mutationId: randomUUID(),
      expectedRevisions: {},
      leaseTokens: {},
      type: 'publishCheckpoint',
      payload: { checkpointId: shared.checkpointId! },
    });
    const publishedId = (await store.getSnapshot(author, shared.story.id, shared.locale.id)).locale
      .publishedVersionId;
    const publishedCheckpoint = shared.checkpointId;
    shared = await save(shared, { title: 'Linked private C' });
    const fallback = await schedule({
      referenceChoices: [
        {
          localeId: shared.locale.id,
          action: 'publish',
          checkpointId: publishedCheckpoint,
          publicationId: publishedId,
        },
      ],
    });
    const fallbackSession = await preview(fallback);
    expect((await store.previewStory(fallbackSession.id)).references?.[0].content).toMatchObject({
      title: 'Linked private B',
    });
    await pool.query("UPDATE publication_schedules SET status='cancelled' WHERE release_id=$1", [
      fallback.releaseId,
    ]);
    const omitted = await schedule({
      referenceChoices: [
        {
          localeId: shared.locale.id,
          action: 'omit',
          checkpointId: shared.checkpointId,
          publicationId: publishedId,
        },
      ],
    });
    const omittedSession = await preview(omitted);
    expect((await store.previewStory(omittedSession.id)).references).toEqual([]);
    expect((await store.previewStory(omittedSession.id)).content).toMatchObject({ related: [] });
    expect(
      JSON.stringify(
        await store.getScheduledSnapshot(
          author,
          snapshot.story.id,
          snapshot.locale.id,
          omitted.id,
          omitted.revision,
        ),
      ),
    ).not.toContain(linked.story.id);
  });
  it('rechecks current reviewer permission when the pinned release publishes', async () => {
    const { id } = await request();
    await approve(id);
    const scheduled = await schedule();
    await edit(snapshot.locale.rootBlockId, 'Later draft B');
    await role(bob, ['content:read']);
    await pool.query("UPDATE content_releases SET due_at=now()-interval '1 minute' WHERE id=$1", [
      scheduled.releaseId,
    ]);
    await pool.query(
      "UPDATE publication_schedules SET due_at=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' WHERE id=$1",
      [scheduled.id],
    );
    await store.runScheduledPublications();
    expect((await current()).locale.publishedVersionId).toBeNull();
    expect(
      (await store.listSchedules(author, snapshot.story.id, snapshot.locale.id))[0],
    ).toMatchObject({ status: 'failed' });
  });
});
