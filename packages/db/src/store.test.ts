import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StorypaneStore } from './store.js';
import { migrate } from './migrate.js';
import { acceptVerifiedEmailInvitations } from './invitations.js';
import { createBlockClipboard, contentScopesSchema, definitionInput } from '@storypane/core';
import type { Actor, BlockDraft, Command, Lease, LocaleSnapshot } from '@storypane/core';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
) {
  throw new Error('Integration tests require the disposable local test database');
}
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
const legacyLocaleId = randomUUID(),
  legacyRootId = randomUUID();
let legacySpaceId: string, legacyStoryId: string;
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

async function deployActive() {
  const migration = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
  const review = await store.reviewMigration(alice, migration.id);
  expect(review.blockers).toEqual([]);
  const result = await store.deployMigration(alice, migration.id, review.token, {
    confirmation: review.confirmation ?? undefined,
  });
  snapshot = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
  return result;
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
  await pool.query(
    await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'),
  );
  const legacySpace = await pool.query(
    "INSERT INTO spaces(name) VALUES('Before upgrade') RETURNING id",
  );
  const legacyStory = await pool.query(
    "INSERT INTO stories(space_id,name,slug) VALUES($1,'Legacy','legacy') RETURNING id",
    [legacySpace.rows[0].id],
  );
  legacySpaceId = legacySpace.rows[0].id;
  legacyStoryId = legacyStory.rows[0].id;
  await pool.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,'alice','admin')", [
    legacySpaceId,
  ]);
  await pool.query(
    "INSERT INTO story_locales(id,story_id,slug,name,url_slug,root_block_id) VALUES($1,$2,'fr','French','bonjour',$3)",
    [legacyLocaleId, legacyStory.rows[0].id, legacyRootId],
  );
  const legacyDefinition = (
    await pool.query(
      "INSERT INTO definitions(space_id,name,current_version) VALUES($1,'legacy_page',2) RETURNING id",
      [legacySpaceId],
    )
  ).rows[0].id;
  const oldSchema = {
    name: 'legacy_page',
    displayName: 'Legacy page',
    kind: 'content-type',
    fields: [
      { name: 'title', label: 'Title', type: 'text', format: 'singleline' },
      { name: 'retired', label: 'Retired', type: 'number' },
    ],
  };
  const oldVersion = (
    await pool.query(
      'INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,1,$2) RETURNING id',
      [legacyDefinition, JSON.stringify(oldSchema)],
    )
  ).rows[0].id;
  await pool.query(
    'INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,2,$2)',
    [legacyDefinition, JSON.stringify({ ...oldSchema, fields: oldSchema.fields.slice(0, 1) })],
  );
  await pool.query(
    'INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)',
    [
      legacyRootId,
      legacyLocaleId,
      oldVersion,
      JSON.stringify({ title: 'Legacy value', retired: 42 }),
    ],
  );
  await pool.query(
    await readFile(new URL('../migrations/003_delivery_preview.sql', import.meta.url), 'utf8'),
  );
  await pool.query("UPDATE spaces SET preview_url='http://localhost:3132/{slug}' WHERE id=$1", [
    legacySpace.rows[0].id,
  ]);
  await pool.query(
    'CREATE TABLE blok_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  await pool.query("INSERT INTO blok_migrations(name) VALUES('003_delivery_preview')");
  const customPreviewSpace = (
    await pool.query(
      "INSERT INTO spaces(name,preview_parameter) VALUES('Custom preview','review') RETURNING id",
    )
  ).rows[0].id;
  await migrate(pool);
  await migrate(pool);
  expect(
    (await pool.query('SELECT preview_parameter FROM spaces WHERE id=$1', [legacySpaceId])).rows[0]
      .preview_parameter,
  ).toBe('storypane_preview');
  expect(
    (await pool.query('SELECT preview_parameter FROM spaces WHERE id=$1', [customPreviewSpace]))
      .rows[0].preview_parameter,
  ).toBe('review');
  expect(
    (await pool.query("SELECT name FROM storypane_migrations WHERE name='003_delivery_preview'"))
      .rowCount,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM pg_tables WHERE schemaname=current_schema() AND tablename='blok_migrations'",
      )
    ).rowCount,
  ).toBe(0);
  await pool.query(
    `INSERT INTO cms_sessions VALUES('alice-session','alice',now()+interval '1 hour'),('bob-session','bob',now()+interval '1 hour')`,
  );
});
beforeEach(async () => {
  const spaceId = randomUUID();
  alice = { userId: 'alice', sessionId: 'alice-session', spaceId, role: 'admin' };
  bob = { userId: 'bob', sessionId: 'bob-session', spaceId, role: 'editor' };
  await store.seed(alice);
  await pool.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,'bob','editor')", [
    spaceId,
  ]);
  const story = (await store.listStories(alice))[0];
  const locale = (await store.listLocales(alice, story.id))[0];
  snapshot = await store.getSnapshot(alice, story.id, locale.id);
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
  await admin.end();
});

describe('Postgres collaboration and immutable history', () => {
  it('keeps public media disabled on upgrade and requires an administrator to enable it', async () => {
    expect(
      (await pool.query('SELECT public_media FROM spaces WHERE id=$1', [legacySpaceId])).rows[0]
        .public_media,
    ).toBe(false);
    expect(await store.getPublicMediaSettings(alice)).toEqual({ enabled: false });
    await expect(store.updatePublicMediaSettings(bob, { enabled: true })).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await store.updatePublicMediaSettings(alice, { enabled: true })).toEqual({
      enabled: true,
    });
    expect(await store.getPublicMediaSettings(bob)).toEqual({ enabled: true });
    expect(await store.updatePublicMediaSettings(alice, { enabled: false })).toEqual({
      enabled: false,
    });
  });
  it('lists typed draft and current publication asset usage with stable IDs and bounded pagination', async () => {
    const assetId = randomUUID();
    await pool.query(
      "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title) VALUES($1::uuid,$2,$1::text,'image.png','image/png',10,'Image')",
      [assetId, alice.spaceId],
    );
    const footer = blockNamed(snapshot, 'footer');
    const saved = await save(alice, snapshot, footer, {
      ...footer.fields,
      link: { type: 'asset', assetId },
    });
    const draft = await store.listAssetUsage(alice, assetId);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      storyId: snapshot.story.id,
      localeId: snapshot.locale.id,
      blockId: footer.id,
      definitionId: footer.definitionId,
      fieldName: 'link',
      state: 'draft',
    });
    expect(draft.items[0].fieldId).toBeTruthy();
    expect(draft.nextCursor).toBeNull();
    const published = await run(alice, saved.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: saved.checkpointId },
    });
    expect((await store.listAssetUsage(alice, assetId)).items.map((item) => item.state)).toEqual([
      'draft',
      'published',
    ]);
    const edited = await save(alice, published.snapshot, blockNamed(published.snapshot, 'footer'), {
      ...footer.fields,
      link: { type: 'external', url: 'https://example.com' },
    });
    expect((await store.listAssetUsage(alice, assetId)).items.map((item) => item.state)).toEqual([
      'published',
    ]);
    await run(alice, edited.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: edited.checkpointId },
    });
    expect((await store.listAssetUsage(alice, assetId)).items).toEqual([]);
    // A lookalike value in a text field does not count as an asset reference.
    await pool.query('UPDATE block_drafts SET fields=fields || $2 WHERE id=$1', [
      footer.id,
      JSON.stringify({ text: { assetId } }),
    ]);
    expect((await store.listAssetUsage(alice, assetId)).items).toEqual([]);
    const definition = (
      await pool.query('SELECT schema_version_id FROM block_drafts WHERE id=$1', [footer.id])
    ).rows[0].schema_version_id;
    for (let index = 0; index < 42; index++) {
      const story = await pool.query(
        'INSERT INTO stories(space_id,name,slug) VALUES($1,$2,$2) RETURNING id',
        [alice.spaceId, `usage-${index}`],
      );
      const rootId = randomUUID();
      const locale = await pool.query(
        'INSERT INTO story_locales(story_id,slug,name,url_slug,root_block_id,space_locale_id) VALUES($1::uuid,$4,$5,$1::text,$2,$3) RETURNING id',
        [
          story.rows[0].id,
          rootId,
          snapshot.locale.spaceLocaleId,
          snapshot.locale.slug,
          snapshot.locale.name,
        ],
      );
      await pool.query(
        'INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)',
        [
          rootId,
          locale.rows[0].id,
          definition,
          JSON.stringify({ link: { type: 'asset', assetId } }),
        ],
      );
    }
    const first = await store.listAssetUsage(alice, assetId);
    expect(first.items).toHaveLength(40);
    expect(first.nextCursor).toBe('40');
    const second = await store.listAssetUsage(alice, assetId, { cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.storyId)).size).toBe(42);
    await pool.query('UPDATE stories SET deleted_at=now() WHERE id=$1', [second.items[0].storyId]);
    expect((await store.listAssetUsage(alice, assetId, { cursor: '40' })).items).toHaveLength(1);
    await pool.query('UPDATE assets SET archived_at=now() WHERE id=$1', [assetId]);
    expect((await store.listAssetUsage(alice, assetId)).items).toHaveLength(40);
    await expect(store.listAssetUsage(alice, assetId, { cursor: '-1' })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      store.listAssetUsage({ ...alice, spaceId: legacySpaceId }, assetId),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('limits asset delivery to current publications in the token’s space', async () => {
    const key = await store.createDeliveryToken(alice, { name: 'Website', scope: 'published' }),
      assetId = randomUUID(),
      draftAssetId = randomUUID();
    for (const id of [assetId, draftAssetId])
      await pool.query(
        "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title) VALUES($1::uuid,$2,$1::text,'image.png','image/png',10,'Image')",
        [id, alice.spaceId],
      );
    const footer = blockNamed(snapshot, 'footer');
    const saved = await save(alice, snapshot, footer, {
      ...footer.fields,
      link: { type: 'asset', assetId },
    });
    await expect(
      store.authorizePublishedAsset(key.token, alice.spaceId, assetId),
    ).rejects.toMatchObject({ code: 'not_found' });
    const published = await run(alice, saved.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: saved.checkpointId },
    });
    await expect(
      store.authorizePublishedAsset(key.token, alice.spaceId, assetId),
    ).resolves.toBeUndefined();
    const edited = await save(alice, published.snapshot, blockNamed(published.snapshot, 'footer'), {
      ...footer.fields,
      link: { type: 'asset', assetId: draftAssetId },
    });
    await expect(
      store.authorizePublishedAsset(key.token, alice.spaceId, draftAssetId),
    ).rejects.toMatchObject({ code: 'not_found' });
    const other = await store.createSpace(alice, { name: 'Private assets' }),
      otherKey = await store.createDeliveryToken(
        { ...alice, spaceId: other.id },
        { name: 'Other site', scope: 'published' },
      );
    await expect(
      store.authorizePublishedAsset(otherKey.token, other.id, assetId),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.authorizePublishedAsset(key.token, other.id, assetId)).rejects.toMatchObject(
      { code: 'unauthenticated' },
    );
    await expect(store.authorizePublishedAsset('', alice.spaceId, assetId)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      store.authorizePublishedAsset(key.token, alice.spaceId, 'invalid'),
    ).rejects.toMatchObject({ code: 'invalid' });
    await run(alice, edited.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: edited.checkpointId },
    });
    await expect(
      store.authorizePublishedAsset(key.token, alice.spaceId, assetId),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.authorizePublishedAsset(key.token, alice.spaceId, draftAssetId),
    ).resolves.toBeUndefined();
    await store.revokeDeliveryToken(alice, key.id);
    await expect(
      store.authorizePublishedAsset(key.token, alice.spaceId, draftAssetId),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('creates nested folders, translated paths, type restrictions, and form-only pages', async () => {
    const type = blockNamed(snapshot, 'page').definitionId;
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const courses = await store.saveFolder(alice, {
      name: 'Courses',
      slug: 'courses',
      localeSlugs: { [french.id]: 'cours' },
    });
    const child = await store.saveFolder(alice, {
      name: 'Training',
      slug: 'training',
      parentId: courses.id,
      localeSlugs: { [french.id]: 'formation' },
      allowedDefinitionIds: [type],
      defaultDefinitionId: type,
      formOnly: true,
    });
    const page = await store.createStory(alice, {
      name: 'Introduction',
      slug: 'introduction',
      definitionId: type,
      folderId: child.id,
    });
    expect(page.story).toMatchObject({
      folderId: child.id,
      slug: 'courses/training/introduction',
      slugSegment: 'introduction',
      formOnly: true,
    });
    const translated = await store.createLocale(alice, page.story.id, {
      spaceLocaleId: french.id,
      urlSlug: 'présentation',
    });
    expect(translated.locale).toMatchObject({
      urlSlug: 'cours/formation/présentation',
      slugSegment: 'présentation',
    });
    const sibling = await store.createStory(alice, {
      name: 'Root introduction',
      slug: 'introduction',
      definitionId: type,
    });
    expect(sibling.story.slug).toBe('introduction');
    expect(await store.listFolders(bob)).toHaveLength(2);
    await expect(store.deleteFolder(alice, courses.id)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.deleteFolder(alice, child.id)).rejects.toMatchObject({ code: 'invalid' });
    const alternate = await store.createDefinition(alice, {
      name: 'article',
      displayName: 'Article',
      kind: 'content-type',
      fields: [],
    });
    await expect(
      store.createStory(alice, {
        name: 'Not allowed',
        slug: 'article',
        definitionId: alternate.id,
        folderId: child.id,
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const { id: childId, ...childSettings } = child;
    await expect(
      store.saveFolder(
        alice,
        { ...childSettings, allowedDefinitionIds: [alternate.id], defaultDefinitionId: null },
        childId,
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
    await store.updateSpaceLocale(alice, french.id, { name: 'French Canada', slug: 'fr-CA' });
    expect(
      (await store.listFolders(alice)).find((item) => item.id === courses.id)?.localeSlugs[
        french.id
      ],
    ).toBe('cours');
  });
  it('keeps published folder URLs fixed until each affected page locale is republished', async () => {
    const type = blockNamed(snapshot, 'page').definitionId;
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const folder = await store.saveFolder(alice, {
      name: 'Courses',
      slug: 'courses',
      localeSlugs: { [french.id]: 'cours' },
    });
    const child = await store.saveFolder(alice, {
      name: 'Intro',
      slug: 'intro',
      parentId: folder.id,
    });
    const page = await store.createStory(alice, {
      name: 'Details',
      slug: 'details',
      definitionId: type,
      folderId: child.id,
    });
    let translated = await store.createLocale(alice, page.story.id, {
      spaceLocaleId: french.id,
      urlSlug: 'détails',
    });
    translated = (
      await save(alice, translated, blockNamed(translated, 'page'), { title: 'Détails' })
    ).snapshot;
    const publish = (state: LocaleSnapshot) =>
      run(alice, state, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: state.checkpointId! },
      });
    await publish(page);
    await publish(translated);
    const key = await store.createDeliveryToken(alice, { name: 'Website', scope: 'preview' });
    const own = await lease(bob, page, blockNamed(page, 'page'));
    const { id, ...settings } = folder;
    await store.saveFolder(
      alice,
      { ...settings, slug: 'learn', localeSlugs: { [french.id]: 'apprendre' } },
      id,
    );
    const draft = await store.getSnapshot(alice, page.story.id, page.locale.id);
    const frenchDraft = await store.getSnapshot(alice, page.story.id, translated.locale.id);
    expect(draft).toMatchObject({
      publicationStatus: 'changed',
      locale: { urlSlug: 'learn/intro/details' },
    });
    expect(frenchDraft.locale.urlSlug).toBe('apprendre/intro/détails');
    expect(draft.blocks).toEqual(page.blocks);
    expect(
      (await store.listStories(alice)).find((item) => item.id === page.story.id),
    ).toMatchObject({ publicationStatus: 'changed', pendingLocaleCount: 2 });
    expect(
      (await store.publishedStories(key.token, alice.spaceId, { slug: 'courses/intro/details' }))
        .stories,
    ).toHaveLength(1);
    expect(
      (await store.publishedStories(key.token, alice.spaceId, { slug: 'learn/intro/details' }))
        .stories,
    ).toHaveLength(0);
    expect(
      (
        await store.publishedStories(key.token, alice.spaceId, {
          locale: 'fr',
          slug: 'cours/intro/détails',
        })
      ).stories,
    ).toHaveLength(1);
    const previewId = randomUUID();
    await store.updateDeliverySettings(alice, {
      previewUrls: [
        { id: previewId, name: 'Local', url: 'http://localhost:3132/preview?slug={slug}' },
      ],
      defaultPreviewId: previewId,
    });
    expect(
      (await store.createTokenPreview(key.token, alice.spaceId, { slug: 'learn/intro/details' }))
        .slug,
    ).toBe('learn/intro/details');
    await publish(draft);
    expect(
      (await store.publishedStories(key.token, alice.spaceId, { slug: 'courses/intro/details' }))
        .stories,
    ).toHaveLength(0);
    expect(
      (await store.publishedStories(key.token, alice.spaceId, { slug: 'learn/intro/details' }))
        .stories,
    ).toHaveLength(1);
    expect(
      (
        await store.publishedStories(key.token, alice.spaceId, {
          locale: 'fr',
          slug: 'cours/intro/détails',
        })
      ).stories,
    ).toHaveLength(1);
    await publish(frenchDraft);
    expect(
      (
        await store.publishedStories(key.token, alice.spaceId, {
          locale: 'fr',
          slug: 'apprendre/intro/détails',
        })
      ).stories,
    ).toHaveLength(1);
    const edited = await run(bob, draft, {
      ...commandBase({ block: blockNamed(draft, 'page'), lease: own }),
      type: 'saveBlock',
      payload: { blockId: draft.locale.rootBlockId, fields: { title: 'Still editing' } },
    });
    expect(edited.snapshot.locale.urlSlug).toBe('learn/intro/details');
  });
  it('moves pages, validates translated collisions, and protects occupied published URLs', async () => {
    const type = blockNamed(snapshot, 'page').definitionId;
    const folder = await store.saveFolder(alice, { name: 'Blog', slug: 'blog' });
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: folder.id,
      slug: 'home',
    });
    const draft = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    await run(alice, draft, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: draft.checkpointId! },
    });
    const { id, ...settings } = folder;
    await store.saveFolder(alice, { ...settings, slug: 'articles' }, id);
    const nextFolder = await store.saveFolder(alice, { name: 'New blog', slug: 'blog' });
    const other = await store.createStory(alice, {
      name: 'Another home',
      slug: 'home',
      definitionId: type,
      folderId: nextFolder.id,
    });
    await expect(
      store.updateStoryLocation(alice, other.story.id, { folderId: folder.id, slug: 'home' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect((await store.getStory(alice, other.story.id)).slug).toBe('blog/home');
    await expect(
      run(alice, other, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: other.checkpointId! },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const latest = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    await run(alice, latest, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: latest.checkpointId! },
    });
    await run(alice, other, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: other.checkpointId! },
    });
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    await store.createLocale(alice, other.story.id, {
      spaceLocaleId: french.id,
      urlSlug: 'accueil',
    });
    await store.updateStoryLocation(alice, other.story.id, {
      folderId: null,
      slug: 'new-home',
      localeSlugs: { [french.id]: 'nouvel-accueil' },
    });
    expect(
      (await store.listLocales(alice, other.story.id)).map((locale) => locale.urlSlug),
    ).toEqual(['new-home', 'nouvel-accueil']);
    await store.deleteFolder(alice, nextFolder.id);
  });
  it('rejects cyclic folders, translated sibling collisions, and cross-space or read-only writes', async () => {
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const folder = await store.saveFolder(alice, {
      name: 'One',
      slug: 'one',
      localeSlugs: { [french.id]: 'un' },
    });
    const child = await store.saveFolder(alice, {
      name: 'Child',
      slug: 'child',
      parentId: folder.id,
    });
    const { id, ...settings } = folder;
    await expect(
      store.saveFolder(alice, { ...settings, parentId: child.id }, id),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      store.saveFolder(alice, { name: 'Two', slug: 'two', localeSlugs: { [french.id]: 'un' } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const other = await store.createSpace(alice, { name: 'Separate' });
    await expect(
      store.saveFolder(
        { ...alice, spaceId: other.id },
        { name: 'Foreign parent', slug: 'child', parentId: id },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.updateStoryLocation({ ...alice, spaceId: other.id }, snapshot.story.id, {
        folderId: null,
        slug: 'stolen',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await store.updateSpaceMember(alice, 'bob', { role: 'viewer' });
    await expect(store.saveFolder(bob, { name: 'Denied', slug: 'denied' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(store.deleteFolder(bob, child.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.updateStoryLocation(bob, snapshot.story.id, { folderId: id, slug: 'home' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await store.deleteSpaceLocale(alice, french.id);
    expect((await store.listFolders(alice)).find((item) => item.id === id)?.localeSlugs).toEqual(
      {},
    );
    await store.deleteFolder(alice, child.id);
    await store.deleteFolder(alice, id);
  });
  it("persists personal pins without changing anyone else's list or the page content", async () => {
    const id = snapshot.story.id;
    const newer = await store.createStory(alice, {
      name: 'Newer page',
      slug: 'newer-page',
      definitionId: blockNamed(snapshot, 'page').definitionId,
    });
    expect((await store.listStories(alice)).map((story) => story.id)).toEqual([newer.story.id, id]);
    await store.setStoryPinned(alice, id, true);
    await store.setStoryPinned(alice, id, true);
    expect(
      (await new StorypaneStore(pool).listStories(alice)).map((story) => ({
        id: story.id,
        pinned: story.pinned,
      })),
    ).toEqual([
      { id, pinned: true },
      { id: newer.story.id, pinned: false },
    ]);
    expect(
      (await store.listStories(bob)).map((story) => ({ id: story.id, pinned: story.pinned })),
    ).toEqual([
      { id: newer.story.id, pinned: false },
      { id, pinned: false },
    ]);
    expect(await store.getSnapshot(alice, id, snapshot.locale.id)).toEqual(snapshot);
    expect(await store.listCheckpoints(alice, id, snapshot.locale.id)).toHaveLength(1);
    await store.setStoryPinned(bob, id, true);
    await store.setStoryPinned(alice, id, false);
    await store.setStoryPinned(alice, id, false);
    expect((await store.listStories(alice)).map((story) => story.id)).toEqual([newer.story.id, id]);
    expect((await store.listStories(bob))[0]).toMatchObject({ id, pinned: true });
    await pool.query('DELETE FROM stories WHERE id=$1', [id]);
    expect((await pool.query('SELECT * FROM story_pins WHERE story_id=$1', [id])).rows).toEqual([]);
  });
  it('allows viewers to pin their own pages while enforcing session and space access', async () => {
    const id = snapshot.story.id;
    await store.updateSpaceMember(alice, 'bob', { role: 'viewer' });
    await store.setStoryPinned(bob, id, true);
    expect((await store.listStories(bob))[0].pinned).toBe(true);
    expect((await store.listStories(alice))[0].pinned).toBe(false);
    const other = await store.createSpace(alice, { name: 'Other space' });
    await expect(
      store.setStoryPinned({ ...alice, spaceId: other.id }, id, true),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.setStoryPinned({ ...alice, spaceId: other.id }, id, false),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.setStoryPinned({ ...alice, userId: 'bob' }, id, true)).rejects.toMatchObject(
      { code: 'unauthenticated' },
    );
    await expect(store.setStoryPinned(alice, 'invalid', true)).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(store.setStoryPinned(alice, randomUUID(), true)).rejects.toMatchObject({
      code: 'not_found',
    });
    await store.removeSpaceMember(alice, 'bob');
    await expect(store.setStoryPinned(bob, id, false)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(store.listStories(bob)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('lists the content type and the actual last modifier, including edits in another locale', async () => {
    const root = blockNamed(snapshot, 'page');
    expect((await store.listStories(alice))[0]).toMatchObject({
      contentType: { id: root.definitionId, name: 'Page' },
      modifiedBy: { id: 'alice', name: 'Alice' },
    });
    await lease(bob, snapshot, blockNamed(snapshot, 'footer'));
    expect((await store.listStories(alice))[0].modifiedBy?.id).toBe('alice');
    const saved = await save(bob, snapshot, blockNamed(snapshot, 'footer'), {
      text: 'Updated footer',
    });
    expect((await store.listStories(alice))[0]).toMatchObject({
      updatedAt: saved.snapshot.story.updatedAt,
      modifiedBy: { id: 'bob', name: 'Bob' },
    });
    const configured = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const french = await store.createLocale(alice, snapshot.story.id, {
      spaceLocaleId: configured.id,
    });
    const translated = await save(bob, french, blockNamed(french, 'page'), { title: 'Bonjour' });
    expect((await store.listStories(alice))[0]).toMatchObject({
      localeCount: 2,
      contentType: { id: root.definitionId, name: 'Page' },
      updatedAt: translated.snapshot.story.updatedAt,
      modifiedBy: { id: 'bob', name: 'Bob' },
    });
    await pool.query('UPDATE stories SET updated_by=NULL WHERE id=$1', [snapshot.story.id]);
    await pool.query(
      await readFile(new URL('../migrations/010_story_modified_by.sql', import.meta.url), 'utf8'),
    );
    expect((await store.listStories(alice))[0]).toMatchObject({
      updatedAt: translated.snapshot.story.updatedAt,
      modifiedBy: { id: 'bob', name: 'Bob' },
    });
  });
  it('reads a story by ID only within the authorized space', async () => {
    expect(await store.getStory(alice, snapshot.story.id)).toEqual(snapshot.story);
    await expect(store.getStory(alice, 'not-an-id')).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.getStory(alice, randomUUID())).rejects.toMatchObject({ code: 'not_found' });
    const other = await store.createSpace(alice, { name: 'Different workspace' });
    await expect(
      store.getStory({ ...alice, spaceId: other.id }, snapshot.story.id),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('backfills existing story locales without changing their IDs or page slugs', async () => {
    const { rows } = await pool.query(
      'SELECT l.id,l.slug,l.url_slug,c.name,c.slug AS configured_slug FROM story_locales l JOIN space_locales c ON c.id=l.space_locale_id WHERE l.id=$1',
      [legacyLocaleId],
    );
    expect(rows).toEqual([
      {
        id: legacyLocaleId,
        slug: 'fr',
        url_slug: 'bonjour',
        name: 'French',
        configured_slug: 'fr',
      },
    ]);
    expect(
      (await store.listSpaceLocales(alice)).map((item) => ({ name: item.name, slug: item.slug })),
    ).toEqual([{ name: 'Default', slug: '' }]);
  });
  it('manages locale configuration centrally while preserving content, history, and publication on rename', async () => {
    const configured = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    await expect(
      store.createSpaceLocale(bob, { name: 'German', slug: 'de' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.updateSpaceLocale(bob, configured.id, { name: 'French', slug: 'fr-CA' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(store.deleteSpaceLocale(bob, configured.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      store.createSpaceLocale(alice, { name: 'Duplicate', slug: 'fr' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      store.createLocale(alice, snapshot.story.id, { name: 'Unconfigured', slug: 'de' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const other = await store.createSpace(alice, { name: 'Other space' });
    const foreign = await store.createSpaceLocale(
      { ...alice, spaceId: other.id },
      { name: 'Spanish', slug: 'es' },
    );
    await expect(
      store.createLocale(alice, snapshot.story.id, { spaceLocaleId: foreign.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.updateSpaceLocale(alice, foreign.id, { name: 'Stolen', slug: 'es-MX' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [french, retry] = await Promise.all([
      store.createLocale(alice, snapshot.story.id, { spaceLocaleId: configured.id }),
      store.createLocale(bob, snapshot.story.id, { spaceLocaleId: configured.id }),
    ]);
    expect(retry.locale.id).toBe(french.locale.id);
    expect(french.blocks).toHaveLength(1);
    expect(await store.listCheckpoints(alice, snapshot.story.id, french.locale.id)).toHaveLength(1);
    await run(alice, french, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: french.checkpointId! },
    });
    const before = await store.getSnapshot(alice, snapshot.story.id, french.locale.id);
    const renamed = await store.updateSpaceLocale(alice, configured.id, {
      name: 'French (Canada)',
      slug: 'fr-CA',
    });
    expect(renamed).toMatchObject({ id: configured.id, storyCount: 1 });
    const after = await store.getSnapshot(alice, snapshot.story.id, french.locale.id);
    expect(after.blocks).toEqual(before.blocks);
    expect(after.locale).toEqual({ ...before.locale, name: 'French (Canada)', slug: 'fr-CA' });
    expect(
      (await store.getCheckpoint(alice, snapshot.story.id, french.locale.id, french.checkpointId!))
        .snapshot.locale.slug,
    ).toBe('fr');
    const token = await store.createDeliveryToken(alice, { name: 'Site', scope: 'published' });
    expect(
      (await store.deliveryLocales(token.token, alice.spaceId)).map((locale) => locale.slug),
    ).toEqual(['', 'fr-CA']);
    expect(
      (await store.publishedStories(token.token, alice.spaceId, { locale: 'fr' })).stories,
    ).toEqual([]);
    expect(
      (await store.publishedStories(token.token, alice.spaceId, { locale: 'fr-CA' })).stories,
    ).toHaveLength(1);
    const defaultLocale = (await store.listSpaceLocales(alice)).find(
      (locale) => locale.slug === '',
    )!;
    await expect(
      store.updateSpaceLocale(alice, defaultLocale.id, { name: 'English', slug: 'en' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.deleteSpaceLocale(alice, defaultLocale.id)).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(store.deleteSpaceLocale(alice, configured.id)).rejects.toMatchObject({
      code: 'invalid',
    });
    const unused = await store.createSpaceLocale(alice, { name: 'German', slug: 'de' });
    await store.deleteSpaceLocale(alice, unused.id);
    expect((await store.listSpaceLocales(alice)).map((locale) => locale.id)).not.toContain(
      unused.id,
    );
  });
  it('exports only current schema metadata through a scoped preview key', async () => {
    const published = await store.createDeliveryToken(alice, {
      name: 'Website',
      scope: 'published',
    });
    const preview = await store.createDeliveryToken(alice, { name: 'Tooling', scope: 'preview' });
    await expect(store.deliverySchema(published.token, alice.spaceId)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(store.deliverySchema(preview.token, randomUUID())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const before = await store.deliverySchema(preview.token, alice.spaceId);
    expect(before.components.map((item) => item.name)).toEqual(['footer', 'hero', 'page']);
    expect(JSON.stringify(before)).not.toContain('defaultValue');
    expect(JSON.stringify(before)).not.toContain('Build something worth sharing.');
    const hero = (await store.listDefinitions(alice)).find((item) => item.name === 'hero')!;
    await store.updateDefinition(alice, hero.id, {
      name: hero.name,
      displayName: hero.displayName,
      kind: hero.kind,
      fields: [
        ...hero.fields,
        {
          name: 'style',
          label: 'Style',
          type: 'option',
          source: { type: 'inline', items: [{ value: 'dark', label: 'Dark' }] },
        },
      ],
    });
    expect(await store.deliverySchema(preview.token, alice.spaceId)).toEqual(before);
    await deployActive();
    const after = await store.deliverySchema(preview.token, alice.spaceId);
    expect(after.components.find((item) => item.name === 'hero')).toMatchObject({
      version: 2,
      fields: expect.arrayContaining([
        { name: 'style', type: 'option', required: false, options: ['dark'] },
      ]),
    });
    await store.revokeDeliveryToken(alice, preview.id);
    await expect(store.deliverySchema(preview.token, alice.spaceId)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it('delivers only publication snapshots, scoped by space and locale, and honors token revocation', async () => {
    const key = await store.createDeliveryToken(alice, { name: 'Website', scope: 'published' });
    expect((await store.publishedStories(key.token, alice.spaceId, {})).stories).toEqual([]);
    const checkpoint = snapshot.checkpointId!;
    const changed = await save(alice, snapshot, blockNamed(snapshot, 'hero'), {
      title: 'Draft only',
    });
    await run(alice, changed.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: checkpoint },
    });
    const { stories } = await store.publishedStories(key.token, alice.spaceId, { slug: 'home' });
    expect(JSON.stringify(stories)).toContain('Build something worth sharing.');
    expect(JSON.stringify(stories)).not.toContain('Draft only');
    expect(
      (await store.publishedStories(key.token, alice.spaceId, { locale: 'fr' })).stories,
    ).toEqual([]);
    expect(JSON.stringify(await store.listDeliveryTokens(alice))).not.toContain(key.token);
    await expect(store.publishedStories(key.token, randomUUID(), {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      store.createTokenPreview(key.token, alice.spaceId, { slug: 'home' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      store.createDeliveryToken(bob, { name: 'No', scope: 'preview' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await store.revokeDeliveryToken(alice, key.id);
    await expect(store.publishedStories(key.token, alice.spaceId, {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it('binds read-only preview sessions to their origin, locale, expiry, and current authorization', async () => {
    const previewId = randomUUID();
    await store.updateDeliverySettings(alice, {
      previewUrls: [{ id: previewId, name: 'Local', url: 'http://localhost:3131/{locale}/{slug}' }],
      defaultPreviewId: previewId,
      previewParameter: 'review',
    });
    const session = await store.createEditorPreview(bob, snapshot.story.id, snapshot.locale.id);
    await expect(
      store.authenticatePreview(session.token, 'https://evil.test'),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const connection = await store.authenticatePreview(session.token, 'http://localhost:3131');
    expect(connection).toMatchObject({
      spaceId: alice.spaceId,
      storyId: snapshot.story.id,
      localeId: snapshot.locale.id,
    });
    const draft = await save(alice, snapshot, blockNamed(snapshot, 'hero'), {
      title: 'Live draft',
    });
    expect(JSON.stringify(await store.previewStory(connection.id))).toContain('Live draft');
    expect(JSON.stringify(await store.previewStory(connection.id))).not.toContain('sessionId');
    await pool.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
      bob.spaceId,
      bob.userId,
    ]);
    await expect(store.previewStory(connection.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const key = await store.createDeliveryToken(alice, {
      name: 'Server preview',
      scope: 'preview',
    });
    const tokenSession = await store.createTokenPreview(key.token, alice.spaceId, { slug: 'home' });
    const tokenConnection = await store.authenticatePreview(
      tokenSession.token,
      'http://localhost:3131',
    );
    expect((await store.previewStory(tokenConnection.id)).revision).toBe(draft.snapshot.revision);
    await pool.query(
      "UPDATE preview_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
      [tokenConnection.id],
    );
    await expect(store.previewStory(tokenConnection.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const renewed = await store.createTokenPreview(key.token, alice.spaceId, { slug: 'home' });
    const renewedConnection = await store.authenticatePreview(
      renewed.token,
      'http://localhost:3131',
    );
    await store.revokeDeliveryToken(alice, key.id);
    await expect(store.previewStory(renewedConnection.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it('resolves direct preview story references from current drafts with locale fallback and space isolation', async () => {
    const definitions = await store.listDefinitions(alice),
      page = definitions.find((item) => item.name === 'page')!,
      footer = definitions.find((item) => item.name === 'footer')!;
    await store.updateDefinition(alice, footer.id, {
      ...definitionInput(footer),
      kind: 'universal',
    });
    await store.updateDefinition(alice, page.id, {
      ...definitionInput(page),
      fields: [
        ...page.fields,
        { name: 'footer', label: 'Footer', type: 'option', source: { type: 'stories' } },
        { name: 'related', label: 'Related', type: 'options', source: { type: 'stories' } },
        { name: 'link', label: 'Link', type: 'link' },
      ],
    });
    await deployActive();
    let shared = await store.createStory(alice, {
      name: 'Shared footer',
      slug: 'shared-footer',
      definitionId: footer.id,
    });
    shared = (await save(alice, shared, shared.blocks[0], { text: 'Unpublished footer' })).snapshot;
    const other = await store.createStory(alice, {
      name: 'Other page',
      slug: 'other',
      definitionId: page.id,
    });
    snapshot = (
      await save(alice, snapshot, blockNamed(snapshot, 'page'), {
        title: 'Home',
        footer: shared.story.id,
        related: [shared.story.id],
        link: { type: 'story', storyId: other.story.id },
      })
    ).snapshot;
    const previewId = randomUUID();
    await store.updateDeliverySettings(alice, {
      previewUrls: [
        { id: previewId, name: 'Local', url: 'http://localhost:3132/preview?slug={slug}' },
      ],
      defaultPreviewId: previewId,
    });
    const session = await store.createEditorPreview(alice, snapshot.story.id, snapshot.locale.id);
    const connection = await store.authenticatePreview(session.token, 'http://localhost:3132');
    const first = await store.previewStory(connection.id);
    expect(first.references).toHaveLength(2);
    expect(first.references?.find((item) => item.id === shared.story.id)).toMatchObject({
      locale: '',
      publishedAt: null,
      content: { text: 'Unpublished footer' },
    });
    expect(JSON.stringify(first)).not.toContain('leaseTokens');
    expect(JSON.stringify(first)).not.toContain('schemaVersionId');
    shared = (await save(alice, shared, shared.blocks[0], { text: 'Edited in another tab' }))
      .snapshot;
    const updated = await store.previewStory(connection.id);
    expect(updated.revision).toBe(first.revision);
    expect(updated.referencesRevision).not.toBe(first.referencesRevision);
    expect(updated.references?.find((item) => item.id === shared.story.id)?.content).toMatchObject({
      text: 'Edited in another tab',
    });
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    let translated = await store.createLocale(alice, snapshot.story.id, {
      spaceLocaleId: french.id,
    });
    translated = (
      await save(alice, translated, blockNamed(translated, 'page'), {
        title: 'Accueil',
        footer: shared.story.id,
      })
    ).snapshot;
    const frenchSession = await store.createEditorPreview(
      alice,
      translated.story.id,
      translated.locale.id,
    );
    const frenchConnection = await store.authenticatePreview(
      frenchSession.token,
      'http://localhost:3132',
    );
    expect((await store.previewStory(frenchConnection.id)).references?.[0]).toMatchObject({
      id: shared.story.id,
      locale: '',
    });
    const frenchFooter = await store.createLocale(alice, shared.story.id, {
      spaceLocaleId: french.id,
    });
    await save(alice, frenchFooter, frenchFooter.blocks[0], { text: 'Pied de page' });
    expect((await store.previewStory(frenchConnection.id)).references?.[0]).toMatchObject({
      id: shared.story.id,
      locale: 'fr',
      content: { text: 'Pied de page' },
    });
    const key = await store.createDeliveryToken(alice, { name: 'Public', scope: 'published' });
    await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const published = await store.publishedStories(key.token, alice.spaceId, {
      id: snapshot.story.id,
    });
    expect(published.stories[0].references).toBeUndefined();
    expect(JSON.stringify(published)).not.toContain('Edited in another tab');
    // Simulate stale or malformed stored references without weakening normal command validation.
    const current = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    for (const value of [legacyStoryId, 'not-a-uuid']) {
      const malformed = structuredClone(current),
        root = blockNamed(malformed, 'page');
      root.fields = {
        title: shared.story.id,
        footer: value,
        related: [value],
        link: { type: 'story', storyId: value },
      };
      await pool.query('UPDATE checkpoints SET snapshot=$2 WHERE id=$1', [
        current.checkpointId,
        JSON.stringify(malformed),
      ]);
      expect((await store.previewStory(connection.id)).references).toEqual([]);
    }
    await pool.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
      alice.spaceId,
      alice.userId,
    ]);
    await expect(store.previewStory(connection.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it('preserves legacy preview URLs and scopes selected preview sessions to configured targets', async () => {
    const legacy = (
      await pool.query(
        "SELECT preview_urls,default_preview_id FROM spaces WHERE name='Before upgrade'",
      )
    ).rows[0];
    expect(legacy.preview_urls).toEqual([
      { id: legacy.default_preview_id, name: 'Default', url: 'http://localhost:3132/{slug}' },
    ]);
    expect(await store.getDeliverySettings(alice)).toEqual({
      previewUrls: [],
      defaultPreviewId: null,
      previewParameter: 'storypane_preview',
    });
    const local = { id: randomUUID(), name: 'Local', url: 'http://localhost:3131/{locale}/{slug}' };
    const staging = {
      id: randomUUID(),
      name: 'Staging',
      url: 'https://staging.example.com/{locale}/{slug}',
    };
    const settings = {
      previewUrls: [local, staging],
      defaultPreviewId: staging.id,
      previewParameter: 'review',
    };
    await expect(store.updateDeliverySettings(bob, settings)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await store.updateDeliverySettings(alice, settings)).toEqual(settings);
    expect(await store.getDeliverySettings(bob)).toEqual(settings);
    const defaultSession = await store.createEditorPreview(
      bob,
      snapshot.story.id,
      snapshot.locale.id,
    );
    await expect(
      store.authenticatePreview(defaultSession.token, 'https://staging.example.com'),
    ).resolves.toBeDefined();
    await expect(
      store.authenticatePreview(defaultSession.token, 'http://localhost:3131'),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const explicit = await store.createEditorPreview(bob, snapshot.story.id, snapshot.locale.id, {
      previewId: local.id,
    });
    await expect(
      store.authenticatePreview(explicit.token, 'http://localhost:3131'),
    ).resolves.toBeDefined();
    await expect(
      store.createEditorPreview(bob, snapshot.story.id, snapshot.locale.id, {
        previewId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const token = await store.createDeliveryToken(alice, { name: 'Standalone', scope: 'preview' });
    const standalone = await store.createTokenPreview(token.token, alice.spaceId, {
      slug: 'home',
      previewId: local.id,
    });
    await expect(
      store.authenticatePreview(standalone.token, 'http://localhost:3131'),
    ).resolves.toBeDefined();
    await expect(
      store.createTokenPreview(token.token, alice.spaceId, {
        slug: 'home',
        previewId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await store.updateDeliverySettings(alice, {
      ...settings,
      previewUrls: [local],
      defaultPreviewId: local.id,
    });
    await expect(
      store.authenticatePreview(defaultSession.token, 'https://staging.example.com'),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      store.authenticatePreview(explicit.token, 'http://localhost:3131'),
    ).resolves.toBeDefined();
    await store.updateDeliverySettings(alice, {
      ...settings,
      previewUrls: [],
      defaultPreviewId: null,
    });
    await expect(
      store.createEditorPreview(bob, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('upgrades existing spaces and creates isolated spaces with atomic admin ownership', async () => {
    expect(
      (await pool.query("SELECT description FROM spaces WHERE name='Before upgrade'")).rows,
    ).toEqual([{ description: '' }]);
    const created = await store.createSpace(bob, {
      name: '  Brand website  ',
      description: 'Independent project',
    });
    expect(created).toMatchObject({
      name: 'Brand website',
      role: 'admin',
      storyCount: 0,
      memberCount: 1,
    });
    expect((await store.listSpaces(bob)).map((space) => space.id)).toContain(created.id);
    expect((await store.listSpaces(alice)).map((space) => space.id)).not.toContain(created.id);
    expect(await store.listStories({ ...bob, spaceId: created.id })).toEqual([]);
    await expect(store.listStories({ ...alice, spaceId: created.id })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      store.createSpace({ ...alice, sessionId: 'expired' }, { name: 'Invalid' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(store.createSpace(alice, { name: '  ' })).rejects.toMatchObject({
      code: 'invalid',
    });
  });
  it('shows only space members and checks stored admin permissions when updating settings', async () => {
    const details = await store.getSpace(bob);
    expect(details.members.map((member) => member.id)).toEqual(['alice', 'bob']);
    await expect(
      store.updateSpace({ ...bob, role: 'admin' }, { name: 'Unauthorized' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.updateSpace(alice, { name: 'Updated', description: 'x'.repeat(1001) }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const updated = await store.updateSpace(alice, {
      name: 'Updated',
      description: 'Shared project',
    });
    expect(updated).toMatchObject({
      name: 'Updated',
      description: 'Shared project',
      storyCount: 1,
      memberCount: 2,
    });
    expect((await store.getSpace(bob)).name).toBe('Updated');
    await expect(store.getSpace({ ...alice, spaceId: randomUUID() })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
  it('allows simultaneous edits on different blocks without page-level revision conflicts', async () => {
    const hero = blockNamed(snapshot, 'hero');
    const footer = blockNamed(snapshot, 'footer');
    const heroLease = await lease(alice, snapshot, hero);
    const footerLease = await lease(bob, snapshot, footer);
    await expect(lease(bob, snapshot, hero)).rejects.toMatchObject({ code: 'locked' });
    const results = await Promise.all([
      run(alice, snapshot, {
        ...commandBase({ block: hero, lease: heroLease }),
        type: 'saveBlock',
        payload: { blockId: hero.id, fields: { ...hero.fields, title: 'Alice hero' } },
      }),
      run(bob, snapshot, {
        ...commandBase({ block: footer, lease: footerLease }),
        type: 'saveBlock',
        payload: { blockId: footer.id, fields: { ...footer.fields, text: 'Bob footer' } },
      }),
    ]);
    expect(results.map((r) => r.localeRevision).sort()).toEqual([
      snapshot.revision + 1,
      snapshot.revision + 2,
    ]);
    const latest = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(blockNamed(latest, 'hero').fields.title).toBe('Alice hero');
    expect(blockNamed(latest, 'footer').fields.text).toBe('Bob footer');
    expect(latest.leases.find((l) => l.userId === 'bob')?.token).toBeUndefined();
  });
  it('fences expired tokens and rejects stale content after another editor saves', async () => {
    const hero = blockNamed(snapshot, 'hero');
    const old = await lease(alice, snapshot, hero);
    await pool.query(
      "UPDATE edit_leases SET expires_at=now()-interval '1 second' WHERE block_id=$1",
      [hero.id],
    );
    const replacement = await lease(bob, snapshot, hero);
    expect(replacement.token).not.toBe(old.token);
    await expect(
      run(alice, snapshot, {
        ...commandBase({ block: hero, lease: old }),
        type: 'saveBlock',
        payload: { blockId: hero.id, fields: { title: 'Late' } },
      }),
    ).rejects.toMatchObject({ code: 'locked' });
    const saved = await run(bob, snapshot, {
      ...commandBase({ block: hero, lease: replacement }),
      type: 'saveBlock',
      payload: { blockId: hero.id, fields: { title: 'Fresh' } },
    });
    await expect(
      run(bob, saved.snapshot, {
        ...commandBase({ block: hero, lease: replacement }),
        type: 'saveBlock',
        payload: { blockId: hero.id, fields: { title: 'Stale' } },
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
  });
  it('recovers a committed mutation after lost acknowledgement without duplicating history', async () => {
    const hero = blockNamed(snapshot, 'hero');
    const own = await lease(alice, snapshot, hero);
    const command: Command = {
      ...commandBase({ block: hero, lease: own }),
      type: 'saveBlock',
      payload: { blockId: hero.id, fields: { title: 'Committed' } },
    };
    const first = await run(alice, snapshot, command);
    const restarted = new StorypaneStore(pool);
    const retry = await restarted.command(alice, snapshot.story.id, snapshot.locale.id, command);
    expect(retry.checkpointId).toBe(first.checkpointId);
    expect(await store.listCheckpoints(alice, snapshot.story.id, snapshot.locale.id)).toHaveLength(
      2,
    );
    await expect(
      run(alice, snapshot, {
        ...command,
        payload: { blockId: hero.id, fields: { title: 'Different' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(
      blockNamed(await restarted.getSnapshot(alice, snapshot.story.id, snapshot.locale.id), 'hero')
        .fields.title,
    ).toBe('Committed');
  });
  it('imports independent locale subtrees with fresh IDs and no future inheritance', async () => {
    const configured = await store.createSpaceLocale(alice, { slug: 'fr', name: 'Français' });
    const french = await store.createLocale(alice, snapshot.story.id, {
      spaceLocaleId: configured.id,
    });
    expect(french.blocks).toHaveLength(1);
    const parent = french.blocks[0];
    const own = await lease(alice, french, parent);
    const original = blockNamed(snapshot, 'hero');
    const imported = await run(alice, french, {
      ...commandBase({ block: parent, lease: own }),
      type: 'importBlocks',
      payload: {
        sourceLocaleId: snapshot.locale.id,
        blockIds: [original.id],
        parentId: parent.id,
        parentField: 'body',
      },
    });
    const copy = blockNamed(imported.snapshot, 'hero');
    expect(copy.id).not.toBe(original.id);
    expect(copy.fields).toEqual(original.fields);
    await save(bob, snapshot, original, { title: 'Updated Default' });
    expect(
      blockNamed(await store.getSnapshot(alice, french.story.id, french.locale.id), 'hero').fields,
    ).toEqual(original.fields);
  });
  it('pastes independent nested copies across pages and locales, with retry-safe fresh IDs', async () => {
    const page = snapshot.definitions.find((item) => item.name === 'page')!;
    await store.updateDefinition(alice, page.id, { ...definitionInput(page), kind: 'universal' });
    await deployActive();
    const clipboard = createBlockClipboard(snapshot, alice.spaceId, snapshot.locale.rootBlockId);
    const state = await store.createStory(alice, {
      name: 'Destination',
      slug: 'destination',
      definitionId: page.id,
    });
    const destination = state.story,
      locale = state.locale,
      parent = state.blocks[0]!,
      own = await lease(alice, state, parent);
    const command: Command = {
      ...commandBase({ block: parent, lease: own }),
      type: 'pasteBlock',
      payload: { clipboard, parentId: parent.id, parentField: 'body' },
    };
    const pasted = await run(alice, state, command),
      repeated = await run(alice, state, command);
    expect(repeated.checkpointId).toBe(pasted.checkpointId);
    expect(repeated.changedBlockIds).toEqual(pasted.changedBlockIds);
    expect(pasted.snapshot.blocks).toHaveLength(4);
    const copy = pasted.snapshot.blocks.find((block) => block.parentId === parent.id)!;
    expect(
      snapshot.blocks.some((block) => pasted.snapshot.blocks.some((item) => item.id === block.id)),
    ).toBe(false);
    const children = pasted.snapshot.blocks
      .filter((block) => block.parentId === copy.id)
      .sort((a, b) => a.position - b.position);
    expect(children.map((block) => block.fields)).toEqual([
      blockNamed(snapshot, 'hero').fields,
      blockNamed(snapshot, 'footer').fields,
    ]);
    expect(children.map((block) => block.parentField)).toEqual(['body', 'body']);
    const configured = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const french = await store.createLocale(alice, destination.id, {
        spaceLocaleId: configured.id,
      }),
      root = french.blocks[0]!,
      frenchLease = await lease(alice, french, root);
    const translated = await run(alice, french, {
      ...commandBase({ block: root, lease: frenchLease }),
      type: 'pasteBlock',
      payload: { clipboard, parentId: root.id, parentField: 'body' },
    });
    expect(translated.snapshot.blocks).toHaveLength(4);
    await save(bob, snapshot, blockNamed(snapshot, 'hero'), { title: 'Source edited later' });
    expect(
      blockNamed(await store.getSnapshot(alice, destination.id, locale.id), 'hero').fields.title,
    ).toBe(blockNamed(snapshot, 'hero').fields.title);
    expect(await store.getPublished(alice, destination.id, locale.id)).toBeNull();
  });
  it('validates every pasted block, references, limits, leases, spaces and migration versions atomically', async () => {
    const root = snapshot.blocks.find((block) => block.id === snapshot.locale.rootBlockId)!,
      hero = blockNamed(snapshot, 'hero');
    const clipboard = createBlockClipboard(snapshot, alice.spaceId, hero.id);
    const payload = { clipboard, parentId: root.id, parentField: 'body' };
    await expect(
      run(alice, snapshot, { ...commandBase(), type: 'pasteBlock', payload }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    const own = await lease(alice, snapshot, root);
    const paste = (overrides: Partial<typeof payload> = {}) =>
      run(alice, snapshot, {
        ...commandBase({ block: root, lease: own }),
        type: 'pasteBlock',
        payload: { ...payload, ...overrides },
      });
    await expect(
      run(bob, snapshot, {
        ...commandBase({ block: root, lease: own }),
        type: 'pasteBlock',
        payload,
      }),
    ).rejects.toMatchObject({ code: 'locked' });
    await expect(
      paste({ clipboard: { ...clipboard, spaceId: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(paste({ clipboard: { ...clipboard, migrationVersion: 0 } })).rejects.toMatchObject(
      { code: 'stale_revision' },
    );
    await expect(paste({ parentField: 'title' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      paste({
        clipboard: {
          ...clipboard,
          blocks: [{ ...clipboard.blocks[0]!, definitionId: randomUUID() }],
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const invalidFields: BlockDraft['fields'][] = [
      { title: 123 },
      { title: 'Copied', image: { assetId: randomUUID() } },
    ];
    for (const fields of invalidFields)
      await expect(
        paste({ clipboard: { ...clipboard, blocks: [{ ...clipboard.blocks[0]!, fields }] } }),
      ).rejects.toMatchObject({ code: 'invalid' });
    const malformed = {
      ...clipboard,
      blocks: [
        ...clipboard.blocks,
        { ...clipboard.blocks[0]!, parentIndex: 0, parentField: 'title' },
      ],
    };
    await expect(paste({ clipboard: malformed })).rejects.toMatchObject({ code: 'invalid' });
    const unchanged = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(unchanged.blocks).toEqual(snapshot.blocks);
    expect(unchanged.checkpointId).toBe(snapshot.checkpointId);
    const definition = snapshot.definitions.find((item) => item.id === root.definitionId)!;
    await store.updateDefinition(alice, definition.id, {
      ...definitionInput(definition),
      fields: definition.fields.map((field) =>
        field.type === 'blocks' ? { ...field, maxItems: 2 } : field,
      ),
    });
    await deployActive();
    const currentRoot = blockNamed(snapshot, 'page'),
      currentLease = await lease(alice, snapshot, currentRoot),
      currentClipboard = createBlockClipboard(snapshot, alice.spaceId, hero.id);
    await expect(
      run(alice, snapshot, {
        ...commandBase({ block: currentRoot, lease: currentLease }),
        type: 'pasteBlock',
        payload: { ...payload, clipboard: currentClipboard },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)).blocks,
    ).toHaveLength(3);
  });
  it('restores one block without reverting another editor’s sibling work', async () => {
    const originalCheckpoint = snapshot.checkpointId!;
    const hero = blockNamed(snapshot, 'hero');
    const footer = blockNamed(snapshot, 'footer');
    await save(alice, snapshot, hero, { title: 'New hero' });
    await save(bob, snapshot, footer, { text: 'Keep this footer' });
    const current = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    const currentHero = blockNamed(current, 'hero');
    const own = await lease(alice, current, currentHero);
    const restored = await run(alice, current, {
      ...commandBase({ block: currentHero, lease: own }),
      type: 'restoreBlock',
      payload: { blockId: currentHero.id, checkpointId: originalCheckpoint },
    });
    expect(blockNamed(restored.snapshot, 'hero').fields).toEqual(hero.fields);
    expect(blockNamed(restored.snapshot, 'footer').fields.text).toBe('Keep this footer');
    expect(restored.localeRevision).toBe(current.revision + 1);
  });
  it('publishes the exact reviewed checkpoint while keeping later changes as drafts', async () => {
    const original = snapshot.checkpointId!;
    const hero = blockNamed(snapshot, 'hero');
    const changed = await save(alice, snapshot, hero, { title: 'Unreviewed new content' });
    const published = await run(bob, changed.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: original },
    });
    expect(blockNamed(published.snapshot, 'hero').fields.title).toBe('Unreviewed new content');
    const live = await store.getPublished(alice, snapshot.story.id, snapshot.locale.id);
    expect(live?.checkpointId).toBe(original);
    expect(JSON.stringify(live?.content)).toContain('Build something worth sharing.');
    expect(JSON.stringify(live?.content)).not.toContain('Unreviewed');
    const second = await run(bob, published.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: original },
    });
    expect(second.publicationId).not.toBe(published.publicationId);
  });
  it('allows incomplete draft fields but refuses to publish them', async () => {
    const saved = await save(alice, snapshot, blockNamed(snapshot, 'hero'), { title: '' });
    await expect(
      run(alice, saved.snapshot, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: saved.checkpointId },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(await store.getPublished(alice, snapshot.story.id, snapshot.locale.id)).toBeNull();
  });
  it('protects descendant locks during structural deletion and prevents cycles', async () => {
    const container = await store.createDefinition(alice, {
      name: 'container',
      displayName: 'Container',
      kind: 'nestable',
      fields: [{ name: 'body', label: 'Body', type: 'blocks' }],
    });
    await deployActive();
    let state = snapshot;
    const root = state.blocks.find((b) => b.id === state.locale.rootBlockId)!;
    const rootLease = await lease(alice, state, root);
    state = (
      await run(alice, state, {
        ...commandBase({ block: root, lease: rootLease }),
        type: 'insertBlock',
        payload: { parentId: root.id, parentField: 'body', definitionId: container.id },
      })
    ).snapshot;
    let parent = blockNamed(state, 'container');
    const parentLease = await lease(alice, state, parent);
    state = (
      await run(alice, state, {
        ...commandBase({ block: parent, lease: parentLease }),
        type: 'insertBlock',
        payload: { parentId: parent.id, parentField: 'body', definitionId: container.id },
      })
    ).snapshot;
    parent = state.blocks.find((b) => b.id === parent.id)!;
    const child = state.blocks.find((b) => b.parentId === parent.id)!;
    const childLease = await lease(bob, state, child);
    const currentRoot = state.blocks.find((b) => b.id === root.id)!;
    await expect(
      run(alice, state, {
        ...commandBase(
          { block: parent, lease: parentLease },
          { block: currentRoot, lease: rootLease },
        ),
        type: 'deleteBlock',
        payload: { blockId: parent.id },
      }),
    ).rejects.toMatchObject({ code: 'locked' });
    await store.releaseLease(bob, state.story.id, state.locale.id, child.id, childLease.token!);
    const ownedChild = await lease(alice, state, child);
    await expect(
      run(alice, state, {
        ...commandBase(
          { block: parent, lease: parentLease },
          { block: currentRoot, lease: rootLease },
          { block: child, lease: ownedChild },
        ),
        type: 'moveBlock',
        payload: { blockId: parent.id, parentId: child.id, parentField: 'body', position: 0 },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('requires an unchanged reviewed page and no competing leases for whole-page restoration', async () => {
    const checkpointId = snapshot.checkpointId!;
    const root = snapshot.blocks.find((b) => b.id === snapshot.locale.rootBlockId)!;
    const rootLease = await lease(alice, snapshot, root);
    const footer = blockNamed(snapshot, 'footer');
    const bobLease = await lease(bob, snapshot, footer);
    const restore: Command = {
      ...commandBase({ block: root, lease: rootLease }),
      expectedRevisions: { [root.id]: root.revision, $locale: snapshot.revision },
      type: 'restorePage',
      payload: { checkpointId },
    };
    await expect(run(alice, snapshot, restore)).rejects.toMatchObject({ code: 'locked' });
    await store.releaseLease(
      bob,
      snapshot.story.id,
      snapshot.locale.id,
      footer.id,
      bobLease.token!,
    );
    const saved = await save(alice, snapshot, footer, { text: 'Later' });
    await expect(run(alice, saved.snapshot, restore)).rejects.toMatchObject({
      code: 'stale_revision',
    });
    const restored = await run(alice, saved.snapshot, {
      ...restore,
      mutationId: randomUUID(),
      expectedRevisions: { [root.id]: root.revision, $locale: saved.localeRevision },
    });
    expect(blockNamed(restored.snapshot, 'footer').fields).toEqual(footer.fields);
  });
  it('versions schemas without mutating existing content, and rolls back invalid structural changes', async () => {
    const definition = await store.createDefinition(alice, {
      name: 'limited',
      displayName: 'Limited page',
      kind: 'content-type',
      fields: [{ name: 'body', label: 'Body', type: 'blocks', maxItems: 1 }],
    });
    await deployActive();
    let state = await store.createStory(alice, {
      name: 'Limited',
      slug: 'limited',
      definitionId: definition.id,
    });
    const root = state.blocks[0];
    const own = await lease(alice, state, root);
    const hero = snapshot.definitions.find((d) => d.name === 'hero')!;
    state = (
      await run(alice, state, {
        ...commandBase({ block: root, lease: own }),
        type: 'insertBlock',
        payload: { parentId: root.id, parentField: 'body', definitionId: hero.id },
      })
    ).snapshot;
    const current = state.blocks.find((b) => b.id === root.id)!;
    await expect(
      run(alice, state, {
        ...commandBase({ block: current, lease: own }),
        type: 'insertBlock',
        payload: { parentId: root.id, parentField: 'body', definitionId: hero.id },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const unchanged = await store.getSnapshot(alice, state.story.id, state.locale.id);
    expect(unchanged.revision).toBe(state.revision);
    expect(unchanged.blocks).toHaveLength(2);
    const revised = await store.updateDefinition(alice, hero.id, {
      name: hero.name,
      displayName: hero.displayName,
      kind: hero.kind,
      fields: [
        ...hero.fields,
        { name: 'subtitle', label: 'Subtitle', type: 'text', format: 'singleline' },
      ],
    });
    expect(revised.version).toBe(2);
    expect(blockNamed(unchanged, 'hero').schemaVersionId).toBe(hero.versionId);
  });
  it('enforces tag restrictions for inserts, moves, and imports using each block schema version', async () => {
    const childInput = {
      name: 'tagged',
      displayName: 'Tagged',
      kind: 'nestable',
      tags: ['layout'],
      fields: [],
    };
    const child = await store.createDefinition(alice, childInput);
    const other = await store.createDefinition(alice, {
      ...childInput,
      name: 'untagged',
      tags: [],
    });
    const parent = await store.createDefinition(alice, {
      name: 'tag_page',
      displayName: 'Tag page',
      kind: 'content-type',
      fields: [
        { name: 'body', label: 'Body', type: 'blocks', allowedTags: ['layout', 'marketing'] },
        { name: 'other', label: 'Other', type: 'blocks' },
      ],
    });
    await deployActive();
    let state = await store.createStory(alice, {
      name: 'Tags',
      slug: 'tags',
      definitionId: parent.id,
    });
    const rootId = state.locale.rootBlockId;
    const own = await lease(alice, state, state.blocks[0]);
    const insert = (definitionId: string, parentField: string) =>
      run(alice, state, {
        ...commandBase({ block: state.blocks.find((b) => b.id === rootId)!, lease: own }),
        type: 'insertBlock',
        payload: { parentId: rootId, parentField, definitionId },
      });
    await expect(insert(other.id, 'body')).rejects.toMatchObject({ code: 'invalid' });
    state = (await insert(child.id, 'body')).snapshot;
    state = (await insert(other.id, 'other')).snapshot;
    const root = state.blocks.find((b) => b.id === rootId)!;
    const untagged = blockNamed(state, 'untagged');
    const untaggedLease = await lease(alice, state, untagged);
    await expect(
      run(alice, state, {
        ...commandBase({ block: root, lease: own }, { block: untagged, lease: untaggedLease }),
        type: 'moveBlock',
        payload: { blockId: untagged.id, parentId: root.id, parentField: 'body', position: 0 },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const configured = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    let french = await store.createLocale(alice, state.story.id, { spaceLocaleId: configured.id });
    const frenchRoot = french.blocks[0];
    const frenchLease = await lease(alice, french, frenchRoot);
    const importBlock = (blockId: string) =>
      run(alice, french, {
        ...commandBase({
          block: french.blocks.find((b) => b.id === frenchRoot.id)!,
          lease: frenchLease,
        }),
        type: 'importBlocks',
        payload: {
          sourceLocaleId: state.locale.id,
          blockIds: [blockId],
          parentId: frenchRoot.id,
          parentField: 'body',
        },
      });
    await expect(importBlock(untagged.id)).rejects.toMatchObject({ code: 'invalid' });
    french = (await importBlock(blockNamed(state, 'tagged').id)).snapshot;
    expect(blockNamed(french, 'tagged').schemaVersionId).toBe(child.versionId);
    await store.updateDefinition(alice, child.id, { ...childInput, tags: ['other'] });
    state = (await insert(child.id, 'body')).snapshot;
    const pending = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    expect((await store.reviewMigration(alice, pending.id)).blockers.length).toBeGreaterThan(0);
    await expect(
      run(alice, state, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: state.checkpointId! },
      }),
    ).resolves.toBeDefined();
    const token = await store.createDeliveryToken(alice, { name: 'Types', scope: 'preview' });
    const contract = await store.deliverySchema(token.token, alice.spaceId);
    expect(contract.components.find((c) => c.id === child.id)?.tags).toEqual(['layout']);
    expect(contract.components.find((c) => c.id === parent.id)?.fields[0]).toMatchObject({
      allowedTags: ['layout', 'marketing'],
    });
  });
  it('enforces session, role, space boundaries and preserves archived asset references', async () => {
    await expect(
      store.createDefinition(bob, {
        name: 'bad',
        displayName: 'Bad',
        kind: 'nestable',
        fields: [],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.getSnapshot({ ...alice, sessionId: 'missing' }, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      store.getSnapshot({ ...alice, spaceId: randomUUID() }, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const foreignSpace = randomUUID();
    const foreignAsset = randomUUID();
    const ownAsset = randomUUID();
    await pool.query("INSERT INTO spaces(id,name) VALUES($1,'Other')", [foreignSpace]);
    for (const [id, space] of [
      [foreignAsset, foreignSpace],
      [ownAsset, alice.spaceId],
    ])
      await pool.query(
        "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title,archived_at) VALUES($1::uuid,$2,$1::text,'test.png','image/png',10,'Test',now())",
        [id, space],
      );
    const hero = blockNamed(snapshot, 'hero');
    await expect(
      save(alice, snapshot, hero, { ...hero.fields, image: { assetId: foreignAsset } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const valid = await save(alice, snapshot, hero, {
      ...hero.fields,
      image: { assetId: ownAsset, alt: 'Historical image' },
    });
    expect(blockNamed(valid.snapshot, 'hero').fields.image).toEqual({
      assetId: ownAsset,
      alt: 'Historical image',
    });
  });
  it('manages datasources and paginated stable story option values', async () => {
    const source = await store.saveDatasource(alice, {
      name: 'Colors',
      slug: 'colors',
      items: [
        { label: 'Red', value: 'red' },
        { label: 'Blue', value: 'blue' },
      ],
    });
    expect(
      await store.resolveOptions(bob, {
        source: { type: 'datasource', datasourceId: source.id },
        query: 'bl',
      }),
    ).toEqual({ items: [{ label: 'Blue', value: 'blue' }] });
    expect((await store.resolveOptions(bob, { source: { type: 'stories' } })).items).toContainEqual(
      {
        value: snapshot.story.id,
        label: snapshot.story.name,
        description: `/${snapshot.story.slug}`,
      },
    );
    await expect(
      store.saveDatasource(bob, { name: 'No', slug: 'no', items: [] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.saveDatasource(alice, {
        name: 'Dup',
        slug: 'dup',
        items: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'a' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('enforces asset MIME restrictions on drafts and reviewed publication while allowing archived matching assets', async () => {
    const definition = await store.createDefinition(alice, {
      name: 'image_page',
      displayName: 'Image page',
      kind: 'content-type',
      fields: [{ name: 'image', label: 'Image', type: 'asset', mimeTypes: ['image/*'] }],
    });
    await deployActive();
    const state = await store.createStory(alice, {
      name: 'Images',
      slug: 'images',
      definitionId: definition.id,
    });
    const root = state.blocks[0];
    const imageId = randomUUID();
    const fileId = randomUUID();
    for (const [id, mime] of [
      [imageId, 'image/png'],
      [fileId, 'application/pdf'],
    ])
      await pool.query(
        "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title,archived_at) VALUES($1::uuid,$2,$1::text,'fixture',$3,10,'Fixture',now())",
        [id, alice.spaceId, mime],
      );
    await expect(save(alice, state, root, { image: { assetId: fileId } })).rejects.toMatchObject({
      code: 'invalid',
      message: 'Image does not allow this asset type',
    });
    const saved = await save(alice, state, root, { image: { assetId: imageId } });
    const published = await run(alice, saved.snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: saved.checkpointId },
    });
    expect(published.publicationId).toBeTruthy();
    // Simulate a legacy checkpoint created before validation existed: publication revalidates it.
    await pool.query(
      "UPDATE checkpoints SET snapshot=jsonb_set(snapshot,'{blocks,0,fields,image,assetId}',to_jsonb($2::text)) WHERE id=$1",
      [saved.checkpointId, fileId],
    );
    await expect(
      run(alice, saved.snapshot, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: saved.checkpointId },
      }),
    ).rejects.toMatchObject({ code: 'invalid', message: 'Image does not allow this asset type' });
  });
});

describe('Space member management', () => {
  it('uses stored roles, validates input, and isolates spaces', async () => {
    await expect(
      store.inviteSpaceMember(
        { ...bob, role: 'admin' },
        { email: 'new@example.com', role: 'admin' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(store.updateSpaceMember(bob, 'alice', { role: 'editor' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(store.removeSpaceMember(bob, 'alice')).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(store.listSpaceInvitations(bob)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.inviteSpaceMember(alice, { email: 'invalid', role: 'editor' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.updateSpaceMember(alice, 'bob', { role: 'owner' })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      store.inviteSpaceMember(alice, { email: 'bob@test.local', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const other = await store.createSpace(alice, { name: 'Other' });
    await expect(
      store.removeSpaceMember({ ...alice, spaceId: other.id }, 'bob'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await store.inviteSpaceMember(alice, { email: ' New@Example.com ', role: 'editor' });
    const [invite] = await store.listSpaceInvitations(alice);
    expect(invite!.email).toBe('new@example.com');
    await expect(
      store.revokeSpaceInvitation({ ...alice, spaceId: other.id }, invite!.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.revokeSpaceInvitation(bob, invite!.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      store.inviteSpaceMember(alice, { email: 'new@example.com', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await store.revokeSpaceInvitation(alice, invite!.id);
    expect(await store.listSpaceInvitations(alice)).toEqual([]);
  });
  it('never removes or demotes the last admin, including concurrent changes', async () => {
    await expect(store.removeSpaceMember(alice, 'alice')).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(store.updateSpaceMember(alice, 'alice', { role: 'editor' })).rejects.toMatchObject(
      { code: 'invalid' },
    );
    await store.updateSpaceMember(alice, 'bob', { role: 'admin' });
    const results = await Promise.allSettled([
      store.updateSpaceMember(alice, 'alice', { role: 'editor' }),
      store.updateSpaceMember(bob, 'bob', { role: 'editor' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await store.getSpace(alice)).members.filter((member) => member.role === 'admin'),
    ).toHaveLength(1);
  });
  it('removes access and leases without deleting content or access to other spaces', async () => {
    const root = snapshot.blocks.find((block) => block.parentId === null)!;
    await store.acquireLease(bob, snapshot.story.id, snapshot.locale.id, root.id);
    const other = await store.createSpace(bob, { name: 'Bob owns this' });
    await store.removeSpaceMember(alice, 'bob');
    await expect(
      store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const after = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(after.blocks).toEqual(snapshot.blocks);
    expect(after.leases).toEqual([]);
    expect((await store.getSpace({ ...bob, spaceId: other.id })).role).toBe('admin');
  });
  it('grants only unexpired email invitations, once, without changing existing roles', async () => {
    await store.inviteSpaceMember(alice, { email: 'new@example.com', role: 'editor' });
    const client = await pool.connect();
    try {
      await acceptVerifiedEmailInvitations(client, 'new-user', 'different@example.com');
      expect(await store.listSpaceInvitations(alice)).toHaveLength(1);
      await acceptVerifiedEmailInvitations(client, 'new-user', 'NEW@example.com');
      expect(await store.listSpaceInvitations(alice)).toEqual([]);
      expect(
        (
          await pool.query('SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2', [
            alice.spaceId,
            'new-user',
          ])
        ).rows[0].role,
      ).toBe('editor');
      await acceptVerifiedEmailInvitations(client, 'new-user', 'new@example.com');
      await store.inviteSpaceMember(alice, { email: 'expired@example.com', role: 'admin' });
      await pool.query(
        "UPDATE space_invitations SET expires_at=now()-interval '1 second' WHERE space_id=$1",
        [alice.spaceId],
      );
      await acceptVerifiedEmailInvitations(client, 'expired-user', 'expired@example.com');
      expect(
        (await pool.query('SELECT 1 FROM memberships WHERE user_id=$1', ['expired-user'])).rowCount,
      ).toBe(0);
      await store.inviteSpaceMember(alice, { email: 'expired@example.com', role: 'editor' });
      await acceptVerifiedEmailInvitations(client, 'alice', 'expired@example.com');
      expect((await store.getSpace(alice)).role).toBe('admin');
    } finally {
      client.release();
    }
  });
});

describe('Space roles and permissions', () => {
  async function custom(permissions: string[], name = 'Custom role') {
    await store.saveSpaceRole(alice, { name, permissions });
    return (await store.listSpaceRoles(alice)).find((role) => role.name === name)!;
  }
  it('preserves built-ins and only allows admins to configure roles', async () => {
    const roles = await store.listSpaceRoles(alice);
    expect(roles.map((role) => role.id).sort()).toEqual(['admin', 'editor', 'viewer']);
    expect(roles.find((role) => role.id === 'viewer')!.permissions).toEqual(['content:read']);
    await expect(
      store.saveSpaceRole(bob, { name: 'Escalate', permissions: ['schemas:write'] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.saveSpaceRole(alice, { name: 'Changed', permissions: [] }, 'editor'),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.deleteSpaceRole(alice, 'admin')).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      store.saveSpaceRole(alice, { name: 'Invalid', permissions: ['members:manage'] }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      store.saveSpaceRole(alice, {
        name: 'Duplicate',
        permissions: ['content:edit', 'content:edit'],
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('scopes custom roles to their space and protects assigned roles from deletion', async () => {
    const role = await custom(['content:edit']);
    const other = await store.createSpace(alice, { name: 'Other' });
    const outsider = { ...alice, spaceId: other.id };
    await expect(
      store.saveSpaceRole(outsider, { name: 'Stolen', permissions: [] }, role.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.inviteSpaceMember(outsider, { email: 'invite@example.com', role: role.id }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.deleteSpaceRole(outsider, role.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await store.updateSpaceMember(alice, 'bob', { role: role.id });
    await expect(store.deleteSpaceRole(alice, role.id)).rejects.toMatchObject({ code: 'invalid' });
    await store.updateSpaceMember(alice, 'bob', { role: 'viewer' });
    await store.inviteSpaceMember(alice, { email: 'invite@example.com', role: role.id });
    await expect(store.deleteSpaceRole(alice, role.id)).rejects.toMatchObject({ code: 'invalid' });
    const [invitation] = await store.listSpaceInvitations(alice);
    await store.revokeSpaceInvitation(alice, invitation!.id);
    await store.deleteSpaceRole(alice, role.id);
    expect((await store.listSpaceRoles(alice)).some((item) => item.id === role.id)).toBe(false);
  });
  it('makes viewers read-only even with a forged admin actor or an old editing lease', async () => {
    const root = snapshot.blocks.find((block) => !block.parentId)!;
    const own = await lease(bob, snapshot, root);
    await store.updateSpaceMember(alice, 'bob', { role: 'viewer' });
    const forged = { ...bob, role: 'admin' };
    expect((await store.getSnapshot(forged, snapshot.story.id, snapshot.locale.id)).story.id).toBe(
      snapshot.story.id,
    );
    const role = await store.getSpace(forged);
    expect(role.roleName).toBe('Viewer');
    expect(role.permissions).toEqual(['content:read']);
    await expect(
      store.acquireLease(forged, snapshot.story.id, snapshot.locale.id, root.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.renewLease(forged, snapshot.story.id, snapshot.locale.id, root.id, own.token!),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(forged, snapshot, {
        ...commandBase({ block: root, lease: own }),
        type: 'saveBlock',
        payload: { blockId: root.id, fields: root.fields },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.createStory(forged, {
        name: 'Denied',
        slug: 'denied',
        definitionId: root.definitionId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.createLocale(forged, snapshot.story.id, {
        spaceLocaleId: snapshot.locale.spaceLocaleId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(forged, snapshot, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: snapshot.checkpointId! },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(store.updateSpace(forged, { name: 'Denied' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      store.createDefinition(forged, {
        name: 'denied',
        displayName: 'Denied',
        kind: 'nestable',
        fields: [],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.saveDatasource(forged, { name: 'Denied', slug: 'denied', items: [] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('separates editing and publishing, and rechecks changed permissions immediately', async () => {
    const role = await custom(['content:edit']);
    await store.updateSpaceMember(alice, 'bob', { role: role.id });
    const root = snapshot.blocks.find((block) => !block.parentId)!;
    const saved = await save(bob, snapshot, root, root.fields);
    await expect(
      run(bob, snapshot, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: saved.checkpointId },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await store.saveSpaceRole(
      alice,
      { name: role.name, permissions: ['content:publish'] },
      role.id,
    );
    await expect(
      store.acquireLease(bob, snapshot.story.id, snapshot.locale.id, root.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const published = await run(bob, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: saved.checkpointId },
    });
    expect(published.publicationId).toBeTruthy();
    await expect(
      store.inviteSpaceMember(bob, { email: 'admin@example.com', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('grants only the selected management capabilities', async () => {
    const role = await custom(['schemas:write', 'datasources:write', 'settings:write']);
    await store.updateSpaceMember(alice, 'bob', { role: role.id });
    await store.createDefinition(bob, {
      name: 'allowed',
      displayName: 'Allowed',
      kind: 'nestable',
      fields: [],
    });
    await store.saveDatasource(bob, { name: 'Allowed', slug: 'allowed', items: [] });
    await store.updateSpace(bob, { name: 'Renamed' });
    await store.createSpaceLocale(bob, { name: 'German', slug: 'de' });
    await store.createDeliveryToken(bob, { name: 'Website', scope: 'published' });
    await expect(store.removeSpaceMember(bob, 'alice')).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      store.saveSpaceRole(bob, { name: 'Escalate', permissions: ['content:edit'] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('Searchable page references', () => {
  it('resolves pasted IDs and paths while retaining space and content-type restrictions', async () => {
    const source = { type: 'stories' as const };
    expect(
      (await store.resolveOptions(bob, { source, query: `  ${snapshot.story.id.toUpperCase()}  ` }))
        .items,
    ).toEqual([
      {
        value: snapshot.story.id,
        label: snapshot.story.name,
        description: `/${snapshot.story.slug}`,
      },
    ]);
    expect(
      (await store.resolveOptions(bob, { source, query: `/${snapshot.story.slug}` })).items[0]!
        .value,
    ).toBe(snapshot.story.id);
    const different = await store.createDefinition(alice, {
      name: 'other_page',
      displayName: 'Other page',
      kind: 'content-type',
      fields: [],
    });
    expect(
      (
        await store.resolveOptions(bob, {
          source: { ...source, contentTypeId: different.id },
          query: snapshot.story.id,
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await store.resolveOptions(bob, {
          source: { ...source, contentTypeId: different.id },
          values: [snapshot.story.id],
        })
      ).items,
    ).toEqual([]);
    const other = await store.createSpace(alice, { name: 'Private' });
    expect(
      (
        await store.resolveOptions(
          { ...alice, spaceId: other.id },
          { source, query: snapshot.story.id },
        )
      ).items,
    ).toEqual([]);
    expect(
      (
        await store.resolveOptions(
          { ...alice, spaceId: other.id },
          { source, values: [snapshot.story.id] },
        )
      ).items,
    ).toEqual([]);
    expect((await store.resolveOptions(bob, { source, query: randomUUID() })).items).toEqual([]);
  });
  it('resolves stored labels beyond the first page without changing pagination', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 55; i++)
      ids.push(
        (
          await pool.query(
            'INSERT INTO stories(space_id,name,slug) VALUES($1,$2,$3) RETURNING id',
            [alice.spaceId, `Page ${String(i).padStart(2, '0')}`, `page-${i}`],
          )
        ).rows[0].id,
      );
    const source = { type: 'stories' as const };
    const first = await store.resolveOptions(bob, { source });
    expect(first.items).toHaveLength(50);
    expect(first.items.some((item) => item.value === ids[54])).toBe(false);
    const saved = await store.resolveOptions(bob, { source, values: [ids[54]] });
    expect(saved.items).toEqual([{ value: ids[54], label: 'Page 54', description: '/page-54' }]);
    const next = await store.resolveOptions(bob, { source, cursor: first.nextCursor });
    expect(next.items.some((item) => item.value === ids[54])).toBe(true);
    const inline = {
      type: 'inline' as const,
      items: Array.from({ length: 60 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` })),
    };
    expect((await store.resolveOptions(bob, { source: inline, values: ['v59'] })).items).toEqual([
      { value: 'v59', label: 'Option 59' },
    ]);
  });
});

describe('Publication status', () => {
  const publish = (state: LocaleSnapshot, checkpointId = state.checkpointId!) =>
    run(alice, state, { ...commandBase(), type: 'publishCheckpoint', payload: { checkpointId } });
  it('distinguishes drafts, current publications, older publications, and reverted content', async () => {
    expect(snapshot.publicationStatus).toBe('draft');
    expect((await store.listStories(alice))[0]).toMatchObject({
      publicationStatus: 'draft',
      localeCount: 1,
      pendingLocaleCount: 1,
    });
    const published = await publish(snapshot);
    expect(published.snapshot.checkpointId).not.toBe(snapshot.checkpointId);
    expect(published.snapshot.publicationStatus).toBe('published');
    expect((await store.listStories(alice))[0]).toMatchObject({
      publicationStatus: 'published',
      pendingLocaleCount: 0,
      pendingLocales: [],
    });
    const root = published.snapshot.blocks.find((block) => !block.parentId)!;
    const changed = await save(alice, published.snapshot, root, {
      ...root.fields,
      title: 'Waiting to go live',
    });
    expect(changed.snapshot.publicationStatus).toBe('changed');
    expect((await store.listStories(alice))[0]).toMatchObject({
      publicationStatus: 'changed',
      pendingLocaleCount: 1,
    });
    const oldPublication = await publish(changed.snapshot, snapshot.checkpointId!);
    expect(oldPublication.snapshot.publicationStatus).toBe('changed');
    const currentRoot = oldPublication.snapshot.blocks.find((block) => block.id === root.id)!;
    const reverted = await save(alice, oldPublication.snapshot, currentRoot, root.fields);
    expect(reverted.snapshot.publicationStatus).toBe('published');
    expect((await store.listStories(alice))[0].publicationStatus).toBe('published');
  });
  it('keeps locale statuses independent and surfaces unpublished locales in Content', async () => {
    const published = await publish(snapshot);
    const configured = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const french = await store.createLocale(alice, snapshot.story.id, {
      spaceLocaleId: configured.id,
    });
    expect(french.publicationStatus).toBe('draft');
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, published.snapshot.locale.id))
        .publicationStatus,
    ).toBe('published');
    expect((await store.listStories(alice))[0]).toMatchObject({
      publicationStatus: 'changed',
      localeCount: 2,
      pendingLocaleCount: 1,
      pendingLocales: [{ id: french.locale.id, name: 'French', slug: 'fr' }],
    });
    const liveFrench = await publish(french);
    expect((await store.listStories(alice))[0]).toMatchObject({
      publicationStatus: 'published',
      pendingLocales: [],
    });
    const root = liveFrench.snapshot.blocks[0]!;
    await save(alice, liveFrench.snapshot, root, {
      ...root.fields,
      title: 'Unpublished French edit',
    });
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, published.snapshot.locale.id))
        .publicationStatus,
    ).toBe('published');
    expect((await store.listStories(alice))[0]).toMatchObject({
      publicationStatus: 'changed',
      pendingLocaleCount: 1,
      pendingLocales: [{ id: french.locale.id, name: 'French', slug: 'fr' }],
    });
  });
});

describe('Active editor avatars', () => {
  it('reports real profiles for block editors, deduplicated across blocks and locales', async () => {
    expect(await store.listPageEditors(alice)).toEqual({});
    await pool.query('UPDATE "user" SET avatar_url=$1 WHERE id=$2', [
      'https://img.clerk.com/alice.png',
      'alice',
    ]);
    const hero = blockNamed(snapshot, 'hero'),
      footer = blockNamed(snapshot, 'footer');
    const heroLease = await lease(alice, snapshot, hero);
    await lease(
      alice,
      snapshot,
      snapshot.blocks.find((block) => !block.parentId)!,
    );
    await lease(bob, snapshot, footer);
    const locale = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const french = await store.createLocale(alice, snapshot.story.id, { spaceLocaleId: locale.id });
    await lease(alice, french, french.blocks[0]!);
    const editors = await store.listPageEditors(bob);
    expect(editors[snapshot.story.id]).toEqual([
      {
        userId: 'alice',
        name: 'Alice',
        avatarUrl: 'https://img.clerk.com/alice.png',
        locales: ['Default', 'French'],
      },
      { userId: 'bob', name: 'Bob', avatarUrl: null, locales: ['Default'] },
    ]);
    expect(JSON.stringify(editors)).not.toContain(heroLease.token);
    expect(JSON.stringify(editors)).not.toContain('alice-session');
    const other = await store.createSpace(alice, { name: 'Another space' });
    expect(await store.listPageEditors({ ...alice, spaceId: other.id })).toEqual({});
    await expect(store.listPageEditors({ ...bob, spaceId: other.id })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
  it('removes expired, released, revoked, and read-only editor indicators', async () => {
    const hero = blockNamed(snapshot, 'hero');
    const current = await lease(bob, snapshot, hero);
    expect((await store.listPageEditors(alice))[snapshot.story.id]).toHaveLength(1);
    await store.releaseLease(bob, snapshot.story.id, snapshot.locale.id, hero.id, current.token!);
    expect(await store.listPageEditors(alice)).toEqual({});
    await lease(bob, snapshot, hero);
    await pool.query(
      "UPDATE edit_leases SET expires_at=now()-interval '1 second' WHERE locale_id=$1",
      [snapshot.locale.id],
    );
    expect(await store.listPageEditors(alice)).toEqual({});
    await lease(bob, snapshot, hero);
    await store.updateSpaceMember(alice, 'bob', { role: 'viewer' });
    expect(await store.listPageEditors(alice)).toEqual({});
    await store.updateSpaceMember(alice, 'bob', { role: 'editor' });
    expect(await store.listPageEditors(alice)).toEqual({});
    await lease(bob, snapshot, hero);
    expect((await store.listPageEditors(alice))[snapshot.story.id]).toHaveLength(1);
    await store.removeSpaceMember(alice, 'bob');
    expect(await store.listPageEditors(alice)).toEqual({});
  });
  it('does not show a lease from an expired or revoked session', async () => {
    const sessionId = randomUUID();
    await pool.query("INSERT INTO cms_sessions VALUES($1,'bob',now()+interval '1 hour')", [
      sessionId,
    ]);
    const editor = { ...bob, sessionId };
    await lease(editor, snapshot, blockNamed(snapshot, 'hero'));
    expect((await store.listPageEditors(alice))[snapshot.story.id]).toHaveLength(1);
    await pool.query("UPDATE cms_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [
      sessionId,
    ]);
    expect(await store.listPageEditors(alice)).toEqual({});
    await pool.query('DELETE FROM cms_sessions WHERE id=$1', [sessionId]);
    expect(await store.listPageEditors(alice)).toEqual({});
  });
});

describe('shared schema migrations', () => {
  it('backfills identities without changing legacy content, then normalizes only on admin deployment', async () => {
    const actor = { ...alice, spaceId: legacySpaceId };
    const before = await store.getSnapshot(actor, legacyStoryId, legacyLocaleId);
    expect(before.migrationVersion).toBe(0);
    expect(before.blocks[0]!.fields).toEqual({ title: 'Legacy value', retired: 42 });
    const active = (await store.listMigrations(actor)).find((item) => item.status === 'active')!;
    expect(active.definitions[0]!.fields[0]!.id).toBe(before.definitions[0]!.fields[0]!.id);
    const review = await store.reviewMigration(actor, active.id);
    expect(
      review.changes.some((change) => change.field === 'retired' && change.kind === 'removed'),
    ).toBe(true);
    expect(review.impacts[0]!.deletedValues).toBe(1);
    await store.deployMigration(actor, active.id, review.token, {
      confirmation: review.confirmation ?? undefined,
    });
    const after = await store.getSnapshot(actor, legacyStoryId, legacyLocaleId);
    expect(after.migrationVersion).toBe(1);
    expect(after.blocks[0]!.id).toBe(legacyRootId);
    expect(after.blocks[0]!.fields).toEqual({ title: 'Legacy value' });
  });
  it('serializes competing schema saves without losing separate-definition edits', async () => {
    const definitions = await store.listDefinitions(alice),
      hero = definitions.find((item) => item.name === 'hero')!,
      footer = definitions.find((item) => item.name === 'footer')!;
    const results = await Promise.allSettled(
      ['First', 'Second'].map((displayName) =>
        store.updateDefinition(
          alice,
          hero.id,
          { ...definitionInput(hero), displayName },
          hero.versionId,
          1,
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const current = (await store.listDefinitions(alice)).find((item) => item.id === hero.id)!;
    await Promise.all([
      store.updateDefinition(
        alice,
        hero.id,
        { ...definitionInput(current), displayName: 'Combined hero' },
        current.versionId,
        1,
      ),
      store.updateDefinition(
        alice,
        footer.id,
        { ...definitionInput(footer), displayName: 'Combined footer' },
        footer.versionId,
        1,
      ),
    ]);
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    expect(active.definitions.map((item) => item.displayName)).toEqual(
      expect.arrayContaining(['Combined hero', 'Combined footer']),
    );
  });

  it('migrates live content separately from drafts, preserves renames and history, and retries deployment safely', async () => {
    const key = await store.createDeliveryToken(alice, { name: 'Production', scope: 'published' });
    const original = snapshot.checkpointId!;
    await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: original },
    });
    const hero = blockNamed(snapshot, 'hero');
    const saved = await save(alice, snapshot, hero, { ...hero.fields, title: 'Unpublished title' });
    const definition = snapshot.definitions.find((item) => item.id === hero.definitionId)!;
    await store.updateDefinition(
      alice,
      definition.id,
      {
        ...definitionInput(definition),
        fields: definition.fields
          .filter((field) => field.name !== 'description')
          .map((field) => (field.name === 'title' ? { ...field, name: 'headline' } : field)),
      },
      definition.versionId,
      1,
    );
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)).blocks.find(
        (item) => item.id === hero.id,
      )?.fields.title,
    ).toBe('Unpublished title');
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const review = await store.reviewMigration(alice, active.id);
    expect(review.blockers).toEqual([]);
    expect(review.impacts.reduce((sum, item) => sum + item.deletedValues, 0)).toBe(2);
    await expect(store.deployMigration(bob, active.id, review.token)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(store.deployMigration(alice, active.id, review.token)).rejects.toThrow(
      'explicit confirmation',
    );
    const deployment = await store.deployMigration(alice, active.id, review.token, {
      confirmation: review.confirmation!,
    });
    expect(await store.deployMigration(alice, active.id, review.token)).toEqual(deployment);
    const current = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(blockNamed(current, 'hero').fields).toMatchObject({ headline: 'Unpublished title' });
    expect(blockNamed(current, 'hero').fields).not.toHaveProperty('description');
    const delivered = await store.publishedStories(key.token, alice.spaceId, {});
    expect(delivered.migrationVersion).toBe(2);
    expect(delivered.stories[0]!.content).toHaveProperty('body.0.headline', hero.fields.title);
    expect(delivered.stories[0]!.content).not.toHaveProperty('body.0.title');
    expect(
      (
        await store.getCheckpoint(alice, snapshot.story.id, snapshot.locale.id, original)
      ).snapshot.blocks.find((item) => item.id === hero.id)?.fields,
    ).toEqual(hero.fields);
    await expect(
      run(alice, current, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: original },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const own = await lease(alice, current, blockNamed(current, 'hero'));
    const restored = await run(alice, current, {
      ...commandBase({ block: blockNamed(current, 'hero'), lease: own }),
      type: 'restoreBlock',
      payload: { blockId: hero.id, checkpointId: original },
    });
    expect(blockNamed(restored.snapshot, 'hero').fields).toEqual({ headline: hero.fields.title });
    await expect(
      run(alice, current, {
        ...commandBase(),
        migrationVersion: 1,
        type: 'publishCheckpoint',
        payload: { checkpointId: saved.checkpointId },
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
  });
  it('rejects stale schema saves and reviews, and leaves invalid deployments unapplied', async () => {
    await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const definition = snapshot.definitions.find((item) => item.name === 'hero')!;
    const revised = await store.updateDefinition(
      alice,
      definition.id,
      { ...definitionInput(definition), displayName: 'Updated hero' },
      definition.versionId,
      1,
    );
    await expect(
      store.updateDefinition(
        alice,
        definition.id,
        definitionInput(definition),
        definition.versionId,
        1,
      ),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const review = await store.reviewMigration(alice, active.id);
    const state = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    await save(alice, state, blockNamed(state, 'footer'), { text: 'A concurrent edit' });
    await expect(store.deployMigration(alice, active.id, review.token)).rejects.toMatchObject({
      code: 'stale_revision',
    });
    await store.updateDefinition(
      alice,
      definition.id,
      {
        ...definitionInput(revised),
        fields: revised.fields.map((field) =>
          field.name === 'title'
            ? { id: field.id, name: 'title', label: 'Title', type: 'number', required: true }
            : field,
        ),
      },
      revised.versionId,
      1,
    );
    const invalid = await store.reviewMigration(alice, active.id);
    expect(invalid.blockers.some((issue) => issue.message === 'Required')).toBe(true);
    await expect(store.deployMigration(alice, active.id, invalid.token)).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(
      (await store.listMigrations(alice)).find((item) => item.status === 'deployed')?.version,
    ).toBe(1);
    expect(
      blockNamed(await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id), 'hero')
        .schemaVersionId,
    ).toBe(definition.versionId);
  });
  it('links every invalid block and requires fresh, explicit admin approval before pruning drafts and publications', async () => {
    const original = snapshot.checkpointId!,
      hero = blockNamed(snapshot, 'hero'),
      footer = blockNamed(snapshot, 'footer');
    await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: original },
    });
    const definition = snapshot.definitions.find((item) => item.name === 'page')!;
    await store.updateDefinition(alice, definition.id, {
      ...definitionInput(definition),
      fields: definition.fields.map((field) =>
        field.type === 'blocks' ? { ...field, allowedDefinitionIds: [footer.definitionId] } : field,
      ),
    });
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const standard = await store.reviewMigration(alice, active.id);
    expect(standard.blockers).toHaveLength(2);
    for (const issue of standard.blockers)
      expect(issue).toMatchObject({
        storyId: snapshot.story.id,
        storyName: 'Home',
        localeSlug: '',
        blockId: hero.id,
        blockName: 'Hero',
      });
    expect(standard.blockers.map((issue) => issue.target)).toEqual(['draft', 'published']);
    const destructive = await store.reviewMigration(alice, active.id, true);
    expect(destructive.blockers).toEqual([]);
    expect(destructive.impacts.map((item) => item.deletedBlocks)).toEqual([1, 1]);
    expect(destructive.confirmation).toBe('DEPLOY 2');
    await expect(
      store.deployMigration(bob, active.id, destructive.token, {
        destructive: true,
        confirmation: 'DEPLOY 2',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.deployMigration(alice, active.id, standard.token, {
        destructive: true,
        confirmation: 'DEPLOY 2',
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    await expect(
      store.deployMigration(alice, active.id, destructive.token, { destructive: true }),
    ).rejects.toThrow('explicit confirmation');
    await expect(
      store.deployMigration(alice, active.id, destructive.token, {
        destructive: true,
        confirmation: 'DEPLOY 1',
      }),
    ).rejects.toThrow('explicit confirmation');
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)).blocks,
    ).toHaveLength(3);
    const edited = await save(
      alice,
      await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id),
      footer,
      { text: 'Unpublished footer' },
    );
    await expect(
      store.deployMigration(alice, active.id, destructive.token, {
        destructive: true,
        confirmation: 'DEPLOY 2',
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    const fresh = await store.reviewMigration(alice, active.id, true);
    const deployed = await store.deployMigration(alice, active.id, fresh.token, {
      destructive: true,
      confirmation: 'DEPLOY 2',
    });
    expect(deployed.destructive).toBe(true);
    const current = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(current.blocks.map((block) => block.id)).toEqual(
      expect.arrayContaining([snapshot.locale.rootBlockId, footer.id]),
    );
    expect(current.blocks).toHaveLength(2);
    expect(blockNamed(current, 'footer').fields.text).toBe('Unpublished footer');
    const key = await store.createDeliveryToken(alice, { name: 'Production', scope: 'published' });
    const delivered = await store.publishedStories(key.token, alice.spaceId, {});
    expect(delivered.stories[0]!.content).toMatchObject({ body: [{ text: footer.fields.text }] });
    expect(
      (await store.getCheckpoint(alice, snapshot.story.id, snapshot.locale.id, original)).snapshot
        .blocks,
    ).toHaveLength(3);
    const root = blockNamed(current, 'page'),
      own = await lease(alice, current, root);
    const restored = await run(alice, current, {
      ...commandBase({ block: root, lease: own }),
      expectedRevisions: { [root.id]: root.revision, $locale: current.revision },
      type: 'restorePage',
      payload: { checkpointId: original },
    });
    expect(restored.snapshot.blocks).toHaveLength(2);
    expect(restored.snapshot.blocks.some((block) => block.id === hero.id)).toBe(false);
    expect(edited.snapshot.migrationVersion).toBe(1);
  });
  it('does not let destructive deployment bypass required content or invalid root schemas', async () => {
    await run(alice, snapshot, {
      ...commandBase(),
      type: 'publishCheckpoint',
      payload: { checkpointId: snapshot.checkpointId! },
    });
    const page = snapshot.definitions.find((item) => item.name === 'page')!;
    await store.updateDefinition(alice, page.id, {
      ...definitionInput(page),
      kind: 'nestable',
      fields: [
        ...page.fields,
        { name: 'required', label: 'Required', type: 'text', format: 'singleline', required: true },
      ],
    });
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const review = await store.reviewMigration(alice, active.id, true);
    expect(
      review.blockers.some(
        (issue) => issue.blockId === snapshot.locale.rootBlockId && issue.field === 'required',
      ),
    ).toBe(true);
    expect(review.blockers.some((issue) => issue.message.includes('root must'))).toBe(true);
    await expect(
      store.deployMigration(alice, active.id, review.token, {
        destructive: true,
        confirmation: 'DEPLOY 2',
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(
      (await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)).migrationVersion,
    ).toBe(1);
  });
  it('links restricted asset fields and resets their references only in destructive mode', async () => {
    const hero = blockNamed(snapshot, 'hero'),
      assetId = randomUUID();
    await pool.query(
      "INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title) VALUES($1::uuid,$2,$1::text,'fixture','application/pdf',10,'Fixture')",
      [assetId, alice.spaceId],
    );
    await save(alice, snapshot, hero, { ...hero.fields, image: { assetId } });
    const definition = snapshot.definitions.find((item) => item.id === hero.definitionId)!;
    await store.updateDefinition(alice, definition.id, {
      ...definitionInput(definition),
      fields: definition.fields.map((field) =>
        field.type === 'asset' ? { ...field, mimeTypes: ['image/*'] } : field,
      ),
    });
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const standard = await store.reviewMigration(alice, active.id);
    expect(standard.blockers).toEqual([
      expect.objectContaining({
        blockId: hero.id,
        field: 'image',
        message: 'Image does not allow this asset type',
      }),
    ]);
    const destructive = await store.reviewMigration(alice, active.id, true);
    expect(destructive.blockers).toEqual([]);
    expect(destructive.impacts[0]!.resetValues).toBe(1);
    await store.deployMigration(alice, active.id, destructive.token, {
      destructive: true,
      confirmation: destructive.confirmation!,
    });
    expect(
      blockNamed(await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id), 'hero')
        .fields,
    ).not.toHaveProperty('image');
    expect((await pool.query('SELECT id FROM assets WHERE id=$1', [assetId])).rowCount).toBe(1);
  });
  it('stages CLI migrations atomically and enforces management token capabilities and revocation', async () => {
    const token = await store.createManagementToken(alice, { name: 'CI', capability: 'stage' });
    const actor = await store.authenticateManagement(token.token, alice.spaceId);
    const deployed = (await store.listMigrations(actor)).at(-1)!;
    const definition = deployed.definitions.find((item) => item.name === 'hero')!;
    const file = {
      formatVersion: 1,
      id: randomUUID(),
      spaceId: alice.spaceId,
      version: 2,
      baseVersion: 1,
      name: 'CI migration',
      status: 'active',
      remoteRevision: null,
      sourceHash: null,
      definitions: deployed.definitions.map((item) => ({
        id: item.id,
        schema: {
          ...definitionInput(item),
          ...(item.id === definition.id ? { displayName: 'CI hero' } : {}),
        },
      })),
    };
    const staged = await store.pushMigration(actor, file);
    expect(await store.pushMigration(actor, file)).toEqual(staged);
    const review = await store.reviewMigration(actor, staged.id);
    await expect(store.deployMigration(actor, staged.id, review.token)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await store.updateDefinition(alice, definition.id, {
      ...definitionInput(staged.definitions.find((item) => item.id === definition.id)!),
      displayName: 'Another editor',
    });
    await expect(
      store.pushMigration(actor, { ...file, name: 'Conflict', remoteRevision: staged.revision }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    await store.revokeManagementToken(alice, token.id);
    await expect(store.listMigrations(actor)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(store.authenticateManagement(token.token, alice.spaceId)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it('rolls back every content change when deployment fails midway', async () => {
    const definition = snapshot.definitions.find((item) => item.name === 'hero')!;
    await store.updateDefinition(alice, definition.id, {
      ...definitionInput(definition),
      displayName: 'Rollback test',
    });
    const active = (await store.listMigrations(alice)).find((item) => item.status === 'active')!;
    const review = await store.reviewMigration(alice, active.id);
    await pool.query(
      `CREATE FUNCTION fail_migration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason LIKE 'Migration %' THEN RAISE EXCEPTION 'Injected deployment failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      'CREATE TRIGGER fail_migration BEFORE INSERT ON checkpoints FOR EACH ROW EXECUTE FUNCTION fail_migration()',
    );
    try {
      await expect(store.deployMigration(alice, active.id, review.token)).rejects.toThrow(
        'Injected deployment failure',
      );
      const current = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
      expect(current.revision).toBe(snapshot.revision);
      expect(current.migrationVersion).toBe(1);
      expect(blockNamed(current, 'hero').schemaVersionId).toBe(definition.versionId);
    } finally {
      await pool.query('DROP TRIGGER fail_migration ON checkpoints');
      await pool.query('DROP FUNCTION fail_migration()');
    }
  });
});

describe('scoped content permissions', () => {
  async function restrict(
    scopes: ReturnType<typeof contentScopesSchema.parse>,
    permissions = [
      'content:read',
      'content:edit',
      'content:publish',
      'settings:write',
      'schemas:write',
    ],
  ) {
    await store.saveSpaceRole(alice, {
      name: 'Scoped contributor',
      permissions,
      contentScopes: scopes,
    });
    const role = (await store.listSpaceRoles(alice)).find(
      (role) => role.name === 'Scoped contributor',
    )!;
    await store.updateSpaceMember(alice, bob.userId, { role: role.id });
    return role;
  }
  it('redacts current and historical fields, preserves hidden values on save and rejects whole-page actions', async () => {
    const hero = blockNamed(snapshot, 'hero');
    const title = snapshot.definitions
      .find((d) => d.id === hero.definitionId)!
      .fields.find((f) => f.name === 'title')!;
    const scopes = contentScopesSchema.parse({});
    scopes.read.fieldIds = [title.id!];
    scopes.edit.fieldIds = [title.id!];
    await restrict(scopes);
    const visible = await store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id);
    expect(blockNamed(visible, 'hero').fields).toEqual({ title: hero.fields.title });
    expect(visible.access).toMatchObject({ complete: false, preview: false, publish: false });
    const history = await store.getCheckpoint(
      bob,
      snapshot.story.id,
      snapshot.locale.id,
      snapshot.checkpointId!,
    );
    expect(JSON.stringify(history)).not.toContain('Your next story starts here.');
    expect(history.actorId).toBe('');
    expect(
      (await store.listCheckpoints(bob, snapshot.story.id, snapshot.locale.id)).every(
        (item) => item.actorId === '',
      ),
    ).toBe(true);
    expect(JSON.stringify(await store.listDefinitions(bob))).not.toContain(
      'Your next story starts here.',
    );
    const saved = await save(bob, visible, blockNamed(visible, 'hero'), { title: 'Allowed edit' });
    expect(blockNamed(saved.snapshot, 'hero').fields).toEqual({ title: 'Allowed edit' });
    const full = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id);
    expect(blockNamed(full, 'hero').fields.description).toBe(hero.fields.description);
    await expect(
      save(bob, saved.snapshot, blockNamed(saved.snapshot, 'hero'), {
        title: 'Allowed edit',
        description: 'Forbidden edit',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(bob, saved.snapshot, {
        ...commandBase(),
        type: 'publishCheckpoint',
        payload: { checkpointId: saved.checkpointId },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.createEditorPreview(bob, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      store.createDeliveryToken(bob, { name: 'Escalation', scope: 'preview' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(store.listMigrations(bob)).rejects.toMatchObject({ code: 'forbidden' });
    expect(() => createBlockClipboard(visible, bob.spaceId, hero.id)).toThrow('every field');
  });
  it('filters story lists and direct access, and prevents moving a story outside the edit scope', async () => {
    const folder = await store.saveFolder(alice, { name: 'Allowed', slug: 'allowed' });
    const other = await store.saveFolder(alice, { name: 'Private', slug: 'private' });
    await store.updateStoryLocation(alice, snapshot.story.id, {
      folderId: folder.id,
      slug: 'home',
    });
    const scopes = contentScopesSchema.parse({});
    scopes.read.locations = { folderIds: [folder.id], storyIds: [] };
    scopes.edit.locations = { folderIds: [folder.id], storyIds: [] };
    await restrict(scopes);
    expect((await store.listStories(bob)).map((story) => story.id)).toContain(snapshot.story.id);
    expect((await store.listFolders(bob)).map((item) => item.id)).not.toContain(other.id);
    await expect(
      store.updateStoryLocation(bob, snapshot.story.id, { folderId: other.id, slug: 'home' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await store.updateStoryLocation(alice, snapshot.story.id, { folderId: other.id, slug: 'home' });
    expect(await store.listStories(bob)).toEqual([]);
    await expect(
      store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (await store.listSpaces(bob)).find((space) => space.id === bob.spaceId)?.storyCount,
    ).toBe(0);
  });
  it('combines locale and location scopes and preserves hidden references during permitted saves', async () => {
    const french = await store.createSpaceLocale(alice, { name: 'French', slug: 'fr' });
    const translated = await store.createLocale(alice, snapshot.story.id, {
      spaceLocaleId: french.id,
    });
    const scopes = contentScopesSchema.parse({});
    scopes.read.localeIds = [french.id];
    scopes.edit.localeIds = [french.id];
    const role = await restrict(scopes);
    expect((await store.listLocales(bob, snapshot.story.id)).map((locale) => locale.id)).toEqual([
      translated.locale.id,
    ]);
    await expect(
      store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    const fullScopes = contentScopesSchema.parse({});
    fullScopes.read.locations = { folderIds: [], storyIds: [snapshot.story.id] };
    await store.saveSpaceRole(
      alice,
      { name: role.name, permissions: role.permissions, contentScopes: fullScopes },
      role.id,
    );
    const target = await store.createStory(alice, {
      name: 'Private target',
      slug: 'private-target',
      definitionId: snapshot.blocks.find((block) => block.id === snapshot.locale.rootBlockId)!
        .definitionId,
    });
    const footer = blockNamed(snapshot, 'footer');
    const saved = await save(alice, snapshot, footer, {
      ...footer.fields,
      link: { type: 'story', storyId: target.story.id },
    });
    await store.releaseLease(
      alice,
      snapshot.story.id,
      snapshot.locale.id,
      footer.id,
      (await lease(alice, saved.snapshot, blockNamed(saved.snapshot, 'footer'))).token!,
    );
    const visible = await store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id);
    expect(blockNamed(visible, 'footer').fields.link).toBeUndefined();
    expect(visible.access?.preview).toBe(false);
    expect(
      (await store.resolveOptions(bob, { source: { type: 'stories' }, values: [target.story.id] }))
        .items,
    ).toEqual([]);
    const result = await save(bob, visible, blockNamed(visible, 'footer'), { text: 'New footer' });
    expect(blockNamed(result.snapshot, 'footer').fields).toEqual({ text: 'New footer' });
    expect(
      blockNamed(await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id), 'footer')
        .fields.link,
    ).toEqual({ type: 'story', storyId: target.story.id });
    await expect(
      store.createEditorPreview(bob, snapshot.story.id, snapshot.locale.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('denies empty read grants, rejects foreign targets and rechecks leases after a role change', async () => {
    const hero = blockNamed(snapshot, 'hero');
    const held = await lease(bob, snapshot, hero);
    const scopes = contentScopesSchema.parse({});
    scopes.read.fieldIds = [];
    const role = await restrict(scopes);
    expect(await store.listStories(bob)).toEqual([]);
    expect(await store.listDefinitions(bob)).toEqual([]);
    await expect(
      store.renewLease(bob, snapshot.story.id, snapshot.locale.id, hero.id, held.token!),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      store.saveSpaceRole(alice, {
        name: 'Invalid scope',
        permissions: ['content:read'],
        contentScopes: { ...scopes, read: { ...scopes.read, fieldIds: [randomUUID()] } },
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await store.saveSpaceRole(
      alice,
      {
        name: role.name,
        permissions: ['content:read'],
        contentScopes: contentScopesSchema.parse({}),
      },
      role.id,
    );
    expect(
      (await store.getSnapshot(bob, snapshot.story.id, snapshot.locale.id)).access?.complete,
    ).toBe(true);
    await expect(save(bob, snapshot, hero, hero.fields)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

it('backfills legacy custom roles without adding edit or publish authority', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const isolated = `role_upgrade_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA ${isolated}`);
    await client.query(`SET LOCAL search_path TO ${isolated},public`);
    await client.query('CREATE TABLE spaces(id uuid PRIMARY KEY)');
    await client.query(
      "CREATE TABLE memberships(space_id uuid,role text CONSTRAINT memberships_role_check CHECK(role IN ('admin','editor','viewer')))",
    );
    await client.query(
      "CREATE TABLE space_invitations(space_id uuid,role text CONSTRAINT space_invitations_role_check CHECK(role IN ('admin','editor','viewer')))",
    );
    await client.query(
      await readFile(new URL('../migrations/008_space_roles.sql', import.meta.url), 'utf8'),
    );
    const spaceId = randomUUID();
    await client.query('INSERT INTO spaces(id) VALUES($1)', [spaceId]);
    await client.query(
      "INSERT INTO space_roles(space_id,id,name,permissions) VALUES($1,'custom-reader','Reader','{}'),($1,'custom-copy','Copy editor',ARRAY['content:edit','datasources:write']),($1,'custom-publisher','Publisher',ARRAY['content:publish'])",
      [spaceId],
    );
    const before = (await client.query('SELECT id,permissions FROM space_roles')).rows;
    await client.query(
      await readFile(new URL('../migrations/019_content_scopes.sql', import.meta.url), 'utf8'),
    );
    for (const role of (await client.query('SELECT id,permissions,content_scopes FROM space_roles'))
      .rows) {
      expect(role.permissions).toEqual([
        'content:read',
        ...before.find((previous) => previous.id === role.id)!.permissions,
      ]);
      expect(role.content_scopes).toEqual(contentScopesSchema.parse({}));
    }
    const created = randomUUID();
    await client.query('INSERT INTO spaces(id) VALUES($1)', [created]);
    expect(
      (
        await client.query(
          "SELECT permissions FROM space_roles WHERE space_id=$1 AND id='viewer'",
          [created],
        )
      ).rows[0].permissions,
    ).toEqual(['content:read']);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
