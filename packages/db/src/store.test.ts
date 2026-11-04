import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BlokStore } from './store.js'
import { migrate } from './migrate.js'
import type { Actor, BlockDraft, Command, Lease, LocaleSnapshot } from '@blok/core'

const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok_test'
const target = new URL(databaseUrl)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/blok_test') throw new Error('Integration tests require the disposable local blok_test database')
const schemaName = `data_test_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString: databaseUrl })
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName},public`, max: 8 })
const store = new BlokStore(pool)
let alice: Actor
let bob: Actor
let snapshot: LocaleSnapshot
const legacyLocaleId = randomUUID()
const blockNamed = (state: LocaleSnapshot, name: string) => state.blocks.find(block => state.definitions.find(d => d.versionId === block.schemaVersionId)?.name === name)!
const commandBase = (...entries: { block: BlockDraft; lease: Lease }[]) => ({ mutationId: randomUUID(), expectedRevisions: Object.fromEntries(entries.map(({ block }) => [block.id, block.revision])), leaseTokens: Object.fromEntries(entries.map(({ block, lease }) => [block.id, lease.token!])) })
const lease = (actor: Actor, state: LocaleSnapshot, block: BlockDraft) => store.acquireLease(actor, state.story.id, state.locale.id, block.id)
const run = (actor: Actor, state: LocaleSnapshot, command: Command) => store.command(actor, state.story.id, state.locale.id, command)
async function save(actor: Actor, state: LocaleSnapshot, block: BlockDraft, fields: BlockDraft['fields']) {
  const ownLease = await lease(actor, state, block)
  return run(actor, state, { ...commandBase({ block, lease: ownLease }), type: 'saveBlock', payload: { blockId: block.id, fields } })
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schemaName}`)
  await pool.query('CREATE TABLE "session" (id text PRIMARY KEY,"userId" text NOT NULL,"expiresAt" timestamptz NOT NULL)')
  await pool.query('CREATE TABLE "user" (id text PRIMARY KEY,name text NOT NULL,email text NOT NULL)')
  await pool.query(`INSERT INTO "user" VALUES('alice','Alice','alice@test.local'),('bob','Bob','bob@test.local')`)
  await pool.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'))
  const legacySpace = await pool.query("INSERT INTO spaces(name) VALUES('Before upgrade') RETURNING id")
  const legacyStory = await pool.query("INSERT INTO stories(space_id,name,slug) VALUES($1,'Legacy','legacy') RETURNING id", [legacySpace.rows[0].id])
  await pool.query("INSERT INTO story_locales(id,story_id,slug,name,url_slug,root_block_id) VALUES($1,$2,'fr','French','bonjour',$3)", [legacyLocaleId,legacyStory.rows[0].id,randomUUID()])
  await migrate(pool)
  await migrate(pool)
  await pool.query(`INSERT INTO "session" VALUES('alice-session','alice',now()+interval '1 hour'),('bob-session','bob',now()+interval '1 hour')`)
})
beforeEach(async () => {
  const spaceId = randomUUID()
  alice = { userId: 'alice', sessionId: 'alice-session', spaceId, role: 'admin' }
  bob = { userId: 'bob', sessionId: 'bob-session', spaceId, role: 'editor' }
  await store.seed(alice)
  await pool.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,'bob','editor')", [spaceId])
  const story = (await store.listStories(alice))[0]
  const locale = (await store.listLocales(alice, story.id))[0]
  snapshot = await store.getSnapshot(alice, story.id, locale.id)
})
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schemaName} CASCADE`); await admin.end() })

describe('Postgres collaboration and immutable history', () => {
  it('backfills existing story locales without changing their IDs or page slugs', async () => {
    const { rows } = await pool.query('SELECT l.id,l.slug,l.url_slug,c.name,c.slug AS configured_slug FROM story_locales l JOIN space_locales c ON c.id=l.space_locale_id WHERE l.id=$1',[legacyLocaleId])
    expect(rows).toEqual([{ id:legacyLocaleId,slug:'fr',url_slug:'bonjour',name:'French',configured_slug:'fr' }])
    expect((await store.listSpaceLocales(alice)).map(item => ({ name:item.name,slug:item.slug }))).toEqual([{ name:'Default',slug:'' }])
  })
  it('manages locale configuration centrally while preserving content, history, and publication on rename', async () => {
    const configured = await store.createSpaceLocale(alice,{ name:'French',slug:'fr' })
    await expect(store.createSpaceLocale(bob,{ name:'German',slug:'de' })).rejects.toMatchObject({ code:'forbidden' })
    await expect(store.updateSpaceLocale(bob,configured.id,{ name:'French',slug:'fr-CA' })).rejects.toMatchObject({ code:'forbidden' })
    await expect(store.deleteSpaceLocale(bob,configured.id)).rejects.toMatchObject({ code:'forbidden' })
    await expect(store.createSpaceLocale(alice,{ name:'Duplicate',slug:'fr' })).rejects.toMatchObject({ code:'invalid' })
    await expect(store.createLocale(alice,snapshot.story.id,{ name:'Unconfigured',slug:'de' })).rejects.toMatchObject({ code:'invalid' })
    const other = await store.createSpace(alice,{ name:'Other space' })
    const foreign = await store.createSpaceLocale({ ...alice,spaceId:other.id },{ name:'Spanish',slug:'es' })
    await expect(store.createLocale(alice,snapshot.story.id,{ spaceLocaleId:foreign.id })).rejects.toMatchObject({ code:'not_found' })
    await expect(store.updateSpaceLocale(alice,foreign.id,{ name:'Stolen',slug:'es-MX' })).rejects.toMatchObject({ code:'not_found' })
    const [french,retry] = await Promise.all([store.createLocale(alice,snapshot.story.id,{ spaceLocaleId:configured.id }),store.createLocale(bob,snapshot.story.id,{ spaceLocaleId:configured.id })])
    expect(retry.locale.id).toBe(french.locale.id)
    expect(french.blocks).toHaveLength(1)
    expect(await store.listCheckpoints(alice,snapshot.story.id,french.locale.id)).toHaveLength(1)
    await run(alice,french,{ ...commandBase(),type:'publishCheckpoint',payload:{ checkpointId:french.checkpointId! } })
    const before = await store.getSnapshot(alice,snapshot.story.id,french.locale.id)
    const renamed = await store.updateSpaceLocale(alice,configured.id,{ name:'French (Canada)',slug:'fr-CA' })
    expect(renamed).toMatchObject({ id:configured.id,storyCount:1 })
    const after = await store.getSnapshot(alice,snapshot.story.id,french.locale.id)
    expect(after.blocks).toEqual(before.blocks)
    expect(after.locale).toEqual({ ...before.locale,name:'French (Canada)',slug:'fr-CA' })
    expect((await store.getCheckpoint(alice,snapshot.story.id,french.locale.id,french.checkpointId!)).snapshot.locale.slug).toBe('fr')
    const token = await store.createDeliveryToken(alice,{ name:'Site',scope:'published' })
    expect((await store.deliveryLocales(token.token,alice.spaceId)).map(locale => locale.slug)).toEqual(['','fr-CA'])
    expect((await store.publishedStories(token.token,alice.spaceId,{ locale:'fr' })).stories).toEqual([])
    expect((await store.publishedStories(token.token,alice.spaceId,{ locale:'fr-CA' })).stories).toHaveLength(1)
    const defaultLocale = (await store.listSpaceLocales(alice)).find(locale => locale.slug === '')!
    await expect(store.updateSpaceLocale(alice,defaultLocale.id,{ name:'English',slug:'en' })).rejects.toMatchObject({ code:'invalid' })
    await expect(store.deleteSpaceLocale(alice,defaultLocale.id)).rejects.toMatchObject({ code:'invalid' })
    await expect(store.deleteSpaceLocale(alice,configured.id)).rejects.toMatchObject({ code:'invalid' })
    const unused = await store.createSpaceLocale(alice,{ name:'German',slug:'de' })
    await store.deleteSpaceLocale(alice,unused.id)
    expect((await store.listSpaceLocales(alice)).map(locale => locale.id)).not.toContain(unused.id)
  })
  it('exports only current schema metadata through a scoped preview key', async () => {
    const published = await store.createDeliveryToken(alice,{ name:'Website',scope:'published' })
    const preview = await store.createDeliveryToken(alice,{ name:'Tooling',scope:'preview' })
    await expect(store.deliverySchema(published.token,alice.spaceId)).rejects.toMatchObject({ code:'unauthenticated' })
    await expect(store.deliverySchema(preview.token,randomUUID())).rejects.toMatchObject({ code:'unauthenticated' })
    const before = await store.deliverySchema(preview.token,alice.spaceId)
    expect(before.components.map(item => item.name)).toEqual(['footer','hero','page'])
    expect(JSON.stringify(before)).not.toContain('defaultValue')
    expect(JSON.stringify(before)).not.toContain('Build something worth sharing.')
    const hero = (await store.listDefinitions(alice)).find(item => item.name === 'hero')!
    await store.updateDefinition(alice,hero.id,{ name:hero.name,displayName:hero.displayName,kind:hero.kind,fields:[...hero.fields,{ name:'style',label:'Style',type:'option',source:{ type:'inline',items:[{ value:'dark',label:'Dark' }] } }] })
    const after = await store.deliverySchema(preview.token,alice.spaceId)
    expect(after.components.find(item => item.name === 'hero')).toMatchObject({ version:2,fields:expect.arrayContaining([{ name:'style',type:'option',required:false,options:['dark'] }]) })
    await store.revokeDeliveryToken(alice,preview.id)
    await expect(store.deliverySchema(preview.token,alice.spaceId)).rejects.toMatchObject({ code:'unauthenticated' })
  })
  it('delivers only publication snapshots, scoped by space and locale, and honors token revocation', async () => {
    const key = await store.createDeliveryToken(alice,{ name:'Website',scope:'published' })
    expect((await store.publishedStories(key.token,alice.spaceId,{})).stories).toEqual([])
    const checkpoint = snapshot.checkpointId!
    const changed = await save(alice,snapshot,blockNamed(snapshot,'hero'),{ title:'Draft only' })
    await run(alice,changed.snapshot,{ ...commandBase(),type:'publishCheckpoint',payload:{ checkpointId:checkpoint } })
    const { stories } = await store.publishedStories(key.token,alice.spaceId,{ slug:'home' })
    expect(JSON.stringify(stories)).toContain('Build something worth sharing.')
    expect(JSON.stringify(stories)).not.toContain('Draft only')
    expect((await store.publishedStories(key.token,alice.spaceId,{ locale:'fr' })).stories).toEqual([])
    expect(JSON.stringify(await store.listDeliveryTokens(alice))).not.toContain(key.token)
    await expect(store.publishedStories(key.token,randomUUID(),{})).rejects.toMatchObject({ code:'unauthenticated' })
    await expect(store.createTokenPreview(key.token,alice.spaceId,{ slug:'home' })).rejects.toMatchObject({ code:'unauthenticated' })
    await expect(store.createDeliveryToken(bob,{ name:'No',scope:'preview' })).rejects.toMatchObject({ code:'forbidden' })
    await store.revokeDeliveryToken(alice,key.id)
    await expect(store.publishedStories(key.token,alice.spaceId,{})).rejects.toMatchObject({ code:'unauthenticated' })
  })
  it('binds read-only preview sessions to their origin, locale, expiry, and current authorization', async () => {
    await store.updateDeliverySettings(alice,{ previewUrl:'http://localhost:3131/{locale}/{slug}',previewParameter:'review' })
    const session = await store.createEditorPreview(bob,snapshot.story.id,snapshot.locale.id)
    await expect(store.authenticatePreview(session.token,'https://evil.test')).rejects.toMatchObject({ code:'unauthenticated' })
    const connection = await store.authenticatePreview(session.token,'http://localhost:3131')
    expect(connection).toMatchObject({ spaceId:alice.spaceId,storyId:snapshot.story.id,localeId:snapshot.locale.id })
    const draft = await save(alice,snapshot,blockNamed(snapshot,'hero'),{ title:'Live draft' })
    expect(JSON.stringify(await store.previewStory(connection.id))).toContain('Live draft')
    expect(JSON.stringify(await store.previewStory(connection.id))).not.toContain('sessionId')
    await pool.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2',[bob.spaceId,bob.userId])
    await expect(store.previewStory(connection.id)).rejects.toMatchObject({ code:'unauthenticated' })
    const key = await store.createDeliveryToken(alice,{ name:'Server preview',scope:'preview' })
    const tokenSession = await store.createTokenPreview(key.token,alice.spaceId,{ slug:'home' })
    const tokenConnection = await store.authenticatePreview(tokenSession.token,'http://localhost:3131')
    expect((await store.previewStory(tokenConnection.id)).revision).toBe(draft.snapshot.revision)
    await pool.query("UPDATE preview_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[tokenConnection.id])
    await expect(store.previewStory(tokenConnection.id)).rejects.toMatchObject({ code:'unauthenticated' })
    const renewed = await store.createTokenPreview(key.token,alice.spaceId,{ slug:'home' })
    const renewedConnection = await store.authenticatePreview(renewed.token,'http://localhost:3131')
    await store.revokeDeliveryToken(alice,key.id)
    await expect(store.previewStory(renewedConnection.id)).rejects.toMatchObject({ code:'unauthenticated' })
  })
  it('upgrades existing spaces and creates isolated spaces with atomic admin ownership', async () => {
    expect((await pool.query("SELECT description FROM spaces WHERE name='Before upgrade'")).rows).toEqual([{ description:'' }])
    const created = await store.createSpace(bob, { name:'  Brand website  ', description:'Independent project' })
    expect(created).toMatchObject({ name:'Brand website', role:'admin', storyCount:0, memberCount:1 })
    expect((await store.listSpaces(bob)).map(space => space.id)).toContain(created.id)
    expect((await store.listSpaces(alice)).map(space => space.id)).not.toContain(created.id)
    expect(await store.listStories({ ...bob, spaceId:created.id })).toEqual([])
    await expect(store.listStories({ ...alice, spaceId:created.id })).rejects.toMatchObject({ code:'forbidden' })
    await expect(store.createSpace({ ...alice, sessionId:'expired' }, { name:'Invalid' })).rejects.toMatchObject({ code:'unauthenticated' })
    await expect(store.createSpace(alice, { name:'  ' })).rejects.toMatchObject({ code:'invalid' })
  })
  it('shows only space members and checks stored admin permissions when updating settings', async () => {
    const details = await store.getSpace(bob)
    expect(details.members.map(member => member.id)).toEqual(['alice','bob'])
    await expect(store.updateSpace({ ...bob, role:'admin' }, { name:'Unauthorized' })).rejects.toMatchObject({ code:'forbidden' })
    await expect(store.updateSpace(alice, { name:'Updated', description:'x'.repeat(1001) })).rejects.toMatchObject({ code:'invalid' })
    const updated = await store.updateSpace(alice, { name:'Updated', description:'Shared project' })
    expect(updated).toMatchObject({ name:'Updated', description:'Shared project', storyCount:1, memberCount:2 })
    expect((await store.getSpace(bob)).name).toBe('Updated')
    await expect(store.getSpace({ ...alice, spaceId:randomUUID() })).rejects.toMatchObject({ code:'forbidden' })
  })
  it('allows simultaneous edits on different bloks without page-level revision conflicts', async () => {
    const hero = blockNamed(snapshot, 'hero'); const footer = blockNamed(snapshot, 'footer')
    const heroLease = await lease(alice, snapshot, hero); const footerLease = await lease(bob, snapshot, footer)
    await expect(lease(bob, snapshot, hero)).rejects.toMatchObject({ code: 'locked' })
    const results = await Promise.all([
      run(alice, snapshot, { ...commandBase({ block: hero, lease: heroLease }), type: 'saveBlock', payload: { blockId: hero.id, fields: { ...hero.fields, title: 'Alice hero' } } }),
      run(bob, snapshot, { ...commandBase({ block: footer, lease: footerLease }), type: 'saveBlock', payload: { blockId: footer.id, fields: { ...footer.fields, text: 'Bob footer' } } }),
    ])
    expect(results.map(r => r.localeRevision).sort()).toEqual([snapshot.revision + 1, snapshot.revision + 2])
    const latest = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)
    expect(blockNamed(latest, 'hero').fields.title).toBe('Alice hero')
    expect(blockNamed(latest, 'footer').fields.text).toBe('Bob footer')
    expect(latest.leases.find(l => l.userId === 'bob')?.token).toBeUndefined()
  })
  it('fences expired tokens and rejects stale content after another editor saves', async () => {
    const hero = blockNamed(snapshot, 'hero'); const old = await lease(alice, snapshot, hero)
    await pool.query("UPDATE edit_leases SET expires_at=now()-interval '1 second' WHERE block_id=$1", [hero.id])
    const replacement = await lease(bob, snapshot, hero)
    expect(replacement.token).not.toBe(old.token)
    await expect(run(alice, snapshot, { ...commandBase({ block: hero, lease: old }), type: 'saveBlock', payload: { blockId: hero.id, fields: { title: 'Late' } } })).rejects.toMatchObject({ code: 'locked' })
    const saved = await run(bob, snapshot, { ...commandBase({ block: hero, lease: replacement }), type: 'saveBlock', payload: { blockId: hero.id, fields: { title: 'Fresh' } } })
    await expect(run(bob, saved.snapshot, { ...commandBase({ block: hero, lease: replacement }), type: 'saveBlock', payload: { blockId: hero.id, fields: { title: 'Stale' } } })).rejects.toMatchObject({ code: 'stale_revision' })
  })
  it('recovers a committed mutation after lost acknowledgement without duplicating history', async () => {
    const hero = blockNamed(snapshot, 'hero'); const own = await lease(alice, snapshot, hero)
    const command: Command = { ...commandBase({ block: hero, lease: own }), type: 'saveBlock', payload: { blockId: hero.id, fields: { title: 'Committed' } } }
    const first = await run(alice, snapshot, command)
    const restarted = new BlokStore(pool)
    const retry = await restarted.command(alice, snapshot.story.id, snapshot.locale.id, command)
    expect(retry.checkpointId).toBe(first.checkpointId)
    expect((await store.listCheckpoints(alice, snapshot.story.id, snapshot.locale.id))).toHaveLength(2)
    await expect(run(alice, snapshot, { ...command, payload: { blockId: hero.id, fields: { title: 'Different' } } })).rejects.toMatchObject({ code: 'invalid' })
    expect(blockNamed(await restarted.getSnapshot(alice, snapshot.story.id, snapshot.locale.id), 'hero').fields.title).toBe('Committed')
  })
  it('imports independent locale subtrees with fresh IDs and no future inheritance', async () => {
    const configured = await store.createSpaceLocale(alice,{ slug:'fr',name:'Français' })
    const french = await store.createLocale(alice, snapshot.story.id, { spaceLocaleId:configured.id })
    expect(french.blocks).toHaveLength(1)
    const parent = french.blocks[0]; const own = await lease(alice, french, parent)
    const original = blockNamed(snapshot, 'hero')
    const imported = await run(alice, french, { ...commandBase({ block: parent, lease: own }), type: 'importBlocks', payload: { sourceLocaleId: snapshot.locale.id, blockIds: [original.id], parentId: parent.id, parentField: 'body' } })
    const copy = blockNamed(imported.snapshot, 'hero')
    expect(copy.id).not.toBe(original.id)
    expect(copy.fields).toEqual(original.fields)
    await save(bob, snapshot, original, { title: 'Updated Default' })
    expect(blockNamed(await store.getSnapshot(alice, french.story.id, french.locale.id), 'hero').fields).toEqual(original.fields)
  })
  it('restores one blok without reverting another editor’s sibling work', async () => {
    const originalCheckpoint = snapshot.checkpointId!
    const hero = blockNamed(snapshot, 'hero'); const footer = blockNamed(snapshot, 'footer')
    await save(alice, snapshot, hero, { title: 'New hero' })
    await save(bob, snapshot, footer, { text: 'Keep this footer' })
    const current = await store.getSnapshot(alice, snapshot.story.id, snapshot.locale.id)
    const currentHero = blockNamed(current, 'hero'); const own = await lease(alice, current, currentHero)
    const restored = await run(alice, current, { ...commandBase({ block: currentHero, lease: own }), type: 'restoreBlock', payload: { blockId: currentHero.id, checkpointId: originalCheckpoint } })
    expect(blockNamed(restored.snapshot, 'hero').fields).toEqual(hero.fields)
    expect(blockNamed(restored.snapshot, 'footer').fields.text).toBe('Keep this footer')
    expect(restored.localeRevision).toBe(current.revision + 1)
  })
  it('publishes the exact reviewed checkpoint while keeping later changes as drafts', async () => {
    const original = snapshot.checkpointId!
    const hero = blockNamed(snapshot, 'hero')
    const changed = await save(alice, snapshot, hero, { title: 'Unreviewed new content' })
    const published = await run(bob, changed.snapshot, { ...commandBase(), type: 'publishCheckpoint', payload: { checkpointId: original } })
    expect(blockNamed(published.snapshot, 'hero').fields.title).toBe('Unreviewed new content')
    const live = await store.getPublished(alice, snapshot.story.id, snapshot.locale.id)
    expect(live?.checkpointId).toBe(original)
    expect(JSON.stringify(live?.content)).toContain('Build something worth sharing.')
    expect(JSON.stringify(live?.content)).not.toContain('Unreviewed')
    const second = await run(bob, published.snapshot, { ...commandBase(), type: 'publishCheckpoint', payload: { checkpointId: original } })
    expect(second.publicationId).not.toBe(published.publicationId)
  })
  it('allows incomplete draft fields but refuses to publish them', async () => {
    const saved = await save(alice, snapshot, blockNamed(snapshot, 'hero'), { title: '' })
    await expect(run(alice, saved.snapshot, { ...commandBase(), type: 'publishCheckpoint', payload: { checkpointId: saved.checkpointId } })).rejects.toMatchObject({ code: 'invalid' })
    expect(await store.getPublished(alice, snapshot.story.id, snapshot.locale.id)).toBeNull()
  })
  it('protects descendant locks during structural deletion and prevents cycles', async () => {
    const container = await store.createDefinition(alice, { name: 'container', displayName: 'Container', kind: 'nestable', fields: [{ name: 'body', label: 'Body', type: 'blocks' }] })
    let state = snapshot
    const root = state.blocks.find(b => b.id === state.locale.rootBlockId)!; const rootLease = await lease(alice, state, root)
    state = (await run(alice, state, { ...commandBase({ block: root, lease: rootLease }), type: 'insertBlock', payload: { parentId: root.id, parentField: 'body', definitionId: container.id } })).snapshot
    let parent = blockNamed(state, 'container'); const parentLease = await lease(alice, state, parent)
    state = (await run(alice, state, { ...commandBase({ block: parent, lease: parentLease }), type: 'insertBlock', payload: { parentId: parent.id, parentField: 'body', definitionId: container.id } })).snapshot
    parent = state.blocks.find(b => b.id === parent.id)!
    const child = state.blocks.find(b => b.parentId === parent.id)!; const childLease = await lease(bob, state, child)
    const currentRoot = state.blocks.find(b => b.id === root.id)!
    await expect(run(alice, state, { ...commandBase({ block: parent, lease: parentLease }, { block: currentRoot, lease: rootLease }), type: 'deleteBlock', payload: { blockId: parent.id } })).rejects.toMatchObject({ code: 'locked' })
    await store.releaseLease(bob, state.story.id, state.locale.id, child.id, childLease.token!)
    const ownedChild = await lease(alice, state, child)
    await expect(run(alice, state, { ...commandBase({ block: parent, lease: parentLease }, { block: currentRoot, lease: rootLease }, { block: child, lease: ownedChild }), type: 'moveBlock', payload: { blockId: parent.id, parentId: child.id, parentField: 'body', position: 0 } })).rejects.toMatchObject({ code: 'invalid' })
  })
  it('requires an unchanged reviewed page and no competing leases for whole-page restoration', async () => {
    const checkpointId = snapshot.checkpointId!
    const root = snapshot.blocks.find(b => b.id === snapshot.locale.rootBlockId)!; const rootLease = await lease(alice, snapshot, root)
    const footer = blockNamed(snapshot, 'footer'); const bobLease = await lease(bob, snapshot, footer)
    const restore: Command = { ...commandBase({ block: root, lease: rootLease }), expectedRevisions: { [root.id]: root.revision, $locale: snapshot.revision }, type: 'restorePage', payload: { checkpointId } }
    await expect(run(alice, snapshot, restore)).rejects.toMatchObject({ code: 'locked' })
    await store.releaseLease(bob, snapshot.story.id, snapshot.locale.id, footer.id, bobLease.token!)
    const saved = await save(alice, snapshot, footer, { text: 'Later' })
    await expect(run(alice, saved.snapshot, restore)).rejects.toMatchObject({ code: 'stale_revision' })
    const restored = await run(alice, saved.snapshot, { ...restore, mutationId: randomUUID(), expectedRevisions: { [root.id]: root.revision, $locale: saved.localeRevision } })
    expect(blockNamed(restored.snapshot, 'footer').fields).toEqual(footer.fields)
  })
  it('versions schemas without mutating existing content, and rolls back invalid structural changes', async () => {
    const definition = await store.createDefinition(alice, { name: 'limited', displayName: 'Limited page', kind: 'content-type', fields: [{ name: 'body', label: 'Body', type: 'blocks', maxItems: 1 }] })
    let state = await store.createStory(alice, { name: 'Limited', slug: 'limited', definitionId: definition.id })
    const root = state.blocks[0]; const own = await lease(alice, state, root)
    const hero = snapshot.definitions.find(d => d.name === 'hero')!
    state = (await run(alice, state, { ...commandBase({ block: root, lease: own }), type: 'insertBlock', payload: { parentId: root.id, parentField: 'body', definitionId: hero.id } })).snapshot
    const current = state.blocks.find(b => b.id === root.id)!
    await expect(run(alice, state, { ...commandBase({ block: current, lease: own }), type: 'insertBlock', payload: { parentId: root.id, parentField: 'body', definitionId: hero.id } })).rejects.toMatchObject({ code: 'invalid' })
    const unchanged = await store.getSnapshot(alice, state.story.id, state.locale.id)
    expect(unchanged.revision).toBe(state.revision)
    expect(unchanged.blocks).toHaveLength(2)
    const revised = await store.updateDefinition(alice, hero.id, { name: hero.name, displayName: hero.displayName, kind: hero.kind, fields: [...hero.fields, { name: 'subtitle', label: 'Subtitle', type: 'text', format: 'singleline' }] })
    expect(revised.version).toBe(2)
    expect(blockNamed(unchanged, 'hero').schemaVersionId).toBe(hero.versionId)
  })
  it('enforces session, role, space boundaries and preserves archived asset references', async () => {
    await expect(store.createDefinition(bob, { name: 'bad', displayName: 'Bad', kind: 'nestable', fields: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(store.getSnapshot({ ...alice, sessionId: 'missing' }, snapshot.story.id, snapshot.locale.id)).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(store.getSnapshot({ ...alice, spaceId: randomUUID() }, snapshot.story.id, snapshot.locale.id)).rejects.toMatchObject({ code: 'forbidden' })
    const foreignSpace = randomUUID(); const foreignAsset = randomUUID(); const ownAsset = randomUUID()
    await pool.query("INSERT INTO spaces(id,name) VALUES($1,'Other')", [foreignSpace])
    for (const [id, space] of [[foreignAsset, foreignSpace], [ownAsset, alice.spaceId]]) await pool.query("INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title,archived_at) VALUES($1::uuid,$2,$1::text,'test.png','image/png',10,'Test',now())", [id, space])
    const hero = blockNamed(snapshot, 'hero')
    await expect(save(alice, snapshot, hero, { ...hero.fields, image: { assetId: foreignAsset } })).rejects.toMatchObject({ code: 'invalid' })
    const valid = await save(alice, snapshot, hero, { ...hero.fields, image: { assetId: ownAsset, alt: 'Historical image' } })
    expect(blockNamed(valid.snapshot, 'hero').fields.image).toEqual({ assetId: ownAsset, alt: 'Historical image' })
  })
  it('manages datasources and paginated stable story option values', async () => {
    const source = await store.saveDatasource(alice, { name: 'Colors', slug: 'colors', items: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }] })
    expect(await store.resolveOptions(bob, { source: { type: 'datasource', datasourceId: source.id }, query: 'bl' })).toEqual({ items: [{ label: 'Blue', value: 'blue' }] })
    expect((await store.resolveOptions(bob, { source: { type: 'stories' } })).items).toContainEqual({ value: snapshot.story.id, label: snapshot.story.name })
    await expect(store.saveDatasource(bob, { name: 'No', slug: 'no', items: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(store.saveDatasource(alice, { name: 'Dup', slug: 'dup', items: [{ label: 'A', value: 'a' }, { label: 'B', value: 'a' }] })).rejects.toMatchObject({ code: 'invalid' })
  })
  it('enforces asset MIME restrictions on drafts and reviewed publication while allowing archived matching assets', async () => {
    const definition = await store.createDefinition(alice, { name: 'image_page', displayName: 'Image page', kind: 'content-type', fields: [{ name: 'image', label: 'Image', type: 'asset', mimeTypes: ['image/*'] }] })
    const state = await store.createStory(alice, { name: 'Images', slug: 'images', definitionId: definition.id })
    const root = state.blocks[0]
    const imageId = randomUUID(); const fileId = randomUUID()
    for (const [id, mime] of [[imageId, 'image/png'], [fileId, 'application/pdf']]) await pool.query("INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title,archived_at) VALUES($1::uuid,$2,$1::text,'fixture',$3,10,'Fixture',now())", [id, alice.spaceId, mime])
    await expect(save(alice, state, root, { image: { assetId: fileId } })).rejects.toMatchObject({ code: 'invalid', message: 'Image does not allow this asset type' })
    const saved = await save(alice, state, root, { image: { assetId: imageId } })
    const published = await run(alice, saved.snapshot, { ...commandBase(), type: 'publishCheckpoint', payload: { checkpointId: saved.checkpointId } })
    expect(published.publicationId).toBeTruthy()
    // Simulate a legacy checkpoint created before validation existed: publication revalidates it.
    await pool.query("UPDATE checkpoints SET snapshot=jsonb_set(snapshot,'{blocks,0,fields,image,assetId}',to_jsonb($2::text)) WHERE id=$1", [saved.checkpointId, fileId])
    await expect(run(alice, saved.snapshot, { ...commandBase(), type: 'publishCheckpoint', payload: { checkpointId: saved.checkpointId } })).rejects.toMatchObject({ code: 'invalid', message: 'Image does not allow this asset type' })
  })
})
