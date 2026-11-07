import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import {
  contentScopesSchema,
  type Actor,
  type LocaleSnapshot,
  type LocaleSourceInput,
} from '@storypane/core';
import { migrate } from './migrate.js';
import { StorypaneStore } from './store.js';
const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
const url = new URL(connectionString);
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
)
  throw new Error('Use the disposable test database');
const schema = `locale_source_${randomUUID().replaceAll('-', '')}`,
  admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema},public` }),
  store = new StorypaneStore(pool);
let actor: Actor, source: LocaleSnapshot, target: LocaleSnapshot;
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await pool.query(
    `INSERT INTO "user"(id,name,email) VALUES('locale-author','Author','author@locale.test'),('locale-other','Other','other@locale.test'); INSERT INTO cms_sessions VALUES('locale-session','locale-author',now()+interval '1 day'),('other-session','locale-other',now()+interval '1 day')`,
  );
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  actor = {
    spaceId: randomUUID(),
    userId: 'locale-author',
    sessionId: 'locale-session',
    role: 'admin',
  };
  await store.seed(actor);
  const story = (await store.listStories(actor))[0],
    locale = (await store.listLocales(actor, story.id))[0];
  source = await store.getSnapshot(actor, story.id, locale.id);
  const french = await store.createSpaceLocale(actor, { name: 'CA-FR', slug: 'ca-fr' });
  target = await store.createLocale(actor, story.id, { spaceLocaleId: french.id });
});
const read = () => store.reviewLocaleSource(actor, source.story.id, target.locale.id);
const current = () => store.getSnapshot(actor, source.story.id, target.locale.id);
const roots = () => source.blocks.filter((b) => b.parentId === source.locale.rootBlockId);
async function command(input: LocaleSourceInput) {
  const s = await current(),
    b = s.blocks.find((b) => b.id === s.locale.rootBlockId)!,
    lease = await store.acquireLease(actor, s.story.id, s.locale.id, b.id);
  const cmd = {
    type: 'updateLocaleSource',
    payload: input,
    mutationId: randomUUID(),
    expectedRevisions: { [b.id]: b.revision },
    leaseTokens: { [b.id]: lease.token! },
  };
  return store.command(actor, s.story.id, s.locale.id, cmd);
}
async function copy() {
  return command({
    action: 'copy',
    token: (await read()).token,
    copyRoot: true,
    blockIds: roots().map((b) => b.id),
  });
}
async function edit(locale: LocaleSnapshot, id: string, values: Record<string, string>) {
  const s = await store.getSnapshot(actor, locale.story.id, locale.locale.id),
    b = s.blocks.find((b) => b.id === id)!,
    lease = await store.acquireLease(actor, s.story.id, s.locale.id, id);
  return store.command(actor, s.story.id, s.locale.id, {
    type: 'saveBlock',
    mutationId: randomUUID(),
    expectedRevisions: { [id]: b.revision },
    leaseTokens: { [id]: lease.token! },
    payload: { blockId: id, fields: { ...b.fields, ...values } },
  });
}
async function decide(action: 'apply' | 'keep', ids?: string[]) {
  const r = await read();
  return command({
    action: 'update',
    token: r.token,
    decisions: r.changes
      .filter((c) => !ids || ids.includes(c.id))
      .map((c) => ({ id: c.id, action })),
    reviewedIds: [],
  });
}
it('creates an independent whole-page draft including root fields, and does not duplicate on a retry', async () => {
  await edit(source, source.locale.rootBlockId, { title: 'Source metadata' });
  const before = await current(),
    result = await copy(),
    r = await read();
  expect(result.snapshot.blocks).toHaveLength(source.blocks.length);
  expect(result.snapshot.blocks.find((b) => b.id === target.locale.rootBlockId)?.fields.title).toBe(
    'Source metadata',
  );
  expect(result.snapshot.blocks.every((b) => !source.blocks.some((s) => s.id === b.id))).toBe(true);
  expect(result.snapshot.locale.urlSlug).toBe(before.locale.urlSlug);
  expect(result.snapshot.locale.publishedVersionId).toBe(before.locale.publishedVersionId);
  expect(r.changes).toEqual([]);
  expect(r.needsTranslation).toHaveLength(source.blocks.length);
  await expect(copy()).rejects.toThrow('empty, unlinked');
});
it('compares source changes rather than translations and preserves untouched localized fields', async () => {
  await copy();
  const hero = roots()[0],
    id = (await read()).mappings[hero.id]!;
  await edit(target, id, { title: 'Bonjour', description: 'Description française' });
  expect((await read()).changes).toEqual([]);
  await edit(source, hero.id, { title: 'Changed source' });
  let r = await read();
  expect(r.changes).toHaveLength(1);
  expect(r.changes[0].safe).toBe(false);
  expect(r.changes[0].fields?.[0]).toMatchObject({
    source: 'Changed source',
    local: 'Bonjour',
    conflict: true,
  });
  await decide('keep');
  expect((await read()).changes).toEqual([]);
  expect((await current()).blocks.find((b) => b.id === id)?.fields.title).toBe('Bonjour');
  await edit(source, hero.id, { title: 'Changed again' });
  r = await read();
  expect(r.changes[0].safe).toBe(false);
  await decide('apply');
  expect((await current()).blocks.find((b) => b.id === id)?.fields.title).toBe('Changed again');
  expect((await current()).blocks.find((b) => b.id === id)?.fields.description).toBe(
    'Description française',
  );
});
it('preselects only unchanged source fields and rejects a stale source or target review', async () => {
  await copy();
  const hero = roots()[0];
  await edit(source, hero.id, { title: 'Safe update' });
  let r = await read();
  expect(r.changes[0].safe).toBe(true);
  await edit(target, target.locale.rootBlockId, { title: 'Local metadata' });
  await expect(
    command({
      action: 'update',
      token: r.token,
      decisions: [{ id: r.changes[0].id, action: 'apply' }],
      reviewedIds: [],
    }),
  ).rejects.toMatchObject({ code: 'stale_revision' });
  r = await read();
  await edit(source, hero.id, { title: 'Newer update' });
  await expect(
    command({ action: 'update', token: r.token, decisions: [], reviewedIds: [] }),
  ).rejects.toMatchObject({ code: 'stale_revision' });
  await decide('apply');
  expect(
    (await current()).blocks.find((b) => b.id === target.locale.rootBlockId)?.fields.title,
  ).toBe('Local metadata');
});
it('acknowledges local-only deletions and does not overwrite source or publish', async () => {
  await copy();
  const hero = roots()[0],
    r = await read(),
    id = r.mappings[hero.id]!;
  await pool.query('DELETE FROM block_drafts WHERE id=$1', [hero.id]);
  const review = await read();
  expect(review.changes[0]).toMatchObject({ kind: 'remove', safe: false });
  await decide('keep');
  expect((await read()).changes).toEqual([]);
  expect((await current()).blocks.some((b) => b.id === id)).toBe(true);
  expect(
    (
      await pool.query('SELECT count(*)::int AS n FROM publications WHERE locale_id=$1', [
        target.locale.id,
      ])
    ).rows[0].n,
  ).toBe(0);
});
it('adds a new source subtree once and scopes a child review to its linked subtree', async () => {
  await copy();
  const hero = roots()[0];
  await edit(source, hero.id, { title: 'Changed hero' });
  await edit(source, source.locale.rootBlockId, { title: 'Changed metadata' });
  const r = await read(),
    id = r.mappings[hero.id]!;
  const child = await store.reviewLocaleSource(actor, source.story.id, target.locale.id, id);
  expect(child.changes.map((c) => c.sourceId)).toEqual([hero.id]);
  await expect(
    command({
      action: 'update',
      blockId: id,
      token: child.token,
      decisions: [{ id: `content:${source.locale.rootBlockId}`, action: 'apply' }],
      reviewedIds: [],
    }),
  ).rejects.toMatchObject({ code: 'stale_revision' });
  await command({
    action: 'update',
    blockId: id,
    token: child.token,
    decisions: child.changes.map((c) => ({ id: c.id, action: 'apply' })),
    reviewedIds: [],
  });
  expect((await read()).changes.map((c) => c.sourceId)).toEqual([source.locale.rootBlockId]);
  const extra = randomUUID();
  await pool.query(
    'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,2,$6)',
    [
      extra,
      source.locale.id,
      hero.schemaVersionId,
      source.locale.rootBlockId,
      hero.parentField,
      JSON.stringify(hero.fields),
    ],
  );
  const addition = (await read()).changes.find((c) => c.kind === 'add')!;
  expect(addition.safe).toBe(true);
  await decide('apply', [addition.id]);
  expect((await read()).changes.some((c) => c.kind === 'add')).toBe(false);
  expect((await current()).blocks).toHaveLength(source.blocks.length + 1);
});
it('links an existing copy explicitly without changing its fields', async () => {
  const hero = roots()[0],
    root = target.blocks[0],
    lease = await store.acquireLease(actor, target.story.id, target.locale.id, root.id);
  await store.command(actor, target.story.id, target.locale.id, {
    type: 'importBlocks',
    mutationId: randomUUID(),
    expectedRevisions: { [root.id]: root.revision },
    leaseTokens: { [root.id]: lease.token! },
    payload: {
      sourceLocaleId: source.locale.id,
      blockIds: [hero.id],
      parentId: root.id,
      parentField: hero.parentField!,
    },
  });
  const imported = (await current()).blocks.find((b) => b.parentId === root.id)!;
  await edit(target, imported.id, { title: 'Traduit' });
  await command({
    action: 'link',
    token: (await read()).token,
    pairs: [{ sourceId: hero.id, targetId: imported.id }],
  });
  expect((await read()).changes).toEqual([]);
  expect((await current()).blocks.find((b) => b.id === imported.id)?.fields.title).toBe('Traduit');
  await edit(source, hero.id, { title: 'New source' });
  expect((await read()).changes[0].safe).toBe(false);
});
it('requires original source read access, current edit access and no competing leases', async () => {
  await copy();
  const hero = roots()[0],
    id = (await read()).mappings[hero.id]!;
  await pool.query(
    "INSERT INTO memberships(space_id,user_id,role) VALUES($1,'locale-other','editor')",
    [actor.spaceId],
  );
  const other = { ...actor, userId: 'locale-other', sessionId: 'other-session' };
  await store.acquireLease(other, target.story.id, target.locale.id, id);
  await edit(source, hero.id, { title: 'New source' });
  await expect(decide('apply')).rejects.toMatchObject({ code: 'locked' });
  const scopes = contentScopesSchema.parse({});
  scopes.read.definitionIds = [source.blocks[0].definitionId];
  await pool.query(
    "INSERT INTO space_roles(space_id,id,name,permissions,content_scopes) VALUES($1,'limited','Limited',ARRAY['content:read','content:edit'],$2)",
    [actor.spaceId, JSON.stringify(scopes)],
  );
  await pool.query(
    "UPDATE memberships SET role='limited' WHERE space_id=$1 AND user_id='locale-other'",
    [actor.spaceId],
  );
  await expect(
    store.reviewLocaleSource(other, source.story.id, target.locale.id),
  ).rejects.toMatchObject({ code: 'forbidden' });
  await expect(
    store.reviewLocaleSource(
      { ...actor, spaceId: randomUUID() },
      source.story.id,
      target.locale.id,
    ),
  ).rejects.toThrow();
});
it('explicitly reorders linked blocks, preserving local-only slots and acknowledging keep', async () => {
  await copy();
  const a = roots()[0],
    b = roots()[1];
  await pool.query(
    'UPDATE block_drafts SET position=CASE id WHEN $1 THEN 1 ELSE 0 END WHERE id=ANY($2::uuid[])',
    [a.id, [a.id, b.id]],
  );
  const r = await read();
  expect(r.changes).toHaveLength(1);
  expect(r.changes[0]).toMatchObject({ kind: 'order', safe: false });
  await decide('apply');
  const copied = (await current()).blocks
    .filter((b) => b.parentId === target.locale.rootBlockId)
    .sort((a, b) => a.position - b.position);
  expect(copied.map((b) => b.id)).toEqual([r.mappings[b.id], r.mappings[a.id]]);
  expect((await read()).changes).toEqual([]);
});
it('retains translated grandchildren when moving a surviving branch out of a removed parent', async () => {
  const hero = roots()[0];
  // Build a valid nested definition via the usual schema service.
  const def = await store.createDefinition(actor, {
    name: 'section',
    displayName: 'Section',
    kind: 'nestable',
    fields: [{ id: randomUUID(), name: 'items', label: 'Items', type: 'blocks' }],
  });
  const parent = randomUUID();
  await pool.query(
    'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,0,$6)',
    [parent, source.locale.id, def.versionId, source.locale.rootBlockId, 'body', '{}'],
  );
  await pool.query("UPDATE block_drafts SET parent_id=$2,parent_field='items' WHERE id=$1", [
    hero.id,
    parent,
  ]);
  source = await store.getSnapshot(actor, source.story.id, source.locale.id);
  await copy();
  const mapped = (await read()).mappings;
  await edit(target, mapped[hero.id]!, { title: 'Texte conservé' });
  await pool.query("UPDATE block_drafts SET parent_id=$2,parent_field='body' WHERE id=$1", [
    hero.id,
    source.locale.rootBlockId,
  ]);
  await pool.query('DELETE FROM block_drafts WHERE id=$1', [parent]);
  const r = await read();
  expect(r.changes.some((c) => c.kind === 'move')).toBe(true);
  expect(r.changes.some((c) => c.kind === 'remove')).toBe(true);
  await decide('apply');
  const result = await current();
  expect(result.blocks.find((b) => b.id === mapped[hero.id])?.fields.title).toBe('Texte conservé');
  expect(result.blocks.some((b) => b.id === mapped[parent])).toBe(false);
});
it('records review acknowledgements idempotently, without exposing source leases', async () => {
  await copy();
  const r = await read(),
    b = (await current()).blocks.find((b) => b.id === target.locale.rootBlockId)!,
    lease = await store.acquireLease(actor, target.story.id, target.locale.id, b.id);
  expect(r.source.leases).toEqual([]);
  const cmd = {
    type: 'updateLocaleSource',
    payload: { action: 'update', token: r.token, decisions: [], reviewedIds: [b.id] },
    mutationId: randomUUID(),
    expectedRevisions: { [b.id]: b.revision },
    leaseTokens: { [b.id]: lease.token! },
  };
  const first = await store.command(actor, target.story.id, target.locale.id, cmd),
    retry = await store.command(actor, target.story.id, target.locale.id, cmd);
  expect(retry.checkpointId).toBe(first.checkpointId);
  expect((await read()).needsTranslation.some((item) => item.id === b.id)).toBe(false);
});
it('keeps unselected local layout and omitted source additions quiet after acknowledgement', async () => {
  await copy();
  const hero = roots()[0],
    mapped = (await read()).mappings;
  await pool.query('UPDATE block_drafts SET position=9 WHERE id=$1', [mapped[hero.id]]);
  await edit(source, source.locale.rootBlockId, { title: 'New metadata' });
  await decide('keep');
  expect((await current()).blocks.find((b) => b.id === mapped[hero.id])?.position).toBe(9);
  const extra = randomUUID();
  await pool.query('UPDATE block_drafts SET position=position+1 WHERE parent_id=$1', [
    source.locale.rootBlockId,
  ]);
  await pool.query(
    'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,0,$6)',
    [
      extra,
      source.locale.id,
      hero.schemaVersionId,
      source.locale.rootBlockId,
      hero.parentField,
      JSON.stringify(hero.fields),
    ],
  );
  await decide('keep');
  expect((await read()).changes).toEqual([]);
});
it('detects a source block restored after its removal was acknowledged', async () => {
  await copy();
  const hero = roots()[0],
    mapped = (await read()).mappings;
  await pool.query('DELETE FROM block_drafts WHERE id=$1', [hero.id]);
  await decide('keep');
  await pool.query(
    'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      hero.id,
      source.locale.id,
      hero.schemaVersionId,
      hero.parentId,
      hero.parentField,
      hero.position,
      JSON.stringify({ ...hero.fields, title: 'Restored source' }),
    ],
  );
  const r = await read();
  expect(r.changes.some((c) => c.sourceId === hero.id && c.kind === 'content')).toBe(true);
  await decide('keep');
  expect((await read()).changes).toEqual([]);
  expect((await current()).blocks.some((b) => b.id === mapped[hero.id])).toBe(true);
});
it('adding a new parent does not acknowledge an unselected move of an existing translated block', async () => {
  await copy();
  const hero = roots()[0],
    mapped = (await read()).mappings;
  await edit(target, mapped[hero.id]!, { title: 'Texte conservé' });
  const def = await store.createDefinition(actor, {
    name: 'section',
    displayName: 'Section',
    kind: 'nestable',
    fields: [{ id: randomUUID(), name: 'items', label: 'Items', type: 'blocks' }],
  });
  const parent = randomUUID();
  await pool.query(
    'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,2,$6)',
    [parent, source.locale.id, def.versionId, source.locale.rootBlockId, 'body', '{}'],
  );
  await pool.query(
    "UPDATE block_drafts SET parent_id=$2,parent_field='items',position=0 WHERE id=$1",
    [hero.id, parent],
  );
  const addition = (await read()).changes.find((c) => c.kind === 'add')!;
  await decide('apply', [addition.id]);
  expect((await read()).changes.some((c) => c.kind === 'move' && c.sourceId === hero.id)).toBe(
    true,
  );
  expect((await current()).blocks.find((b) => b.id === mapped[hero.id])?.parentId).toBe(
    target.locale.rootBlockId,
  );
  await decide('apply');
  const result = await current();
  expect(result.blocks.find((b) => b.id === mapped[hero.id])?.fields.title).toBe('Texte conservé');
  expect((await read()).changes).toEqual([]);
});
