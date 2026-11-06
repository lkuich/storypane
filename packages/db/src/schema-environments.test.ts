import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import {
  definitionInput,
  portableDefinitions,
  type Actor,
  type SchemaTransferReview,
} from '@storypane/core';
import { migrate } from './migrate';
import { StorypaneStore } from './store';
import { captureSchema, schemaStatus, transferSchema } from './schema-environments';
const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
if (
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('A disposable local test database is required');
const admin = new Pool({ connectionString: url });
const schemas = Array.from({ length: 3 }, () => `environments_${randomUUID().replaceAll('-', '')}`);
const pools = schemas.map(
  (schema) =>
    new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 5 }),
);
const stores = pools.map((pool) => new StorypaneStore(pool));
let actors: Actor[];
async function deploy(index: number) {
  const m = (await stores[index].listMigrations(actors[index])).find((m) => m.status === 'active')!;
  const review = await stores[index].reviewMigration(actors[index], m.id);
  expect(review.blockers).toEqual([]);
  return stores[index].deployMigration(actors[index], m.id, review.token, {
    confirmation: review.confirmation ?? undefined,
  });
}
async function edit(index: number, name: string) {
  const d = (await stores[index].listDefinitions(actors[index]))[0];
  await stores[index].updateDefinition(actors[index], d.id, {
    ...definitionInput(d),
    displayName: name,
  });
  return deploy(index);
}
async function review(index: number, action: 'sync' | 'promote', resolutions = {}) {
  return transferSchema(stores[index], actors[index], stores[0], actors[0], {
    id: randomUUID(),
    action,
    resolutions,
  });
}
async function apply(index: number, r: SchemaTransferReview) {
  return transferSchema(stores[index], actors[index], stores[0], actors[0], {
    id: r.id,
    action: r.action,
    resolutions: r.resolutions,
    reviewToken: r.token,
    ...(r.confirmation ? { confirmation: r.confirmation } : {}),
  });
}
beforeAll(async () => {
  for (const [i, schema] of schemas.entries()) {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pools[i].query('CREATE TABLE "user"(id text PRIMARY KEY,name text,email text)');
    await pools[i].query(
      'CREATE TABLE "session"(id text PRIMARY KEY,"userId" text,"expiresAt" timestamptz)',
    );
    await pools[i].query("INSERT INTO \"user\" VALUES('alice','Alice','alice@example.test')");
    await pools[i].query(
      "INSERT INTO \"session\" VALUES('session','alice',now()+interval '1 day')",
    );
    await migrate(pools[i]);
    await pools[i].query(
      "INSERT INTO cms_sessions(id,user_id,expires_at) VALUES('session','alice',now()+interval '1 day') ON CONFLICT(id) DO NOTHING",
    );
  }
});
beforeEach(async () => {
  actors = [];
  for (let i = 0; i < 3; i++) {
    await pools[i].query('TRUNCATE spaces CASCADE');
    await pools[i].query('TRUNCATE schema_transfers');
    const s = await stores[i].createSpace(
      { userId: 'alice', sessionId: 'session' },
      { name: i ? `Dev ${i}` : 'Production' },
    );
    actors.push({ userId: 'alice', sessionId: 'session', spaceId: s.id, role: 'admin' });
  }
  const definition = await stores[0].createDefinition(actors[0], {
    name: 'page',
    displayName: 'Page',
    kind: 'content-type',
    fields: [{ name: 'title', label: 'Title', type: 'text' }],
  });
  const prod = await deploy(0);
  for (let i = 1; i < 3; i++) {
    await pools[i].query("UPDATE spaces SET environment='dev',production_space_id=$2 WHERE id=$1", [
      actors[i].spaceId,
      actors[0].spaceId,
    ]);
    await stores[i].pushMigration(actors[i], {
      formatVersion: 2,
      id: randomUUID(),
      spaceId: actors[i].spaceId,
      version: 1,
      baseVersion: 0,
      name: 'Baseline',
      definitions: portableDefinitions([definition]),
      remoteRevision: null,
      sourceHash: null,
      status: 'active',
    });
    await deploy(i);
    await pools[i].query(
      'INSERT INTO schema_branches(space_id,production_head,baseline,local_version) VALUES($1,$2,$3,1)',
      [actors[i].spaceId, prod.id, JSON.stringify(portableDefinitions([definition]))],
    );
  }
  await stores[0].updateSpace(actors[0], { name: 'Production', schemaReadOnly: true });
});
afterAll(async () => {
  for (const pool of pools) await pool.end();
  for (const schema of schemas) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
it('blocks all direct writes in protected production, including legacy token writes', async () => {
  const d = (await stores[0].listDefinitions(actors[0]))[0];
  await expect(
    stores[0].updateDefinition(actors[0], d.id, definitionInput(d)),
  ).rejects.toMatchObject({ code: 'forbidden' });
  await expect(
    stores[0].moveDefinition(actors[0], d.id, {
      parentDefinitionId: null,
      expectedParentDefinitionId: null,
    }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  await expect(
    stores[0].createDefinition(actors[0], {
      name: 'blocked',
      displayName: 'Blocked',
      kind: 'nestable',
      fields: [],
    }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  const token = await stores[0].createManagementToken(actors[0], {
    name: 'Deploy',
    capability: 'deploy',
  });
  const actor = await stores[0].authenticateManagement(token.token, actors[0].spaceId);
  await expect(stores[0].updateDefinition(actor, d.id, definitionInput(d))).rejects.toMatchObject({
    code: 'forbidden',
  });
});
it('reviews without mutation, promotes once, marks siblings behind, and explicitly syncs them', async () => {
  await edit(1, 'From Dev 1');
  const r = await review(1, 'promote');
  expect((await stores[0].listDefinitions(actors[0], true))[0].displayName).toBe('Page');
  await apply(1, r);
  await apply(1, r);
  expect(
    (await stores[0].listMigrations(actors[0])).filter((m) => m.status === 'deployed'),
  ).toHaveLength(3);
  expect((await schemaStatus(stores[2], actors[2], stores[0], actors[0])).behind).toBe(true);
  const sync = await review(2, 'sync');
  await apply(2, sync);
  expect((await schemaStatus(stores[2], actors[2], stores[0], actors[0])).behind).toBe(false);
  expect((await stores[2].listDefinitions(actors[2], true))[0].displayName).toBe('From Dev 1');
});
it('rejects stale promotion and reconciles competing changes without rewriting dev history', async () => {
  await edit(1, 'First');
  await edit(2, 'Second');
  const second = await review(2, 'promote');
  await apply(1, await review(1, 'promote'));
  await expect(apply(2, second)).rejects.toMatchObject({ code: 'stale_revision' });
  const before = (await stores[2].listMigrations(actors[2])).filter((m) => m.status === 'deployed');
  const sync = await review(2, 'sync');
  expect(sync.conflicts.length).toBeGreaterThan(0);
  const resolved = await review(
    2,
    'sync',
    Object.fromEntries(sync.conflicts.map((c) => [c.path, 'dev'])),
  );
  await apply(2, resolved);
  expect(
    (await stores[2].listMigrations(actors[2]))
      .filter((m) => m.status === 'deployed')
      .slice(0, before.length),
  ).toEqual(before);
  await apply(2, await review(2, 'promote'));
  expect((await stores[0].listDefinitions(actors[0], true))[0].displayName).toBe('Second');
});
it('invalidates reviews after source edits and preserves an active draft during sync', async () => {
  await edit(1, 'First');
  const stale = await review(1, 'promote');
  await edit(1, 'Second');
  await expect(apply(1, stale)).rejects.toMatchObject({ code: 'stale_revision' });
  await apply(1, await review(1, 'promote'));
  const d = (await stores[2].listDefinitions(actors[2]))[0];
  await stores[2].updateDefinition(actors[2], d.id, {
    ...definitionInput(d),
    fields: [...d.fields, { name: 'extra', label: 'Extra', type: 'boolean' }],
  });
  await apply(2, await review(2, 'sync'));
  const active = (await stores[2].listMigrations(actors[2])).find((m) => m.status === 'active')!;
  expect(active.definitions[0].displayName).toBe('Second');
  expect(active.definitions[0].fields.at(-1)?.name).toBe('extra');
  expect((await stores[2].listDefinitions(actors[2], true))[0].fields).toHaveLength(1);
});

it('preserves intermediate type resets in production and during explicit dev sync', async () => {
  const original = (await stores[1].listDefinitions(actors[1]))[0];
  const prodStory = await stores[0].createStory(actors[0], {
    name: 'Production content',
    slug: 'content',
    definitionId: original.id,
  });
  const devStory = await stores[2].createStory(actors[2], {
    name: 'Test content',
    slug: 'content',
    definitionId: original.id,
  });
  for (const [i, story] of [
    [0, prodStory],
    [2, devStory],
  ] as const)
    await pools[i].query('UPDATE block_drafts SET fields=$2 WHERE id=$1', [
      story.locale.rootBlockId,
      JSON.stringify({ title: 'Must be reset' }),
    ]);
  const f = original.fields[0];
  await stores[1].updateDefinition(actors[1], original.id, {
    ...definitionInput(original),
    fields: [{ id: f.id, name: f.name, label: f.label, type: 'number' }],
  });
  await deploy(1);
  const changed = (await stores[1].listDefinitions(actors[1]))[0];
  await stores[1].updateDefinition(actors[1], original.id, {
    ...definitionInput(changed),
    fields: original.fields,
  });
  await deploy(1);
  const promotion = await review(1, 'promote');
  expect(promotion.steps).toHaveLength(2);
  expect(promotion.confirmation).toBeTruthy();
  await apply(1, promotion);
  expect(
    (await stores[0].getSnapshot(actors[0], prodStory.story.id, prodStory.locale.id)).blocks[0]
      .fields.title,
  ).toBeUndefined();
  const sync = await review(2, 'sync');
  expect(sync.steps).toHaveLength(2);
  await apply(2, sync);
  expect(
    (await stores[2].getSnapshot(actors[2], devStory.story.id, devStory.locale.id)).blocks[0].fields
      .title,
  ).toBeUndefined();
});
it('serializes concurrent promotions and rejects a changed content review', async () => {
  await edit(1, 'First');
  await edit(2, 'Second');
  const first = await review(1, 'promote'),
    second = await review(2, 'promote');
  const results = await Promise.allSettled([apply(1, first), apply(2, second)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const loser = results[0].status === 'rejected' ? 1 : 2;
  const sync = await review(loser, 'sync');
  const resolved = await review(
    loser,
    'sync',
    Object.fromEntries(sync.conflicts.map((c) => [c.path, 'dev'])),
  );
  await apply(loser, resolved);
  const stale = await review(loser, 'promote');
  const definition = (await stores[0].listDefinitions(actors[0], true))[0];
  await stores[0].createStory(actors[0], {
    name: 'Created after review',
    slug: 'new',
    definitionId: definition.id,
  });
  await expect(apply(loser, stale)).rejects.toMatchObject({ code: 'stale_revision' });
});

it('requires independent deployment permission in both spaces and honors token revocation', async () => {
  await edit(1, 'Authorized candidate');
  const read = await stores[0].createManagementToken(actors[0], {
    name: 'Read only',
    capability: 'read',
  });
  const reader = await stores[0].authenticateManagement(read.token, actors[0].spaceId);
  await expect(
    transferSchema(stores[1], actors[1], stores[0], reader, {
      id: randomUUID(),
      action: 'promote',
    }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  const token = await stores[0].createManagementToken(actors[0], {
    name: 'Deploy',
    capability: 'deploy',
  });
  const deployer = await stores[0].authenticateManagement(token.token, actors[0].spaceId);
  const r = await transferSchema(stores[1], actors[1], stores[0], deployer, {
    id: randomUUID(),
    action: 'promote',
  });
  await stores[0].revokeManagementToken(actors[0], token.id);
  await expect(
    transferSchema(stores[1], actors[1], stores[0], deployer, {
      id: r.id,
      action: 'promote',
      reviewToken: r.token,
    }),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
  expect((await captureSchema(stores[0], actors[0])).head.version).toBe(1);
});

it('recognizes a committed promotion during sync even if its source acknowledgement was lost', async () => {
  const before = (await pools[1].query('SELECT * FROM schema_branches')).rows[0];
  await edit(1, 'Committed once');
  await apply(1, await review(1, 'promote'));
  await pools[1].query(
    'UPDATE schema_branches SET production_head=$1,baseline=$2,local_version=$3,pending=$4',
    [
      before.production_head,
      JSON.stringify(before.baseline),
      before.local_version,
      JSON.stringify(before.pending),
    ],
  );
  expect((await schemaStatus(stores[1], actors[1], stores[0], actors[0])).behind).toBe(true);
  const sync = await review(1, 'sync');
  expect(sync.conflicts).toEqual([]);
  await apply(1, sync);
  expect((await schemaStatus(stores[1], actors[1], stores[0], actors[0])).pending).toEqual([]);
  expect((await captureSchema(stores[0], actors[0])).head.version).toBe(2);
});

it('copies required story cycles as drafts and preserves existing target stories on later promotions', async () => {
  const page = (await stores[1].listDefinitions(actors[1]))[0];
  await stores[1].updateDefinition(actors[1], page.id, {
    ...definitionInput(page),
    fields: [...page.fields, { name: 'related', label: 'Related', type: 'link' }],
  });
  await deploy(1);
  const stories = [];
  for (const slug of ['first', 'second', 'unrelated'])
    stories.push(
      await stores[1].createStory(actors[1], {
        name: slug,
        slug,
        definitionId: page.id,
      }),
    );
  for (const [index, target] of [
    [0, 1],
    [1, 0],
  ])
    await pools[1].query('UPDATE block_drafts SET fields=$2 WHERE id=$1', [
      stories[index].locale.rootBlockId,
      JSON.stringify({
        title: 'Original',
        related: { type: 'story', storyId: stories[target].story.id },
      }),
    ]);
  await pools[1].query(
    "INSERT INTO space_locales(space_id,name,slug) VALUES($1,'Unused locale','unused')",
    [actors[1].spaceId],
  );
  await stores[1].createDefinition(actors[1], {
    name: 'call_to_action',
    displayName: 'Call to action',
    kind: 'nestable',
    fields: [
      {
        name: 'link',
        label: 'Link',
        type: 'link',
        defaultValue: { type: 'story', storyId: stories[0].story.id },
      },
    ],
  });
  await deploy(1);
  const promotion = await review(1, 'promote');
  expect(promotion.dependencies.stories.map((s) => s.id).sort()).toEqual(
    stories
      .slice(0, 2)
      .map((s) => s.story.id)
      .sort(),
  );
  expect((await pools[0].query('SELECT id FROM stories')).rows).toEqual([]);
  await apply(1, promotion);
  const copied = await stores[0].getSnapshot(actors[0], stories[0].story.id, stories[0].locale.id);
  expect(copied.locale.publishedVersionId).toBeNull();
  expect(copied.blocks[0].fields.related).toEqual({ type: 'story', storyId: stories[1].story.id });
  expect((await pools[0].query("SELECT id FROM space_locales WHERE slug='unused'")).rows).toEqual(
    [],
  );
  await pools[1].query('UPDATE block_drafts SET fields=$2 WHERE id=$1', [
    stories[0].locale.rootBlockId,
    JSON.stringify({ title: 'Dev edit', related: { type: 'story', storyId: stories[2].story.id } }),
  ]);
  await edit(1, 'Next migration');
  const next = await review(1, 'promote');
  expect(next.dependencies.stories).toEqual([]);
  await apply(1, next);
  const preserved = await stores[0].getSnapshot(
    actors[0],
    stories[0].story.id,
    stories[0].locale.id,
  );
  expect(preserved.blocks[0].fields.title).toBe('Original');
  expect(preserved.blocks[0].fields.related).toEqual({
    type: 'story',
    storyId: stories[1].story.id,
  });
  expect(
    (await pools[0].query('SELECT id FROM stories WHERE id=$1', [stories[2].story.id])).rows,
  ).toEqual([]);
});

it('rolls back the entire batch when a later migration is blocked by production content', async () => {
  const page = (await stores[1].listDefinitions(actors[1]))[0];
  await stores[0].createStory(actors[0], {
    name: 'Existing content',
    slug: 'existing',
    definitionId: page.id,
  });
  const before = await captureSchema(stores[0], actors[0]);
  await edit(1, 'First step');
  const changed = (await stores[1].listDefinitions(actors[1]))[0];
  await stores[1].deleteDefinition(actors[1], page.id, {
    expectedVersionId: changed.versionId,
    baseVersion: 2,
  });
  await deploy(1);
  const r = await review(1, 'promote');
  expect(r.steps).toHaveLength(2);
  expect(r.steps[0].blockers).toEqual([]);
  expect(r.steps[1].blockers.length).toBeGreaterThan(0);
  await expect(apply(1, r)).rejects.toMatchObject({ code: 'invalid' });
  const after = await captureSchema(stores[0], actors[0]);
  expect(after.deployed).toEqual(before.deployed);
  expect(after.definitions).toEqual(before.definitions);
  expect((await pools[0].query('SELECT id FROM schema_transfers')).rows).toEqual([]);
  expect((await schemaStatus(stores[1], actors[1], stores[0], actors[0])).pending).toHaveLength(2);
});
