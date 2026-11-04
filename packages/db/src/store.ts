import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { z } from 'zod'
import { StorypaneError, LEASE_SECONDS, commandSchema, datasourceInputSchema, defaultFields, definitionInputSchema, localeInputSchema, optionSourceSchema, parseInput, storyInputSchema, validateFields, type Actor, type BlockDefinition, type BlockDraft, type Checkpoint, type CheckpointDetail, type Command, type CommitResult, type Datasource, type DefinitionInput, type FieldDefinition, type Json, type Lease, type LocaleSnapshot, type OptionPage, type Publication, type Story, type StorySummary, type PageEditors, type PageEditor, type StoryLocale } from '@storypane/core'
import { canonicalJson, definitionInput, migrateSnapshot, migrationChanges, type SchemaMigration, type MigrationReview, type ManagementToken } from '@storypane/core'
import { fetchExternalOptions } from './external-options.js'
import { folderPath, folderInputSchema, storyLocationSchema, type ContentFolder } from '@storypane/core'
import { roleInputSchema, type Permission, type SpaceRole, memberRoleSchema, spaceInvitationSchema, type SpaceInvitation, spaceInputSchema, spaceLocaleInputSchema, type Space, type SpaceDetails, type SpaceLocale } from '@storypane/core'
import { deliverySettingsSchema, isBlockAllowed, type DeliveredStory, type DeliverySettings, type DeliveryToken, type PreviewSession } from '@storypane/core'

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const secretToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`
const deliveryQuerySchema = z.object({ id:z.uuid().optional(), slug:z.string().max(2048).optional(), locale:z.string().max(80).default(''), offset:z.number().int().min(0).max(100000).default(0), limit:z.number().int().min(1).max(100).default(50) }).strict()
const deliveredRow = (row: Row): DeliveredStory => ({ migrationVersion:Number(row.migration_version ?? 0), id:row.story_id, name:row.name, slug:row.slug, locale:row.locale, localeId:row.locale_id, revision:Number(row.revision), content:row.content, publishedAt:row.published_at ? iso(row.published_at) : null })

type AccountActor = Pick<Actor, 'userId' | 'sessionId'>
async function spacesFor(client: PoolClient, userId: string, spaceId: string | null = null): Promise<Space[]> {
  const result = await client.query(`SELECT s.id,s.name,s.description,m.role,r.name AS "roleName",r.permissions,s.created_at AS "createdAt",
    (SELECT count(*)::integer FROM stories WHERE space_id=s.id) AS "storyCount",
    (SELECT count(*)::integer FROM memberships WHERE space_id=s.id) AS "memberCount"
    FROM spaces s JOIN memberships m ON m.space_id=s.id JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role
    WHERE m.user_id=$1 AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.created_at,s.id`, [userId, spaceId])
  return result.rows.map(row => ({ ...row, createdAt: iso(row.createdAt) }))
}

type Row = Record<string, any>
const iso = (v: Date | string) => v instanceof Date ? v.toISOString() : v
const storyRow = (r: Row): Story => ({ id: r.id, name: r.name, slug: r.slug, folderId:r.folder_id ?? null, slugSegment:r.slug_segment ?? r.slug, formOnly:r.form_only ?? false, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) })
const localeRow = (r: Row): StoryLocale => ({ id: r.id, storyId: r.story_id, spaceLocaleId:r.space_locale_id, slug: r.slug, name: r.name, urlSlug: r.url_slug, slugSegment:r.slug_segment ?? r.url_slug, rootBlockId: r.root_block_id, revision: Number(r.revision), checkpointId: r.checkpoint_id, publishedVersionId: r.published_version_id })
const folderRow=(r:Row):ContentFolder=>({id:r.id,name:r.name,slug:r.slug,parentId:r.parent_id,localeSlugs:r.locale_slugs,allowedDefinitionIds:r.allowed_definition_ids,defaultDefinitionId:r.default_definition_id,formOnly:r.form_only})
const joinPath=(prefix:string,slug:string)=>[prefix,slug].filter(Boolean).join('/')
const blockRow = (r: Row): BlockDraft => ({ id: r.id, definitionId: r.definition_id, schemaVersionId: r.schema_version_id, parentId: r.parent_id, parentField: r.parent_field, position: r.position, fields: r.fields, revision: Number(r.revision) })
const definitionRow = (r: Row): BlockDefinition => ({ ...r.schema, id: r.definition_id, versionId: r.id, version: r.version, createdAt: iso(r.created_at) })
const checkpointRow = (r: Row): Checkpoint => ({ id: r.id, revision: Number(r.revision), reason: r.reason, actorId: r.actor_id, createdAt: iso(r.created_at) })
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const migrationRow = (row:Row):SchemaMigration => ({id:row.id,spaceId:row.space_id,version:row.version,baseVersion:row.base_version,name:row.name,status:row.status,revision:row.revision,definitions:row.definitions,contributors:row.contributors,createdAt:iso(row.created_at),deployedAt:row.deployed_at?iso(row.deployed_at):null,deployedBy:row.deployed_by})
const digest = (value:unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
const migrationTarget = (migration:SchemaMigration) => migration.definitions.map(definition=>({id:definition.id,schema:definitionInput(definition)}))
function dbError(error: unknown): never {
  if (error instanceof StorypaneError) throw error
  const code = (error as { code?: string })?.code
  if (code === '23505') throw new StorypaneError('invalid', 'That name or slug already exists')
  if (['23503', '23514', '22P02'].includes(code ?? '')) throw new StorypaneError('invalid', 'Invalid reference or value')
  throw error
}
function requireBlock(snapshot: LocaleSnapshot, id: string): BlockDraft {
  const block = snapshot.blocks.find(b => b.id === id)
  if (!block) throw new StorypaneError('not_found', 'Block not found')
  return block
}
function subtree(snapshot: LocaleSnapshot, id: string): BlockDraft[] {
  const result: BlockDraft[] = []
  const visit = (blockId: string) => {
    if (result.some(b => b.id === blockId)) throw new StorypaneError('invalid', 'Cyclic block structure')
    result.push(requireBlock(snapshot, blockId))
    snapshot.blocks.filter(b => b.parentId === blockId).forEach(b => visit(b.id))
  }
  visit(id)
  return result
}
export function assembleContent(snapshot: LocaleSnapshot): Json {
  const definitions = new Map(snapshot.definitions.map(d => [d.versionId, d]))
  const visiting = new Set<string>()
  const visit = (id: string, depth: number): Json => {
    if (depth > 30 || visiting.has(id)) throw new StorypaneError('invalid', 'Block nesting exceeds the supported depth')
    const block = requireBlock(snapshot, id)
    const definition = definitions.get(block.schemaVersionId)
    if (!definition) throw new StorypaneError('invalid', 'Missing schema version')
    visiting.add(id)
    const result: Record<string, Json> = { ...block.fields, _uid: block.id, component: definition.name }
    for (const field of definition.fields.filter(f => f.type === 'blocks')) result[field.name] = snapshot.blocks.filter(b => b.parentId === id && b.parentField === field.name).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(b => visit(b.id, depth + 1))
    visiting.delete(id)
    return result
  }
  return visit(snapshot.locale.rootBlockId, 0)
}

export class StorypaneStore {
  readonly pool: Pool
  constructor(connection: Pool | string, private options: { externalOptionHosts?: string[] } = {}) { this.pool = typeof connection === 'string' ? new Pool({ connectionString: connection, max: 5 }) : connection }

  private async authorizeSession(client: PoolClient, actor: AccountActor): Promise<void> {
    if (!actor.userId || !actor.sessionId) throw new StorypaneError('unauthenticated', 'Sign in to continue')
    const session = await client.query('SELECT id FROM cms_sessions WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp()', [actor.sessionId, actor.userId])
    if (!session.rowCount) throw new StorypaneError('unauthenticated', 'Your session has expired')
  }
  private async authorize(client: PoolClient, actor: Actor, permission?: Permission | 'admin'): Promise<void> {
    if(actor.managementTokenId) {
      const token=(await client.query('SELECT capability FROM schema_management_tokens WHERE id=$1 AND space_id=$2 AND user_id=$3 AND revoked_at IS NULL',[actor.managementTokenId,actor.spaceId,actor.userId])).rows[0]
      if(!token)throw new StorypaneError('unauthenticated','Management token was revoked')
      if(permission && (permission==='admin' ? token.capability!=='deploy' : permission!=='schemas:write' || token.capability==='read'))throw new StorypaneError('forbidden','Management token does not allow this action')
    } else await this.authorizeSession(client, actor)
    const membership = await client.query('SELECT m.role,r.permissions FROM memberships m JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role WHERE m.space_id=$1 AND m.user_id=$2', [actor.spaceId, actor.userId])
    if (!membership.rowCount || (permission && (permission === 'admin' ? membership.rows[0].role !== 'admin' : !membership.rows[0].permissions.includes(permission)))) throw new StorypaneError('forbidden', permission ? 'Your role does not allow this action' : 'You do not have access to this space')
  }
  async assertActor(actor: Actor, permission?: Permission | 'admin'): Promise<void> { await this.tx(actor, async () => undefined, permission) }
  async listSpaces(actor: AccountActor): Promise<Space[]> {
    const client = await this.pool.connect()
    try { await this.authorizeSession(client, actor); return await spacesFor(client, actor.userId) }
    finally { client.release() }
  }
  async createSpace(actor: AccountActor, raw: unknown): Promise<Space> {
    const input = parseInput(spaceInputSchema, raw)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.authorizeSession(client, actor)
      const { rows } = await client.query('INSERT INTO spaces(name,description) VALUES($1,$2) RETURNING id', [input.name, input.description])
      await client.query("INSERT INTO space_locales(space_id,name,slug) VALUES($1,'Default','')", [rows[0].id])
      await client.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'admin')", [rows[0].id, actor.userId])
      await client.query("INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions,deployed_at) VALUES($1,0,0,'Initial baseline','deployed','[]',now())",[rows[0].id])
      const [space] = await spacesFor(client, actor.userId, rows[0].id)
      await client.query('COMMIT')
      return space!
    } catch (error) { await client.query('ROLLBACK'); dbError(error) }
    finally { client.release() }
  }
  async getSpace(actor: Actor): Promise<SpaceDetails> {
    return this.tx(actor, async client => {
      const [space] = await spacesFor(client, actor.userId, actor.spaceId)
      const members = await client.query('SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.space_id=$1 ORDER BY m.role,u.name,u.id', [actor.spaceId])
      return { ...space!, members: members.rows }
    })
  }
  private async lockMembers(client: PoolClient, actor: Actor) {
    await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [actor.spaceId])
    // Recheck after waiting: another administrator may have removed our access.
    await this.authorize(client, actor, 'admin')
  }
  async listSpaceInvitations(actor: Actor): Promise<SpaceInvitation[]> {
    return this.tx(actor, async client => (await client.query('SELECT id,email,role,created_at,expires_at FROM space_invitations WHERE space_id=$1 ORDER BY created_at DESC', [actor.spaceId])).rows.map(row => ({ id:row.id,email:row.email,role:row.role,createdAt:iso(row.created_at),expiresAt:iso(row.expires_at) })), 'admin')
  }
  async inviteSpaceMember(actor: Actor, raw: unknown): Promise<void> {
    const input = parseInput(spaceInvitationSchema, raw)
    await this.tx(actor, async client => {
      await this.lockMembers(client, actor)
      if ((await client.query('SELECT 1 FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.space_id=$1 AND lower(u.email)=$2', [actor.spaceId,input.email])).rowCount) throw new StorypaneError('invalid', 'This person is already a member.')
      await this.requireRole(client, actor.spaceId, input.role)
      const result = await client.query(`INSERT INTO space_invitations(space_id,email,role) VALUES($1,$2,$3)
        ON CONFLICT(space_id,email) DO UPDATE SET role=EXCLUDED.role,created_at=now(),expires_at=now()+interval '7 days'
        WHERE space_invitations.expires_at<=clock_timestamp() RETURNING id`, [actor.spaceId,input.email,input.role])
      if (!result.rowCount) throw new StorypaneError('invalid', 'An invitation is already pending for this email. Revoke it to change the role.')
    }, 'admin')
  }
  async revokeSpaceInvitation(actor: Actor, id: string): Promise<void> {
    parseInput(z.uuid(), id)
    await this.tx(actor, async client => {
      await this.lockMembers(client, actor)
      const result = await client.query('DELETE FROM space_invitations WHERE id=$1 AND space_id=$2', [id,actor.spaceId])
      if (!result.rowCount) throw new StorypaneError('not_found', 'Invitation not found.')
    }, 'admin')
  }
  async updateSpaceMember(actor: Actor, userId: string, raw: unknown): Promise<void> {
    const { role } = parseInput(memberRoleSchema, raw)
    await this.changeSpaceMember(actor, userId, role)
  }
  async removeSpaceMember(actor: Actor, userId: string): Promise<void> {
    await this.changeSpaceMember(actor, userId, null)
  }
  private async changeSpaceMember(actor: Actor, userId: string, role: Actor['role'] | null): Promise<void> {
    parseInput(z.string().min(1).max(256), userId)
    await this.tx(actor, async client => {
      await this.lockMembers(client, actor)
      if (role) await this.requireRole(client, actor.spaceId, role)
      const member = await client.query('SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2', [actor.spaceId,userId])
      if (!member.rowCount) throw new StorypaneError('not_found', 'Member not found in this space.')
      if (member.rows[0].role === 'admin' && role !== 'admin') {
        const admins = await client.query("SELECT 1 FROM memberships WHERE space_id=$1 AND role='admin'", [actor.spaceId])
        if (admins.rowCount === 1) throw new StorypaneError('invalid', 'A space must have at least one administrator. Promote another member first.')
      }
      if (role) await client.query('UPDATE memberships SET role=$3 WHERE space_id=$1 AND user_id=$2', [actor.spaceId,userId,role])
      else {
        await client.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [actor.spaceId,userId])
        await client.query('DELETE FROM space_invitations WHERE space_id=$1 AND email IN (SELECT lower(email) FROM "user" WHERE id=$2)', [actor.spaceId,userId])
        await client.query('DELETE FROM edit_leases e USING story_locales l,stories s WHERE e.locale_id=l.id AND l.story_id=s.id AND s.space_id=$1 AND e.user_id=$2', [actor.spaceId,userId])
      }
    }, 'admin')
  }
  private async requireRole(client:PoolClient, spaceId:string, role:string) {
    if (!(await client.query('SELECT 1 FROM space_roles WHERE space_id=$1 AND id=$2',[spaceId,role])).rowCount) throw new StorypaneError('invalid','Choose a role from this space.')
  }
  async listSpaceRoles(actor:Actor):Promise<SpaceRole[]> {
    return this.tx(actor,async client => (await client.query(`SELECT r.id,r.name,r.permissions,r.system,
      (SELECT count(*)::integer FROM memberships m WHERE m.space_id=r.space_id AND m.role=r.id) AS "memberCount",
      (SELECT count(*)::integer FROM space_invitations i WHERE i.space_id=r.space_id AND i.role=r.id) AS "invitationCount"
      FROM space_roles r WHERE r.space_id=$1 ORDER BY r.system DESC,r.name`,[actor.spaceId])).rows)
  }
  async saveSpaceRole(actor:Actor,raw:unknown,id?:string):Promise<void> {
    const input=parseInput(roleInputSchema,raw)
    await this.tx(actor,async client => {
      await this.lockMembers(client,actor)
      if (id) {
        const role=await client.query('SELECT system FROM space_roles WHERE space_id=$1 AND id=$2',[actor.spaceId,id])
        if (!role.rowCount) throw new StorypaneError('not_found','Role not found.')
        if (role.rows[0].system) throw new StorypaneError('invalid','Built-in roles cannot be changed. Create a custom role instead.')
        await client.query('UPDATE space_roles SET name=$3,permissions=$4 WHERE space_id=$1 AND id=$2',[actor.spaceId,id,input.name,input.permissions])
      } else await client.query('INSERT INTO space_roles(space_id,id,name,permissions) VALUES($1,$2,$3,$4)',[actor.spaceId,randomUUID(),input.name,input.permissions])
    },'admin')
  }
  async deleteSpaceRole(actor:Actor,id:string):Promise<void> {
    await this.tx(actor,async client => {
      await this.lockMembers(client,actor)
      const role=await client.query('SELECT system FROM space_roles WHERE space_id=$1 AND id=$2',[actor.spaceId,id])
      if (!role.rowCount) throw new StorypaneError('not_found','Role not found.')
      if (role.rows[0].system) throw new StorypaneError('invalid','Built-in roles cannot be deleted.')
      if ((await client.query('SELECT 1 FROM memberships WHERE space_id=$1 AND role=$2 UNION ALL SELECT 1 FROM space_invitations WHERE space_id=$1 AND role=$2',[actor.spaceId,id])).rowCount) throw new StorypaneError('invalid','Reassign members and revoke pending invitations before deleting this role.')
      await client.query('DELETE FROM space_roles WHERE space_id=$1 AND id=$2',[actor.spaceId,id])
    },'admin')
  }
  async updateSpace(actor: Actor, raw: unknown): Promise<Space> {
    const input = parseInput(spaceInputSchema, raw)
    return this.tx(actor, async client => {
      await client.query('UPDATE spaces SET name=$2,description=$3 WHERE id=$1', [actor.spaceId, input.name, input.description])
      return (await spacesFor(client, actor.userId, actor.spaceId))[0]!
    }, 'settings:write')
  }
  async listSpaceLocales(actor: Actor): Promise<SpaceLocale[]> {
    return this.tx(actor, async client => (await client.query(`SELECT c.id,c.name,c.slug,(SELECT count(*)::integer FROM story_locales l WHERE l.space_locale_id=c.id) AS "storyCount"
      FROM space_locales c WHERE c.space_id=$1 ORDER BY (c.slug='') DESC,c.name,c.id`, [actor.spaceId])).rows)
  }
  async createSpaceLocale(actor: Actor, raw: unknown): Promise<SpaceLocale> {
    const input = parseInput(spaceLocaleInputSchema, raw)
    return this.tx(actor, async client => {
      const { rows } = await client.query('INSERT INTO space_locales(space_id,name,slug) VALUES($1,$2,$3) RETURNING id,name,slug', [actor.spaceId,input.name,input.slug])
      return { ...rows[0], storyCount:0 }
    }, 'settings:write')
  }
  async updateSpaceLocale(actor: Actor, id: string, raw: unknown): Promise<SpaceLocale> {
    parseInput(z.uuid(), id)
    return this.tx(actor, async client => {
      const { rows } = await client.query('SELECT * FROM space_locales WHERE id=$1 AND space_id=$2 FOR UPDATE', [id,actor.spaceId])
      if (!rows[0]) throw new StorypaneError('not_found', 'Locale not found')
      if (rows[0].slug === '') throw new StorypaneError('invalid', 'Default always uses an empty slug and cannot be changed')
      const input = parseInput(spaceLocaleInputSchema, raw)
      await client.query('UPDATE space_locales SET name=$2,slug=$3 WHERE id=$1', [id,input.name,input.slug])
      const count = await client.query('SELECT count(*)::integer AS count FROM story_locales WHERE space_locale_id=$1', [id])
      return { id,...input,storyCount:count.rows[0].count }
    }, 'settings:write')
  }
  async deleteSpaceLocale(actor: Actor, id: string): Promise<void> {
    parseInput(z.uuid(), id)
    await this.tx(actor, async client => {
      const { rows } = await client.query('SELECT * FROM space_locales WHERE id=$1 AND space_id=$2 FOR UPDATE', [id,actor.spaceId])
      if (!rows[0]) throw new StorypaneError('not_found', 'Locale not found')
      if (rows[0].slug === '') throw new StorypaneError('invalid', 'Default cannot be removed')
      if ((await client.query('SELECT id FROM story_locales WHERE space_locale_id=$1 LIMIT 1', [id])).rowCount) throw new StorypaneError('invalid', 'This locale has story content and cannot be removed')
      await client.query('UPDATE content_folders SET locale_slugs=locale_slugs-$2 WHERE space_id=$1',[actor.spaceId,id])
      await client.query('DELETE FROM space_locales WHERE id=$1', [id])
    }, 'settings:write')
  }
  async deliveryLocales(token: string, spaceId: string): Promise<Pick<SpaceLocale,'id' | 'name' | 'slug'>[]> {
    await this.authenticateDelivery(token, spaceId)
    return (await this.pool.query("SELECT id,name,slug FROM space_locales WHERE space_id=$1 ORDER BY (slug='') DESC,name,id", [spaceId])).rows
  }
  async getDeliverySettings(actor: Actor): Promise<DeliverySettings> {
    return this.tx(actor, async client => (await client.query('SELECT preview_urls AS "previewUrls",default_preview_id AS "defaultPreviewId",preview_parameter AS "previewParameter" FROM spaces WHERE id=$1', [actor.spaceId])).rows[0])
  }
  async updateDeliverySettings(actor: Actor, raw: unknown): Promise<DeliverySettings> {
    const input = parseInput(deliverySettingsSchema, raw)
    return this.tx(actor, async client => {
      await client.query('UPDATE spaces SET preview_urls=$2,default_preview_id=$3,preview_parameter=$4 WHERE id=$1', [actor.spaceId, JSON.stringify(input.previewUrls), input.defaultPreviewId, input.previewParameter])
      await client.query('DELETE FROM preview_sessions WHERE space_id=$1 AND origin <> ALL($2::text[])', [actor.spaceId, input.previewUrls.map(item => new URL(item.url).origin)])
      return input
    }, 'settings:write')
  }
  async listDeliveryTokens(actor: Actor): Promise<DeliveryToken[]> {
    return this.tx(actor, async client => (await client.query('SELECT id,name,scope,created_at AS "createdAt" FROM delivery_tokens WHERE space_id=$1 AND revoked_at IS NULL ORDER BY created_at,id', [actor.spaceId])).rows.map(row => ({ ...row, createdAt:iso(row.createdAt) })), 'settings:write')
  }
  async createDeliveryToken(actor: Actor, raw: unknown): Promise<DeliveryToken & { token:string }> {
    const input = parseInput(z.object({ name:z.string().trim().min(1).max(80), scope:z.enum(['published','preview']) }).strict(), raw)
    return this.tx(actor, async client => {
      const token = secretToken(input.scope === 'published' ? 'bl_pub' : 'bl_preview')
      const { rows } = await client.query('INSERT INTO delivery_tokens(space_id,name,scope,token_hash) VALUES($1,$2,$3,$4) RETURNING id,name,scope,created_at AS "createdAt"', [actor.spaceId, input.name, input.scope, tokenHash(token)])
      return { ...rows[0], createdAt:iso(rows[0].createdAt), token }
    }, 'settings:write')
  }
  async revokeDeliveryToken(actor: Actor, id: string): Promise<void> {
    parseInput(z.uuid(), id)
    await this.tx(actor, async client => { await client.query('UPDATE delivery_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND space_id=$2', [id, actor.spaceId]) }, 'settings:write')
  }
  async authenticateDelivery(token: string, spaceId: string, preview = false): Promise<{ id:string; spaceId:string }> {
    parseInput(z.uuid(), spaceId)
    if (!token || token.length > 128) throw new StorypaneError('unauthenticated', 'A delivery token is required')
    const { rows } = await this.pool.query('SELECT id,space_id AS "spaceId",scope FROM delivery_tokens WHERE token_hash=$1 AND space_id=$2 AND revoked_at IS NULL', [tokenHash(token), spaceId])
    if (!rows[0] || (preview && rows[0].scope !== 'preview')) throw new StorypaneError('unauthenticated', 'Invalid or revoked delivery token')
    return rows[0]
  }
  async deliverySchema(token: string, spaceId: string) {
    await this.authenticateDelivery(token, spaceId, true)
    const row=(await this.pool.query('SELECT m.version,m.definitions FROM spaces s JOIN schema_migrations m ON m.space_id=s.id AND m.version=s.schema_version WHERE s.id=$1',[spaceId])).rows[0]
    if(!row || row.version===0)throw new StorypaneError('invalid','Deploy the initial schema migration before pulling schemas or generating types')
    return { migrationVersion:row.version, components: (row.definitions as BlockDefinition[]).map(definition => ({
      id:definition.id, name:definition.name, kind:definition.kind, version:definition.version, tags:definition.tags ?? [],
      fields:definition.fields.map(field => ({
        name:field.name, type:field.type, required:field.required ?? false,
        ...(field.type === 'text' ? { format:field.format } : {}),
        ...(field.type === 'blocks' ? { allowedDefinitionIds:field.allowedDefinitionIds ?? [], allowedTags:field.allowedTags ?? [] } : {}),
        ...((field.type === 'option' || field.type === 'options') && field.source.type === 'inline' ? { options:field.source.items.map(item => item.value) } : {}),
      })),
    })) }
  }
  async publishedStories(token:string,spaceId:string,raw:unknown):Promise<{migrationVersion:number;stories:DeliveredStory[];nextOffset:number|null}> {
    await this.authenticateDelivery(token,spaceId)
    const input=parseInput(deliveryQuerySchema,raw)
    const {rows}=await this.pool.query(`WITH page AS (
      SELECT s.id AS story_id,p.snapshot->'story'->>'name' AS name,coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug) AS slug,l.slug AS locale,l.id AS locale_id,p.revision,p.content,p.created_at AS published_at
      FROM stories s JOIN story_locales l ON l.story_id=s.id JOIN publications p ON p.id=l.published_version_id
      WHERE s.space_id=$1 AND l.slug=$2 AND ($3::uuid IS NULL OR s.id=$3) AND ($4::text IS NULL OR coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug)=$4)
      ORDER BY coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug),s.id LIMIT $5 OFFSET $6)
      SELECT s.schema_version,coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.slug,page.story_id) FILTER(WHERE page.locale_id IS NOT NULL),'[]') AS stories
      FROM spaces s LEFT JOIN page ON true WHERE s.id=$1 GROUP BY s.schema_version`,[spaceId,input.locale,input.id ?? null,input.slug ?? null,input.limit+1,input.offset])
    const version=Number(rows[0].schema_version), stories:Row[]=rows[0].stories
    return {migrationVersion:version,stories:stories.slice(0,input.limit).map(row=>deliveredRow({...row,migration_version:version})),nextOffset:stories.length>input.limit?input.offset+input.limit:null}
  }
  async createEditorPreview(actor: Actor, storyId: string, localeId: string, raw: unknown = {}): Promise<PreviewSession> {
    const input = parseInput(z.object({ previewId:z.uuid().optional() }).strict(), raw)
    return this.tx(actor, async client => {
      await this.lockLocale(client, actor, storyId, localeId)
      return this.insertPreview(client, actor.spaceId, storyId, localeId, { userId:actor.userId, sessionId:actor.sessionId }, input.previewId)
    })
  }
  async createTokenPreview(token: string, spaceId: string, raw: unknown): Promise<PreviewSession> {
    const credential = await this.authenticateDelivery(token, spaceId, true)
    const input = parseInput(z.object({ id:z.uuid().optional(), slug:z.string().max(2048).optional(), locale:z.string().max(80).default(''), previewId:z.uuid().optional() }).strict().refine(value => !!value.id !== (value.slug !== undefined), 'Specify either id or slug'), raw)
    const client = await this.pool.connect()
    try {
      const { rows } = await client.query('SELECT s.id AS story_id,l.id AS locale_id FROM stories s JOIN story_locales l ON l.story_id=s.id WHERE s.space_id=$1 AND l.slug=$2 AND ($3::uuid IS NULL OR s.id=$3) AND ($4::text IS NULL OR l.url_slug=$4)', [spaceId, input.locale, input.id ?? null, input.slug ?? null])
      if (!rows[0]) throw new StorypaneError('not_found', 'Story locale not found')
      return await this.insertPreview(client, spaceId, rows[0].story_id, rows[0].locale_id, { tokenId:credential.id }, input.previewId)
    } finally { client.release() }
  }
  private async insertPreview(client: PoolClient, spaceId: string, storyId: string, localeId: string, owner: { userId?:string; sessionId?:string; tokenId?:string }, previewId?: string): Promise<PreviewSession> {
    const { rows } = await client.query('SELECT s.preview_urls,s.default_preview_id,l.url_slug AS slug,l.slug AS locale FROM spaces s JOIN stories st ON st.space_id=s.id JOIN story_locales l ON l.story_id=st.id WHERE s.id=$1 AND st.id=$2 AND l.id=$3', [spaceId, storyId, localeId])
    const target = (rows[0]?.preview_urls as DeliverySettings['previewUrls'] | undefined)?.find(item => item.id === (previewId ?? rows[0].default_preview_id))
    if (!target) throw new StorypaneError('invalid', 'Choose a configured preview URL in Space settings')
    const origin = new URL(target.url).origin
    const token = secretToken('bp')
    await client.query('DELETE FROM preview_sessions WHERE space_id=$1 AND expires_at<now()', [spaceId])
    const session = await client.query("INSERT INTO preview_sessions(token_hash,space_id,story_id,locale_id,origin,user_id,session_id,delivery_token_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '5 minutes') RETURNING expires_at", [tokenHash(token), spaceId, storyId, localeId, origin, owner.userId ?? null, owner.sessionId ?? null, owner.tokenId ?? null])
    return { token, expiresAt:iso(session.rows[0].expires_at), spaceId, storyId, localeId, slug:rows[0].slug, locale:rows[0].locale }
  }
  async authenticatePreview(token: string, origin: string): Promise<{ id:string; spaceId:string; storyId:string; localeId:string }> {
    if (!/^bp_[\w-]{43}$/.test(token)) throw new StorypaneError('unauthenticated', 'Invalid preview session')
    const { rows } = await this.pool.query('SELECT p.id,p.space_id AS "spaceId",p.story_id AS "storyId",p.locale_id AS "localeId",s.preview_urls FROM preview_sessions p JOIN spaces s ON s.id=p.space_id WHERE p.token_hash=$1 AND p.origin=$2 AND p.expires_at>clock_timestamp()', [tokenHash(token), origin])
    if (!rows[0] || !(rows[0].preview_urls as DeliverySettings['previewUrls']).some(item => new URL(item.url).origin === origin)) throw new StorypaneError('unauthenticated', 'Preview session expired or origin is not allowed')
    await this.previewStory(rows[0].id)
    const { preview_urls: _urls, ...session } = rows[0]
    return session as { id:string; spaceId:string; storyId:string; localeId:string }
  }
  async previewStory(previewId: string): Promise<DeliveredStory> {
    const { rows } = await this.pool.query(`SELECT sp.schema_version AS migration_version,st.id AS story_id,st.name,l.url_slug AS slug,l.slug AS locale,l.id AS locale_id,c.revision,c.content
      FROM preview_sessions p JOIN spaces sp ON sp.id=p.space_id JOIN stories st ON st.id=p.story_id AND st.space_id=p.space_id
      JOIN story_locales l ON l.id=p.locale_id AND l.story_id=st.id JOIN checkpoints c ON c.id=l.checkpoint_id
      WHERE p.id=$1 AND p.expires_at>clock_timestamp() AND (
        EXISTS(SELECT 1 FROM cms_sessions se JOIN memberships m ON m.user_id=se.user_id AND m.space_id=p.space_id WHERE se.id=p.session_id AND se.user_id=p.user_id AND se.expires_at>clock_timestamp())
        OR EXISTS(SELECT 1 FROM delivery_tokens t WHERE t.id=p.delivery_token_id AND t.space_id=p.space_id AND t.scope='preview' AND t.revoked_at IS NULL))`, [previewId])
    if (!rows[0]) throw new StorypaneError('unauthenticated', 'Preview access expired or was revoked')
    return deliveredRow(rows[0])
  }
  private async tx<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>, permission?: Permission | 'admin', exclusive=false): Promise<T> {
    const client = await this.pool.connect()
    try { await client.query('BEGIN'); await client.query(exclusive ? 'SELECT pg_advisory_xact_lock(hashtextextended($1,91))' : 'SELECT pg_advisory_xact_lock_shared(hashtextextended($1,91))',[actor.spaceId]); await this.authorize(client, actor, permission); const result = await fn(client); await client.query('COMMIT'); return result }
    catch (error) { await client.query('ROLLBACK'); dbError(error) }
    finally { client.release() }
  }
  private async lockLocale(client: PoolClient, actor: Actor, storyId: string, localeId: string): Promise<void> {
    const result = await client.query('SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE l.id=$1 AND s.id=$2 AND s.space_id=$3 FOR UPDATE OF l', [localeId, storyId, actor.spaceId])
    if (!result.rowCount) throw new StorypaneError('not_found', 'Story locale not found')
  }
  private async snapshot(client: PoolClient, actor: Actor, storyId: string, localeId: string): Promise<LocaleSnapshot> {
    const story = await client.query('SELECT s.*,f.form_only FROM stories s LEFT JOIN content_folders f ON f.id=s.folder_id WHERE s.id=$1 AND s.space_id=$2', [storyId, actor.spaceId])
    const locale = await client.query('SELECT * FROM story_locales WHERE id=$1 AND story_id=$2', [localeId, storyId])
    if (!story.rowCount || !locale.rowCount) throw new StorypaneError('not_found', 'Story locale not found')
    const blocks = await client.query('SELECT b.*, v.definition_id FROM block_drafts b JOIN definition_versions v ON v.id=b.schema_version_id WHERE b.locale_id=$1 ORDER BY b.position,b.id', [localeId])
    const versions = await client.query('SELECT DISTINCT v.* FROM definition_versions v JOIN block_drafts b ON b.schema_version_id=v.id WHERE b.locale_id=$1', [localeId])
    const leases = await client.query('SELECT * FROM edit_leases WHERE locale_id=$1 AND expires_at>clock_timestamp()', [localeId])
    const migrationVersion=Number((await client.query('SELECT schema_version FROM spaces WHERE id=$1',[actor.spaceId])).rows[0].schema_version)
    const snapshot: LocaleSnapshot = { migrationVersion, story: storyRow(story.rows[0]), locale: localeRow(locale.rows[0]), blocks: blocks.rows.map(blockRow), definitions: versions.rows.map(definitionRow), leases: leases.rows.map(r => ({ blockId: r.block_id, userId: r.user_id, sessionId: r.session_id, expiresAt: iso(r.expires_at), ...(r.session_id === actor.sessionId && r.user_id === actor.userId ? { token: r.token } : {}) })), revision: Number(locale.rows[0].revision), checkpointId: locale.rows[0].checkpoint_id }
    const publication = snapshot.locale.publishedVersionId
      ? (await client.query("SELECT content,snapshot->'locale'->>'urlSlug' AS slug FROM publications WHERE id=$1", [snapshot.locale.publishedVersionId])).rows[0]
      : null
    // Publishing itself creates a checkpoint; compare delivered content, not revision IDs.
    snapshot.publicationStatus = !publication ? 'draft' : canonical(assembleContent(snapshot)) === canonical(publication.content) && (publication.slug ?? snapshot.locale.urlSlug)===snapshot.locale.urlSlug ? 'published' : 'changed'
    return snapshot
  }
  private async checkpoint(client: PoolClient, actor: Actor, storyId: string, localeId: string, reason: string): Promise<LocaleSnapshot> {
    const checkpointId = randomUUID()
    await client.query('UPDATE story_locales SET revision=revision+1,checkpoint_id=$2 WHERE id=$1', [localeId, checkpointId])
    await client.query('UPDATE stories SET updated_at=clock_timestamp(),updated_by=$2 WHERE id=$1', [storyId,actor.userId])
    const snapshot = await this.snapshot(client, actor, storyId, localeId)
    // shortcut: full snapshots per autosave batch; switch to deltas when measured history storage warrants it.
    await client.query('INSERT INTO checkpoints(id,locale_id,revision,actor_id,reason,snapshot,content) VALUES($1,$2,$3,$4,$5,$6,$7)', [checkpointId, localeId, snapshot.revision, actor.userId, reason, JSON.stringify({ ...snapshot, leases: [] }), JSON.stringify(assembleContent(snapshot))])
    return snapshot
  }
  async listDefinitions(actor: Actor, deployed=false): Promise<BlockDefinition[]> {
    return this.tx(actor,async client => deployed ? (await this.deployedMigration(client,actor.spaceId)).definitions : this.definitionHeads(client,actor.spaceId))
  }
  private async definitionHeads(client:PoolClient,spaceId:string):Promise<BlockDefinition[]> {
    return (await client.query('SELECT v.* FROM definitions d JOIN definition_versions v ON v.definition_id=d.id AND v.version=d.current_version WHERE d.space_id=$1 ORDER BY d.name',[spaceId])).rows.map(definitionRow)
  }
  private async deployedMigration(client:PoolClient,spaceId:string):Promise<SchemaMigration> {
    const row=(await client.query('SELECT m.* FROM schema_migrations m JOIN spaces s ON s.id=m.space_id AND s.schema_version=m.version WHERE s.id=$1',[spaceId])).rows[0]
    if(!row)throw new StorypaneError('invalid','Initialize this space before editing schemas')
    return migrationRow(row)
  }
  private async validateDefinition(client: PoolClient, actor: Actor, input: DefinitionInput): Promise<void> {
    const issues = validateFields(input, defaultFields(input))
    if (issues.length) throw new StorypaneError('invalid', 'Invalid default values', issues)
    await this.validateReferences(client, actor, input, defaultFields(input))
    for (const field of input.fields) {
      if ((field.type === 'option' || field.type === 'options') && field.source.type === 'datasource') {
        if (!(await client.query('SELECT id FROM datasources WHERE id=$1 AND space_id=$2', [field.source.datasourceId, actor.spaceId])).rowCount) throw new StorypaneError('invalid', 'Datasource must belong to this space')
      }
      if (field.type === 'blocks' && field.allowedDefinitionIds?.length) {
        const found = await client.query('SELECT id FROM definitions WHERE id=ANY($1::uuid[]) AND space_id=$2', [field.allowedDefinitionIds, actor.spaceId])
        if (found.rowCount !== new Set(field.allowedDefinitionIds).size) throw new StorypaneError('invalid', 'Allowed block definitions must belong to this space')
      }
    }
  }
  private async identifyFields(client:PoolClient, definitionId:string, input:DefinitionInput, previous?:BlockDefinition):Promise<DefinitionInput> {
    const known=(await client.query("SELECT DISTINCT field->>'id' AS id FROM definition_versions,jsonb_array_elements(schema->'fields') field WHERE definition_id=$1",[definitionId])).rows.map(row=>row.id)
    return {...input,fields:input.fields.map(field=>{
      const retained=field.id ? previous?.fields.find(old=>old.id===field.id) : previous?.fields.find(old=>old.name===field.name)
      if(field.id && !retained && known.includes(field.id))throw new StorypaneError('invalid','A deleted field identity cannot be reused; create a new field')
      return {...field,id:retained?.id ?? field.id ?? randomUUID()}
    })}
  }
  private async activeMigration(client:PoolClient,actor:Actor):Promise<SchemaMigration> {
    // Serializes workspace saves while page editing remains concurrent.
    await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE',[actor.spaceId])
    const row=(await client.query("SELECT * FROM schema_migrations WHERE space_id=$1 AND status='active'",[actor.spaceId])).rows[0]
    if(row)return migrationRow(row)
    const base=await this.deployedMigration(client,actor.spaceId)
    return migrationRow((await client.query("INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions) VALUES($1,$2,$3,$4,'active',$5) RETURNING *",[actor.spaceId,base.version+1,base.version,`Migration ${base.version+1}`,JSON.stringify(base.definitions)])).rows[0])
  }
  private async saveMigrationDefinitions(client:PoolClient,actor:Actor,migration:SchemaMigration,definitions:BlockDefinition[]) {
    await client.query('UPDATE schema_migrations SET definitions=$2,revision=revision+1,contributors=ARRAY(SELECT DISTINCT unnest(contributors || ARRAY[$3]::text[])) WHERE id=$1',[migration.id,JSON.stringify(definitions),actor.userId])
  }
  async createDefinition(actor:Actor,value:unknown,baseVersion?:number):Promise<BlockDefinition> {
    const input=parseInput(definitionInputSchema,value)
    return this.tx(actor,async client=>{
      const migration=await this.activeMigration(client,actor)
      if(baseVersion!==undefined && baseVersion!==migration.baseVersion)throw new StorypaneError('stale_revision','A migration was deployed. Reload the schema workspace.')
      await this.validateDefinition(client,actor,input)
      const definitionId=(await client.query('INSERT INTO definitions(space_id,name) VALUES($1,$2) RETURNING id',[actor.spaceId,input.name])).rows[0].id
      const schema=await this.identifyFields(client,definitionId,input)
      const definition=definitionRow((await client.query('INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,1,$2) RETURNING *',[definitionId,JSON.stringify(schema)])).rows[0])
      await this.saveMigrationDefinitions(client,actor,migration,[...migration.definitions,definition])
      return definition
    },'schemas:write')
  }
  async updateDefinition(actor:Actor,definitionId:string,value:unknown,expectedVersionId?:string,baseVersion?:number):Promise<BlockDefinition> {
    const input=parseInput(definitionInputSchema,value)
    return this.tx(actor,async client=>{
      const migration=await this.activeMigration(client,actor)
      const previous=migration.definitions.find(item=>item.id===definitionId)
      if(!previous)throw new StorypaneError('not_found','Definition not found')
      if((expectedVersionId!==undefined && previous.versionId!==expectedVersionId) || (baseVersion!==undefined && baseVersion!==migration.baseVersion))throw new StorypaneError('stale_revision','The schema changed. Your edits are preserved; reload and review before saving.')
      if(input.name!==previous.name)throw new StorypaneError('invalid','Definition API names cannot be renamed')
      const schema=await this.identifyFields(client,definitionId,input,previous)
      await this.validateDefinition(client,actor,schema)
      if(canonicalJson(schema)===canonicalJson(definitionInput(previous)))return previous
      const definition=definitionRow((await client.query('INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,$2,$3) RETURNING *',[definitionId,previous.version+1,JSON.stringify(schema)])).rows[0])
      await client.query('UPDATE definitions SET current_version=$2 WHERE id=$1',[definitionId,definition.version])
      await this.saveMigrationDefinitions(client,actor,migration,migration.definitions.map(item=>item.id===definitionId?definition:item))
      return definition
    },'schemas:write')
  }
  private async currentDefinition(client:PoolClient,actor:Actor,definitionId:string):Promise<BlockDefinition> {
    const definition=(await this.deployedMigration(client,actor.spaceId)).definitions.find(item=>item.id===definitionId)
    if(!definition)throw new StorypaneError('invalid','Deploy this block schema before adding it to content')
    return definition
  }
  async listMigrations(actor:Actor,workspace=false):Promise<SchemaMigration[]> {
    return this.tx(actor,async client=>(await client.query("SELECT * FROM schema_migrations WHERE space_id=$1 AND (NOT $2 OR status='active' OR version=(SELECT schema_version FROM spaces WHERE id=$1)) ORDER BY version",[actor.spaceId,workspace])).rows.map(migrationRow))
  }
  async authenticateManagement(token:string,spaceId:string):Promise<Actor> {
    parseInput(z.uuid(),spaceId)
    if(!/^sm_[\w-]{43}$/.test(token))throw new StorypaneError('unauthenticated','A schema management token is required')
    const row=(await this.pool.query('SELECT t.id,t.user_id,m.role FROM schema_management_tokens t JOIN memberships m ON m.space_id=t.space_id AND m.user_id=t.user_id WHERE t.token_hash=$1 AND t.space_id=$2 AND t.revoked_at IS NULL',[tokenHash(token),spaceId])).rows[0]
    if(!row)throw new StorypaneError('unauthenticated','Invalid or revoked management token')
    return {userId:row.user_id,sessionId:'',spaceId,role:row.role,managementTokenId:row.id}
  }
  async listManagementTokens(actor:Actor):Promise<ManagementToken[]> {
    return this.tx(actor,async client=>(await client.query('SELECT id,name,capability,created_at FROM schema_management_tokens WHERE space_id=$1 AND revoked_at IS NULL ORDER BY created_at',[actor.spaceId])).rows.map(row=>({id:row.id,name:row.name,capability:row.capability,createdAt:iso(row.created_at)})),'admin')
  }
  async createManagementToken(actor:Actor,raw:unknown):Promise<ManagementToken & {token:string}> {
    const input=parseInput(z.object({name:z.string().trim().min(1).max(80),capability:z.enum(['read','stage','deploy'])}).strict(),raw)
    if(actor.managementTokenId)throw new StorypaneError('forbidden','Sign in to manage tokens')
    return this.tx(actor,async client=>{
      const token=secretToken('sm')
      const row=(await client.query('INSERT INTO schema_management_tokens(space_id,user_id,name,capability,token_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',[actor.spaceId,actor.userId,input.name,input.capability,tokenHash(token)])).rows[0]
      return {id:row.id,name:input.name,capability:input.capability,createdAt:iso(row.created_at),token}
    },'admin')
  }
  async revokeManagementToken(actor:Actor,id:string) {
    parseInput(z.uuid(),id)
    if(actor.managementTokenId)throw new StorypaneError('forbidden','Sign in to manage tokens')
    return this.tx(actor,async client=>{await client.query('UPDATE schema_management_tokens SET revoked_at=now() WHERE id=$1 AND space_id=$2',[id,actor.spaceId])},'admin')
  }
  async pushMigration(actor:Actor,raw:unknown):Promise<SchemaMigration> {
    const input=parseInput(z.object({formatVersion:z.literal(1),id:z.uuid(),spaceId:z.uuid(),version:z.number().int().positive(),baseVersion:z.number().int().nonnegative(),name:z.string().trim().min(1).max(120),definitions:z.array(z.object({id:z.uuid(),schema:definitionInputSchema}).strict()).max(10000),remoteRevision:z.number().int().positive().nullable(),sourceHash:z.string().nullable(),status:z.literal('active')}).strict(),raw)
    if(input.spaceId!==actor.spaceId || input.version!==input.baseVersion+1)throw new StorypaneError('invalid','Migration space or version does not match its base')
    if(new Set(input.definitions.map(d=>d.id)).size!==input.definitions.length || new Set(input.definitions.map(d=>d.schema.name)).size!==input.definitions.length)throw new StorypaneError('invalid','Duplicate block identities or names')
    return this.tx(actor,async client=>{
      await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE',[actor.spaceId])
      const found=(await client.query('SELECT * FROM schema_migrations WHERE id=$1 AND space_id=$2',[input.id,actor.spaceId])).rows[0]
      const previous=found?migrationRow(found):undefined
      const same=previous && digest({name:previous.name,definitions:migrationTarget(previous)})===digest({name:input.name,definitions:input.definitions})
      if(same)return previous!
      if(previous?.status==='deployed')throw new StorypaneError('stale_revision','Deployed migrations are immutable')
      const base=await this.deployedMigration(client,actor.spaceId)
      if(base.version!==input.baseVersion)throw new StorypaneError('stale_revision','The deployed migration changed. Pull and reconcile your local migration.')
      const activeRow=(await client.query("SELECT * FROM schema_migrations WHERE space_id=$1 AND status='active'",[actor.spaceId])).rows[0]
      if(activeRow && (activeRow.id!==input.id || activeRow.revision!==input.remoteRevision))throw new StorypaneError('stale_revision','The shared active migration changed. Pull a separate copy and reconcile before pushing.')
      if(!activeRow && input.remoteRevision!==null)throw new StorypaneError('stale_revision','The active migration no longer exists')
      const old=activeRow?migrationRow(activeRow).definitions:base.definitions
      if(old.some(definition=>!input.definitions.some(item=>item.id===definition.id)))throw new StorypaneError('invalid','Removing an entire block definition is not supported; remove its fields instead')
      // Create identities first so newly added definitions can reference one another.
      for(const item of input.definitions) {
        const prior=old.find(definition=>definition.id===item.id)
        if(prior && prior.name!==item.schema.name)throw new StorypaneError('invalid','Definition API names cannot be renamed')
        if(!prior)await client.query('INSERT INTO definitions(id,space_id,name) VALUES($1,$2,$3)',[item.id,actor.spaceId,item.schema.name])
      }
      const definitions:BlockDefinition[]=[]
      for(const item of input.definitions) {
        const prior=old.find(definition=>definition.id===item.id)
        const schema=await this.identifyFields(client,item.id,item.schema,prior)
        await this.validateDefinition(client,actor,schema)
        if(prior && canonicalJson(definitionInput(prior))===canonicalJson(schema)){definitions.push(prior);continue}
        const version=(prior?.version ?? 0)+1
        const definition=definitionRow((await client.query('INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,$2,$3) RETURNING *',[item.id,version,JSON.stringify(schema)])).rows[0])
        await client.query('UPDATE definitions SET current_version=$2 WHERE id=$1',[item.id,version])
        definitions.push(definition)
      }
      const row=(await client.query("INSERT INTO schema_migrations(id,space_id,version,base_version,name,status,definitions,contributors) VALUES($1,$2,$3,$4,$5,'active',$6,ARRAY[$7]::text[]) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,definitions=EXCLUDED.definitions,revision=schema_migrations.revision+1,contributors=ARRAY(SELECT DISTINCT unnest(schema_migrations.contributors || EXCLUDED.contributors)) RETURNING *",[input.id,actor.spaceId,input.version,input.baseVersion,input.name,JSON.stringify(definitions),actor.userId])).rows[0]
      return migrationRow(row)
    },'schemas:write')
  }
  private async hydrateHistoricalDefinitions(client:PoolClient,snapshot:LocaleSnapshot):Promise<LocaleSnapshot> {
    const versions=(await client.query('SELECT * FROM definition_versions WHERE id=ANY($1::uuid[])',[snapshot.definitions.map(definition=>definition.versionId)])).rows.map(definitionRow)
    return {...snapshot,definitions:versions}
  }
  private async restoreMigrationSnapshot(client:PoolClient,actor:Actor,snapshot:LocaleSnapshot):Promise<LocaleSnapshot> {
    let current=await this.hydrateHistoricalDefinitions(client,snapshot)
    const migrations=(await client.query("SELECT * FROM schema_migrations WHERE space_id=$1 AND status='deployed' AND version>$2 ORDER BY version",[actor.spaceId,snapshot.migrationVersion ?? 0])).rows.map(migrationRow)
    for(const migration of migrations)current=migrateSnapshot(current,migration.definitions,migration.version).snapshot
    return current
  }
  private async inspectMigration(client:PoolClient,actor:Actor,id:string) {
    const row=(await client.query('SELECT * FROM schema_migrations WHERE id=$1 AND space_id=$2',[id,actor.spaceId])).rows[0]
    if(!row)throw new StorypaneError('not_found','Migration not found')
    const migration=migrationRow(row), base=await this.deployedMigration(client,actor.spaceId)
    if(migration.status!=='active' || migration.baseVersion!==base.version)throw new StorypaneError('stale_revision','This migration is no longer active')
    const blockers:MigrationReview['blockers']=[], impacts:MigrationReview['impacts']=[], changes=migrationChanges(base.definitions,migration.definitions)
    const plans:{draft:LocaleSnapshot;published?:LocaleSnapshot}[]=[], heads:unknown[]=[]
    for(const definition of migration.definitions) {
      try { await this.validateDefinition(client,actor,definition) }
      catch(error) { if(!(error instanceof StorypaneError))throw error; blockers.push({path:definition.name,message:error.message}) }
    }
    const folders=await this.folders(client,actor.spaceId)
    for(const folder of folders)for(const id of [...folder.allowedDefinitionIds,...(folder.defaultDefinitionId?[folder.defaultDefinitionId]:[])]) {
      if(!migration.definitions.some(definition=>definition.id===id && definition.kind!=='nestable'))blockers.push({path:`folder:${folder.id}`,message:'Folder content types must remain content-type or universal definitions'})
    }
    const locales=(await client.query('SELECT l.id,l.story_id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 ORDER BY l.id',[actor.spaceId])).rows
    for(const locale of locales) {
      const draft=await this.snapshot(client,actor,locale.story_id,locale.id)
      const publication=draft.locale.publishedVersionId?(await client.query('SELECT * FROM publications WHERE id=$1',[draft.locale.publishedVersionId])).rows[0]:null
      heads.push([locale.id,draft.revision,draft.checkpointId,draft.locale.publishedVersionId])
      const plan:{draft:LocaleSnapshot;published?:LocaleSnapshot}={draft}
      for(const target of ['draft','published'] as const) {
        if(target==='published' && !publication)continue
        const source=await this.hydrateHistoricalDefinitions(client,target==='draft'?draft:publication.snapshot)
        if(base.version===0)for(const change of migrationChanges(source.definitions,migration.definitions.filter(definition=>source.definitions.some(old=>old.id===definition.id))))if(!changes.some(existing=>digest(existing)===digest(change)))changes.push(change)
        const result=migrateSnapshot(source,migration.definitions,migration.version)
        plan[target]=result.snapshot
        impacts.push({storyId:draft.story.id,localeId:locale.id,name:draft.story.name,locale:draft.locale.name,target,deletedValues:result.deletedValues,resetValues:result.resetValues,deletedBlocks:result.deletedBlocks})
        try { await this.validateSnapshot(client,actor,result.snapshot,target==='published') }
        catch(error) {
          if(!(error instanceof StorypaneError))throw error
          for(const issue of error.details ?? [{path:'',message:error.message}])blockers.push({path:`${draft.story.name}/${draft.locale.name}/${target}/${issue.path}`,message:issue.message})
        }
      }
      plans.push(plan)
    }
    const review:MigrationReview={migration,changes,impacts,blockers,token:digest({id:migration.id,revision:migration.revision,heads,folders,blockers,plans})}
    return {review,plans}
  }
  async reviewMigration(actor:Actor,id:string):Promise<MigrationReview> {
    parseInput(z.uuid(),id)
    return this.tx(actor,async client=>(await this.inspectMigration(client,actor,id)).review,undefined,true)
  }
  async deployMigration(actor:Actor,id:string,reviewToken:string):Promise<SchemaMigration> {
    parseInput(z.uuid(),id)
    parseInput(z.string().regex(/^[a-f0-9]{64}$/),reviewToken)
    const started=Date.now()
    try {
      const result=await this.tx(actor,async client=>{
        const existing=(await client.query('SELECT * FROM schema_migrations WHERE id=$1 AND space_id=$2',[id,actor.spaceId])).rows[0]
        if(existing?.status==='deployed') {
          if(existing.review_token!==reviewToken)throw new StorypaneError('stale_revision','This migration was deployed from a different review')
          return migrationRow(existing)
        }
        const {review,plans}=await this.inspectMigration(client,actor,id)
        if(review.token!==reviewToken)throw new StorypaneError('stale_revision','The migration or affected content changed. Review it again before deploying.')
        if(review.blockers.length)throw new StorypaneError('invalid','Resolve migration validation errors before deploying',review.blockers)
        await client.query('UPDATE spaces SET schema_version=$2 WHERE id=$1',[actor.spaceId,review.migration.version])
        for(const {draft,published} of plans) {
          const localeId=draft.locale.id
          if(published) {
            const checkpointId=randomUUID(), publicationId=randomUUID()
            const revision=Number((await client.query('UPDATE story_locales SET revision=revision+1 WHERE id=$1 RETURNING revision',[localeId])).rows[0].revision)
            published.revision=revision;published.locale.revision=revision;published.checkpointId=checkpointId;published.locale.checkpointId=checkpointId;published.leases=[]
            await client.query('INSERT INTO checkpoints(id,locale_id,revision,actor_id,reason,snapshot,content) VALUES($1,$2,$3,$4,$5,$6,$7)',[checkpointId,localeId,revision,actor.userId,`Migration ${review.migration.version} (published)`,JSON.stringify(published),JSON.stringify(assembleContent(published))])
            await client.query('INSERT INTO publications(id,locale_id,checkpoint_id,revision,actor_id,content,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',[publicationId,localeId,checkpointId,revision,actor.userId,JSON.stringify(assembleContent(published)),JSON.stringify(published)])
            await client.query('UPDATE story_locales SET published_version_id=$2 WHERE id=$1',[localeId,publicationId])
          }
          await client.query('DELETE FROM edit_leases WHERE locale_id=$1',[localeId])
          await client.query('DELETE FROM block_drafts WHERE locale_id=$1 AND id<>ALL($2::uuid[])',[localeId,draft.blocks.map(block=>block.id)])
          for(const block of draft.blocks)await client.query('UPDATE block_drafts SET schema_version_id=$3,parent_field=$4,fields=$5,revision=$6 WHERE locale_id=$1 AND id=$2',[localeId,block.id,block.schemaVersionId,block.parentField,JSON.stringify(block.fields),block.revision])
          await this.checkpoint(client,actor,draft.story.id,localeId,`Migration ${review.migration.version}`)
        }
        return migrationRow((await client.query("UPDATE schema_migrations SET status='deployed',deployed_at=clock_timestamp(),deployed_by=$2,review_token=$3 WHERE id=$1 RETURNING *",[id,actor.userId,reviewToken])).rows[0])
      },'admin',true)
      console.info('Schema migration deployed',{spaceId:actor.spaceId,version:result.version,actor:actor.userId,managementTokenId:actor.managementTokenId,durationMs:Date.now()-started})
      return result
    } catch(error) { console.warn('Schema migration failed',{spaceId:actor.spaceId,migrationId:id,actor:actor.userId,code:error instanceof StorypaneError?error.code:'unavailable',durationMs:Date.now()-started}); throw error }
  }

  async listPageEditors(actor:Actor):Promise<PageEditors> {
    return this.tx(actor,async client => {
      const {rows}=await client.query<PageEditor & {storyId:string}>(`SELECT s.id AS "storyId",u.id AS "userId",u.name,u.avatar_url AS "avatarUrl",
        array_agg(DISTINCT CASE WHEN l.slug='' THEN 'Default' ELSE l.name END ORDER BY CASE WHEN l.slug='' THEN 'Default' ELSE l.name END) AS locales
        FROM edit_leases e JOIN story_locales l ON l.id=e.locale_id JOIN stories s ON s.id=l.story_id
        JOIN "user" u ON u.id=e.user_id JOIN cms_sessions se ON se.id=e.session_id AND se.user_id=e.user_id
        JOIN memberships m ON m.space_id=s.space_id AND m.user_id=e.user_id
        JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role
        WHERE s.space_id=$1 AND e.expires_at>clock_timestamp() AND se.expires_at>clock_timestamp()
          AND 'content:edit'=ANY(r.permissions)
        GROUP BY s.id,u.id,u.name,u.avatar_url ORDER BY u.name,u.id`,[actor.spaceId])
      const editors:PageEditors={}
      for(const {storyId,...editor} of rows) (editors[storyId] ??= []).push(editor)
      return editors
    })
  }
  private async lockPaths(client:PoolClient,spaceId:string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,17))',[spaceId])
  }
  private async folders(client:PoolClient,spaceId:string):Promise<ContentFolder[]> {
    return (await client.query('SELECT * FROM content_folders WHERE space_id=$1 ORDER BY name,id',[spaceId])).rows.map(folderRow)
  }
  async listFolders(actor:Actor):Promise<ContentFolder[]> { return this.tx(actor,client=>this.folders(client,actor.spaceId)) }
  private checkFolderType(folders:ContentFolder[],folderId:string|null,definitionId:string) {
    const folder=folders.find(item=>item.id===folderId)
    if(folderId && !folder)throw new StorypaneError('not_found','Folder not found in this space')
    if(folder?.allowedDefinitionIds.length && !folder.allowedDefinitionIds.includes(definitionId))throw new StorypaneError('invalid',`${folder.name} does not allow this content type`)
  }
  private async validateFolderTree(client:PoolClient,actor:Actor,folders:ContentFolder[]) {
    const locales=(await client.query('SELECT id,slug FROM space_locales WHERE space_id=$1',[actor.spaceId])).rows
    const definitions=(await this.deployedMigration(client,actor.spaceId)).definitions
    for(const folder of folders) {
      if(Object.keys(folder.localeSlugs).some(id=>!locales.some(locale=>locale.id===id && locale.slug!=='')))throw new StorypaneError('invalid','Folder translations must use configured non-default locales from this space')
      for(const id of [...folder.allowedDefinitionIds,...(folder.defaultDefinitionId ? [folder.defaultDefinitionId] : [])]) {
        if(!definitions.some(definition=>definition.id===id && definition.kind!=='nestable'))throw new StorypaneError('invalid','Choose content types from this space')
      }
      if(folder.defaultDefinitionId)this.checkFolderType(folders,folder.id,folder.defaultDefinitionId)
    }
    for(const locale of locales) {
      const paths=new Set<string>()
      for(const folder of folders) {
        const path=folderPath(folders,folder.id,locale.id)
        if(path.length>1800 || paths.has(path))throw new StorypaneError('invalid','Folder paths must be unique in each locale and shorter than 1,800 characters')
        paths.add(path)
      }
    }
  }
  private async refreshPaths(client:PoolClient,actor:Actor,folders:ContentFolder[],forceStoryId?:string) {
    const locales=(await client.query('SELECT l.* FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 ORDER BY l.id FOR UPDATE OF l',[actor.spaceId])).rows
    const stories=(await client.query("SELECT s.*,v.definition_id FROM stories s LEFT JOIN story_locales l ON l.story_id=s.id AND l.slug='' LEFT JOIN block_drafts b ON b.id=l.root_block_id LEFT JOIN definition_versions v ON v.id=b.schema_version_id WHERE s.space_id=$1",[actor.spaceId])).rows
    const paths=new Set<string>()
    for(const story of stories) {
      this.checkFolderType(folders,story.folder_id,story.definition_id)
      const path=joinPath(folderPath(folders,story.folder_id),story.slug_segment ?? story.slug)
      if(path.length>2048)throw new StorypaneError('invalid','Page paths cannot exceed 2,048 characters')
      if(path!==story.slug)await client.query('UPDATE stories SET slug=$2 WHERE id=$1',[story.id,path])
    }
    for(const locale of locales) {
      const story=stories.find(item=>item.id===locale.story_id)!
      const path=joinPath(folderPath(folders,story.folder_id,locale.space_locale_id),locale.slug_segment ?? locale.url_slug)
      const key=`${locale.space_locale_id}:${path}`
      if(path.length>2048 || paths.has(key))throw new StorypaneError('invalid','Each page needs a unique path in its locale, up to 2,048 characters')
      paths.add(key)
      if(path!==locale.url_slug || story.id===forceStoryId) {
        await client.query('UPDATE story_locales SET url_slug=$2 WHERE id=$1',[locale.id,path])
        await this.checkpoint(client,actor,story.id,locale.id,'Update page path')
      }
    }
  }
  async saveFolder(actor:Actor,raw:unknown,folderId?:string):Promise<ContentFolder> {
    const input=parseInput(folderInputSchema,raw)
    if(folderId)parseInput(z.uuid(),folderId)
    return this.tx(actor,async client=>{
      await this.lockPaths(client,actor.spaceId)
      const folders=await this.folders(client,actor.spaceId)
      if(folderId && !folders.some(folder=>folder.id===folderId))throw new StorypaneError('not_found','Folder not found')
      const folder:ContentFolder={...input,id:folderId ?? randomUUID()}
      const next=[...folders.filter(item=>item.id!==folder.id),folder]
      await this.validateFolderTree(client,actor,next)
      await client.query(`INSERT INTO content_folders(id,space_id,name,slug,parent_id,locale_slugs,allowed_definition_ids,default_definition_id,form_only) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET name=$3,slug=$4,parent_id=$5,locale_slugs=$6,allowed_definition_ids=$7,default_definition_id=$8,form_only=$9`,[folder.id,actor.spaceId,input.name,input.slug,input.parentId,JSON.stringify(input.localeSlugs),input.allowedDefinitionIds,input.defaultDefinitionId,input.formOnly])
      if(folderId)await this.refreshPaths(client,actor,next)
      return folder
    },'content:edit')
  }
  async deleteFolder(actor:Actor,folderId:string):Promise<void> {
    parseInput(z.uuid(),folderId)
    return this.tx(actor,async client=>{
      await this.lockPaths(client,actor.spaceId)
      if(!(await client.query('SELECT id FROM content_folders WHERE id=$1 AND space_id=$2',[folderId,actor.spaceId])).rowCount)throw new StorypaneError('not_found','Folder not found')
      if((await client.query('SELECT id FROM content_folders WHERE parent_id=$1 UNION ALL SELECT id FROM stories WHERE folder_id=$1',[folderId])).rowCount)throw new StorypaneError('invalid','Move the pages and subfolders out before deleting this folder')
      await client.query('DELETE FROM content_folders WHERE id=$1',[folderId])
    },'content:edit')
  }
  async updateStoryLocation(actor:Actor,storyId:string,raw:unknown):Promise<Story> {
    parseInput(z.uuid(),storyId)
    const input=parseInput(storyLocationSchema,raw)
    return this.tx(actor,async client=>{
      await this.lockPaths(client,actor.spaceId)
      if(!(await client.query('SELECT id FROM stories WHERE id=$1 AND space_id=$2',[storyId,actor.spaceId])).rowCount)throw new StorypaneError('not_found','Story not found')
      const locales=(await client.query('SELECT l.* FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 ORDER BY l.id FOR UPDATE OF l',[actor.spaceId])).rows.filter(locale=>locale.story_id===storyId)
      if(Object.keys(input.localeSlugs).some(id=>!locales.some(locale=>locale.space_locale_id===id && locale.slug!=='')))throw new StorypaneError('invalid','Only existing page locales can have translated page slugs')
      const folders=await this.folders(client,actor.spaceId)
      folderPath(folders,input.folderId)
      await client.query('UPDATE stories SET folder_id=$2,slug_segment=$3 WHERE id=$1',[storyId,input.folderId,input.slug])
      for(const locale of locales)await client.query('UPDATE story_locales SET slug_segment=$2 WHERE id=$1',[locale.id,locale.slug==='' ? input.slug : input.localeSlugs[locale.space_locale_id] ?? locale.slug_segment ?? locale.url_slug])
      await this.refreshPaths(client,actor,folders,storyId)
      return storyRow((await client.query('SELECT s.*,f.form_only FROM stories s LEFT JOIN content_folders f ON f.id=s.folder_id WHERE s.id=$1',[storyId])).rows[0])
    },'content:edit')
  }
  async listStories(actor: Actor): Promise<StorySummary[]> {
    return this.tx(actor, async client => (await client.query(`SELECT s.*,f.form_only,u.name AS editor_name,v.definition_id AS content_type_id,v.schema->>'displayName' AS content_type_name,
      EXISTS(SELECT 1 FROM story_pins pin WHERE pin.story_id=s.id AND pin.user_id=$2) AS pinned,
      count(l.id)::integer AS locale_count,count(p.id)::integer AS published_count,
      (count(l.id) FILTER (WHERE p.id IS NULL OR c.content IS DISTINCT FROM p.content OR coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug) IS DISTINCT FROM l.url_slug))::integer AS pending_count
      FROM stories s LEFT JOIN story_locales l ON l.story_id=s.id LEFT JOIN checkpoints c ON c.id=l.checkpoint_id
      LEFT JOIN publications p ON p.id=l.published_version_id LEFT JOIN "user" u ON u.id=s.updated_by
      LEFT JOIN story_locales base ON base.story_id=s.id AND base.slug=''
      LEFT JOIN block_drafts root ON root.id=base.root_block_id AND root.locale_id=base.id
      LEFT JOIN definition_versions v ON v.id=root.schema_version_id
      LEFT JOIN content_folders f ON f.id=s.folder_id
      WHERE s.space_id=$1 GROUP BY s.id,u.id,v.id,f.id ORDER BY pinned DESC,s.updated_at DESC,s.id`, [actor.spaceId,actor.userId])).rows.map(row => ({
        ...storyRow(row),pinned:row.pinned,localeCount:row.locale_count,pendingLocaleCount:row.pending_count,publicationStatus:!row.published_count ? 'draft' : row.pending_count ? 'changed' : 'published',
        modifiedBy:row.updated_by ? {id:row.updated_by,name:row.editor_name ?? 'Unknown editor'} : null,
        contentType:row.content_type_id ? {id:row.content_type_id,name:row.content_type_name} : null,
      })))
  }
  async setStoryPinned(actor:Actor,storyId:string,pinned:boolean):Promise<void> {
    const id=parseInput(z.uuid(),storyId)
    return this.tx(actor,async client=>{
      const story=await client.query('SELECT id FROM stories WHERE id=$1 AND space_id=$2 FOR KEY SHARE',[id,actor.spaceId])
      if(!story.rowCount)throw new StorypaneError('not_found','Story not found in this space')
      if(pinned)await client.query('INSERT INTO story_pins(user_id,story_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.userId,id])
      else await client.query('DELETE FROM story_pins WHERE user_id=$1 AND story_id=$2',[actor.userId,id])
    })
  }
  async getStory(actor: Actor, storyId: string): Promise<Story> {
    const id = parseInput(z.uuid(), storyId)
    return this.tx(actor, async client => {
      const result = await client.query('SELECT s.*,f.form_only FROM stories s LEFT JOIN content_folders f ON f.id=s.folder_id WHERE s.id=$1 AND s.space_id=$2', [id, actor.spaceId])
      if (!result.rowCount) throw new StorypaneError('not_found', 'Story not found in this space')
      return storyRow(result.rows[0])
    })
  }
  async createStory(actor: Actor, value: unknown): Promise<LocaleSnapshot> {
    const input = parseInput(storyInputSchema, value)
    return this.tx(actor, async client => {
      await this.authorize(client, actor, 'content:edit')
      const definition = await this.currentDefinition(client, actor, input.definitionId)
      if (definition.kind === 'nestable') throw new StorypaneError('invalid', 'A story requires a content-type or universal block')
      await this.lockPaths(client,actor.spaceId)
      const folders=await this.folders(client,actor.spaceId)
      this.checkFolderType(folders,input.folderId,input.definitionId)
      const path=joinPath(folderPath(folders,input.folderId),input.slug)
      if(path.length>2048)throw new StorypaneError('invalid','Page paths cannot exceed 2,048 characters')
      const story = await client.query('INSERT INTO stories(space_id,name,slug,slug_segment,folder_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [actor.spaceId, input.name, path,input.slug,input.folderId])
      const rootId = randomUUID()
      const locale = await client.query("INSERT INTO story_locales(story_id,slug,name,url_slug,slug_segment,root_block_id,space_locale_id) SELECT $1,c.slug,c.name,$2,$5,$3,c.id FROM space_locales c WHERE c.space_id=$4 AND c.slug='' RETURNING id", [story.rows[0].id, path, rootId, actor.spaceId,input.slug])
      await client.query('INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)', [rootId, locale.rows[0].id, definition.versionId, JSON.stringify(defaultFields(definition))])
      return this.checkpoint(client, actor, story.rows[0].id, locale.rows[0].id, 'Create story')
    })
  }
  async listLocales(actor: Actor, storyId: string): Promise<StoryLocale[]> { return this.tx(actor, async client => {
    const story = await client.query('SELECT id FROM stories WHERE id=$1 AND space_id=$2', [storyId, actor.spaceId]); if (!story.rowCount) throw new StorypaneError('not_found', 'Story not found')
    return (await client.query("SELECT * FROM story_locales WHERE story_id=$1 ORDER BY (slug='') DESC,name", [storyId])).rows.map(localeRow)
  }) }
  async createLocale(actor: Actor, storyId: string, value: unknown): Promise<LocaleSnapshot> {
    const input = parseInput(localeInputSchema, value)
    return this.tx(actor, async client => {
      await this.authorize(client, actor, 'content:edit')
      await this.lockPaths(client,actor.spaceId)
      const configured = await client.query('SELECT * FROM space_locales WHERE id=$1 AND space_id=$2 FOR UPDATE', [input.spaceLocaleId,actor.spaceId])
      if (!configured.rows[0]) throw new StorypaneError('not_found', 'Configure this locale in Space settings first')
      if (!(await client.query('SELECT id FROM stories WHERE id=$1 AND space_id=$2', [storyId,actor.spaceId])).rowCount) throw new StorypaneError('not_found', 'Story not found')
      const existing = await client.query('SELECT id FROM story_locales WHERE story_id=$1 AND space_locale_id=$2', [storyId,input.spaceLocaleId])
      if (existing.rows[0]) { await this.lockLocale(client,actor,storyId,existing.rows[0].id); return this.snapshot(client,actor,storyId,existing.rows[0].id) }
      const original = await client.query("SELECT l.*,s.folder_id,b.schema_version_id FROM story_locales l JOIN stories s ON s.id=l.story_id JOIN block_drafts b ON b.id=l.root_block_id AND b.locale_id=l.id WHERE s.id=$1 AND s.space_id=$2 AND l.slug=''", [storyId, actor.spaceId])
      if (!original.rowCount) throw new StorypaneError('not_found', 'Story not found')
      const rootId = randomUUID()
      const segment=input.urlSlug ?? original.rows[0].slug_segment ?? original.rows[0].url_slug
      const path=joinPath(folderPath(await this.folders(client,actor.spaceId),original.rows[0].folder_id,input.spaceLocaleId),segment)
      if(path.length>2048 || (await client.query('SELECT id FROM story_locales WHERE space_locale_id=$1 AND url_slug=$2',[input.spaceLocaleId,path])).rowCount)throw new StorypaneError('invalid','This locale already has that page path, or the path exceeds 2,048 characters')
      const locale = await client.query('INSERT INTO story_locales(story_id,slug,name,url_slug,root_block_id,space_locale_id,slug_segment) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [storyId, configured.rows[0].slug, configured.rows[0].name, path, rootId,input.spaceLocaleId,segment])
      const version = await client.query('SELECT schema FROM definition_versions WHERE id=$1', [original.rows[0].schema_version_id])
      await client.query('INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)', [rootId, locale.rows[0].id, original.rows[0].schema_version_id, JSON.stringify(defaultFields(version.rows[0].schema))])
      return this.checkpoint(client, actor, storyId, locale.rows[0].id, 'Create locale')
    })
  }
  async getSnapshot(actor: Actor, storyId: string, localeId: string): Promise<LocaleSnapshot> { return this.tx(actor, async client => { await this.lockLocale(client, actor, storyId, localeId); return this.snapshot(client, actor, storyId, localeId) }) }
  async listCheckpoints(actor: Actor, storyId: string, localeId: string): Promise<Checkpoint[]> { return this.tx(actor, async client => { await this.lockLocale(client, actor, storyId, localeId); return (await client.query('SELECT id,revision,reason,actor_id,created_at FROM checkpoints WHERE locale_id=$1 ORDER BY revision DESC LIMIT 100', [localeId])).rows.map(checkpointRow) }) }
  async getCheckpoint(actor: Actor, storyId: string, localeId: string, checkpointId: string): Promise<CheckpointDetail> { return this.tx(actor, async client => { await this.lockLocale(client, actor, storyId, localeId); return this.readCheckpoint(client, localeId, checkpointId) }) }
  private async readCheckpoint(client: PoolClient, localeId: string, checkpointId: string): Promise<CheckpointDetail> {
    const result = await client.query('SELECT * FROM checkpoints WHERE id=$1 AND locale_id=$2', [checkpointId, localeId]); if (!result.rowCount) throw new StorypaneError('not_found', 'Checkpoint not found')
    return { ...checkpointRow(result.rows[0]), snapshot: result.rows[0].snapshot, content: result.rows[0].content }
  }
  async acquireLease(actor: Actor, storyId: string, localeId: string, blockId: string): Promise<Lease> {
    return this.tx(actor, async client => {
      await this.authorize(client, actor, 'content:edit')
      await this.lockLocale(client, actor, storyId, localeId)
      if (!(await client.query('SELECT id FROM block_drafts WHERE id=$1 AND locale_id=$2', [blockId, localeId])).rowCount) throw new StorypaneError('not_found', 'Block not found')
      const lease = await client.query('SELECT *,expires_at>clock_timestamp() AS active FROM edit_leases WHERE locale_id=$1 AND block_id=$2 FOR UPDATE', [localeId, blockId])
      const old = lease.rows[0]
      if (old?.active && (old.user_id !== actor.userId || old.session_id !== actor.sessionId)) throw new StorypaneError('locked', 'This block is being edited by someone else')
      const token = old?.active ? old.token : randomUUID()
      const updated = await client.query(`INSERT INTO edit_leases(locale_id,block_id,user_id,session_id,token,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '${LEASE_SECONDS} seconds') ON CONFLICT(locale_id,block_id) DO UPDATE SET user_id=EXCLUDED.user_id,session_id=EXCLUDED.session_id,token=EXCLUDED.token,expires_at=EXCLUDED.expires_at RETURNING *`, [localeId, blockId, actor.userId, actor.sessionId, token])
      return { blockId, userId: actor.userId, sessionId: actor.sessionId, token, expiresAt: iso(updated.rows[0].expires_at) }
    })
  }
  async renewLease(actor: Actor, storyId: string, localeId: string, blockId: string, token: string): Promise<Lease> {
    return this.tx(actor, async client => {
      await this.authorize(client, actor, 'content:edit')
      await this.lockLocale(client, actor, storyId, localeId)
      const result = await client.query(`UPDATE edit_leases SET expires_at=clock_timestamp()+interval '${LEASE_SECONDS} seconds' WHERE locale_id=$1 AND block_id=$2 AND user_id=$3 AND session_id=$4 AND token=$5 AND expires_at>clock_timestamp() RETURNING *`, [localeId, blockId, actor.userId, actor.sessionId, token])
      if (!result.rowCount) throw new StorypaneError('locked', 'Your editing lease expired; reconnect before editing')
      return { blockId, userId: actor.userId, sessionId: actor.sessionId, token, expiresAt: iso(result.rows[0].expires_at) }
    })
  }
  async releaseLease(actor: Actor, storyId: string, localeId: string, blockId: string, token: string): Promise<void> { await this.tx(actor, async client => { await this.lockLocale(client, actor, storyId, localeId); await client.query('DELETE FROM edit_leases WHERE locale_id=$1 AND block_id=$2 AND user_id=$3 AND session_id=$4 AND token=$5', [localeId, blockId, actor.userId, actor.sessionId, token]) }) }

  private async requireLease(client: PoolClient, actor: Actor, localeId: string, block: BlockDraft, command: Command): Promise<void> {
    if (command.expectedRevisions[block.id] !== block.revision) throw new StorypaneError('stale_revision', 'This block changed; review the latest version before retrying')
    const token = command.leaseTokens[block.id]
    if (!token || !z.uuid().safeParse(token).success) throw new StorypaneError('locked', 'Acquire this block before editing')
    const lease = await client.query('SELECT block_id FROM edit_leases WHERE locale_id=$1 AND block_id=$2 AND user_id=$3 AND session_id=$4 AND token=$5 AND expires_at>clock_timestamp()', [localeId, block.id, actor.userId, actor.sessionId, token])
    if (!lease.rowCount) throw new StorypaneError('locked', 'Your editing lease expired; reconnect before editing')
  }
  private async noCompetingLeases(client: PoolClient, actor: Actor, localeId: string, blockIds: string[]): Promise<void> {
    const result = await client.query('SELECT block_id FROM edit_leases WHERE locale_id=$1 AND block_id=ANY($2::uuid[]) AND expires_at>clock_timestamp() AND (user_id<>$3 OR session_id<>$4)', [localeId, blockIds, actor.userId, actor.sessionId])
    if (result.rowCount) throw new StorypaneError('locked', 'Another editor is working in the affected subtree')
  }
  private nestingField(snapshot: LocaleSnapshot, parent: BlockDraft, fieldName: string, definition: BlockDefinition): Extract<FieldDefinition, { type: 'blocks' }> {
    const parentDefinition = snapshot.definitions.find(d => d.versionId === parent.schemaVersionId)!
    const field = parentDefinition.fields.find(f => f.name === fieldName)
    if (!field || field.type !== 'blocks') throw new StorypaneError('invalid', 'Select a Blocks field')
    if (!isBlockAllowed(field, definition)) throw new StorypaneError('invalid', 'This block type is not allowed here')
    return field
  }
  private async validateReferences(client: PoolClient, actor: Actor, schema: DefinitionInput, fields: Record<string, Json>): Promise<void> {
    for (const field of schema.fields) {
      const value = fields[field.name]
      if (value === null || value === undefined || value === '') continue
      const assetId = field.type === 'asset' ? (value as { assetId: string }).assetId : field.type === 'link' && (value as { type: string }).type === 'asset' ? (value as { assetId: string }).assetId : undefined
      if (assetId) {
        const asset = (await client.query('SELECT mime_type FROM assets WHERE id=$1 AND space_id=$2', [assetId, actor.spaceId])).rows[0]
        if (!asset) throw new StorypaneError('invalid', 'Asset must belong to this space')
        if (field.type === 'asset' && field.mimeTypes?.length && !field.mimeTypes.some(allowed => {
          const mime = String(asset.mime_type).toLowerCase()
          const restriction = allowed.toLowerCase()
          return restriction.endsWith('/*') ? mime.startsWith(restriction.slice(0, -1)) : mime === restriction
        })) throw new StorypaneError('invalid', `${field.label} does not allow this asset type`)
      }
      const storyIds = field.type === 'link' && (value as { type: string }).type === 'story' ? [(value as { storyId: string }).storyId] : (field.type === 'option' || field.type === 'options') && field.source.type === 'stories' ? (Array.isArray(value) ? value : [value]) : []
      if (storyIds.length) {
        if (!storyIds.every(v => typeof v === 'string' && z.uuid().safeParse(v).success)) throw new StorypaneError('invalid', 'Expected story IDs')
        const stories = await client.query('SELECT id FROM stories WHERE space_id=$1 AND id=ANY($2::uuid[])', [actor.spaceId, storyIds])
        if (stories.rowCount !== new Set(storyIds).size) throw new StorypaneError('invalid', 'Story references must belong to this space')
      }
    }
  }
  private async validateSnapshot(client: PoolClient, actor: Actor, snapshot: LocaleSnapshot, publish: boolean): Promise<void> {
    const issues = []
    const root=snapshot.blocks.find(block=>block.id===snapshot.locale.rootBlockId)
    if(!root || snapshot.definitions.find(definition=>definition.versionId===root.schemaVersionId)?.kind==='nestable')throw new StorypaneError('invalid','The root must use a content type or universal schema')
    for (const block of snapshot.blocks) {
      const definition = snapshot.definitions.find(d => d.versionId === block.schemaVersionId)!
      issues.push(...validateFields(definition, block.fields, publish).map(i => ({ ...i, path: `${block.id}.${i.path}` })))
      for (const field of definition.fields.filter(f => f.type === 'blocks')) {
        const children = snapshot.blocks.filter(b => b.parentId === block.id && b.parentField === field.name)
        if (publish && (field.required || field.minItems) && children.length < Math.max(field.required ? 1 : 0, field.minItems ?? 0)) issues.push({ path: `${block.id}.${field.name}`, message: `Requires at least ${Math.max(field.required ? 1 : 0, field.minItems ?? 0)} blocks` })
        if (field.maxItems !== undefined && children.length > field.maxItems) issues.push({ path: `${block.id}.${field.name}`, message: `Allows at most ${field.maxItems} blocks` })
        for (const child of children) this.nestingField(snapshot, block, field.name, snapshot.definitions.find(d => d.versionId === child.schemaVersionId)!)
      }
      await this.validateReferences(client, actor, definition, block.fields)
    }
    if (issues.length) throw new StorypaneError('invalid', publish ? 'Resolve validation errors before publishing' : 'Invalid field values', issues)
    assembleContent(snapshot)
  }
  private async normalizePositions(client: PoolClient, localeId: string, parentId: string, field: string, orderedIds?: string[]): Promise<void> {
    const ids = orderedIds ?? (await client.query('SELECT id FROM block_drafts WHERE locale_id=$1 AND parent_id=$2 AND parent_field=$3 ORDER BY position,id', [localeId, parentId, field])).rows.map(r => r.id)
    for (let i = 0; i < ids.length; i++) await client.query('UPDATE block_drafts SET position=$3 WHERE locale_id=$1 AND id=$2', [localeId, ids[i], i])
    await client.query('UPDATE block_drafts SET revision=revision+1 WHERE locale_id=$1 AND id=$2', [localeId, parentId])
  }
  async command(actor: Actor, storyId: string, localeId: string, value: unknown): Promise<CommitResult> {
    const command = parseInput(commandSchema, value)
    const hash = createHash('sha256').update(canonical({ command, userId: actor.userId, sessionId: actor.sessionId })).digest('hex')
    return this.tx(actor, async client => {
      await this.authorize(client, actor, command.type === 'publishCheckpoint' ? 'content:publish' : 'content:edit')
      if(command.type==='publishCheckpoint')await this.lockPaths(client,actor.spaceId)
      await this.lockLocale(client, actor, storyId, localeId)
      const deployed=await this.deployedMigration(client,actor.spaceId)
      if(command.migrationVersion!==undefined && command.migrationVersion!==deployed.version)throw new StorypaneError('stale_revision','A schema migration was deployed. Sync before applying your preserved edits.')
      const receipt = await client.query('SELECT * FROM mutation_receipts WHERE locale_id=$1 AND mutation_id=$2', [localeId, command.mutationId])
      if (receipt.rowCount) {
        const previous = receipt.rows[0]
        if (previous.actor_id !== actor.userId || previous.request_hash !== hash) throw new StorypaneError('invalid', 'Mutation ID was already used for a different request')
        const checkpoint = await this.readCheckpoint(client, localeId, previous.checkpoint_id)
        if((checkpoint.snapshot.migrationVersion ?? 0)!==deployed.version)throw new StorypaneError('stale_revision','This change was committed before a schema migration. Sync to review the current content.')
        return { mutationId: command.mutationId, localeRevision: checkpoint.revision, changedBlockIds: previous.changed_block_ids, checkpointId: checkpoint.id, snapshot: checkpoint.snapshot, ...(previous.publication_id ? { publicationId: previous.publication_id } : {}) }
      }
      const before = await this.snapshot(client, actor, storyId, localeId)
      const changed = new Set<string>()
      let publicationId: string | undefined
      const requireOwned = (block: BlockDraft) => this.requireLease(client, actor, localeId, block, command)
      if (command.type === 'saveBlock') {
        const block = requireBlock(before, command.payload.blockId)
        await requireOwned(block)
        const definition = before.definitions.find(d => d.versionId === block.schemaVersionId)!
        const issues = validateFields(definition, command.payload.fields)
        if (issues.length) throw new StorypaneError('invalid', 'Invalid field values', issues)
        await this.validateReferences(client, actor, definition, command.payload.fields)
        await client.query('UPDATE block_drafts SET fields=$3,revision=revision+1 WHERE locale_id=$1 AND id=$2', [localeId, block.id, JSON.stringify(command.payload.fields)])
        changed.add(block.id)
      } else if (command.type === 'insertBlock') {
        const parent = requireBlock(before, command.payload.parentId)
        await requireOwned(parent)
        const definition = await this.currentDefinition(client, actor, command.payload.definitionId)
        this.nestingField(before, parent, command.payload.parentField, definition)
        const id = randomUUID()
        const siblings = before.blocks.filter(b => b.parentId === parent.id && b.parentField === command.payload.parentField).sort((a, b) => a.position - b.position).map(b => b.id)
        const position = command.payload.position ?? siblings.length
        if (position > siblings.length) throw new StorypaneError('invalid', 'Invalid insertion position')
        siblings.splice(position, 0, id)
        await client.query('INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,fields) VALUES($1,$2,$3,$4,$5,$6)', [id, localeId, definition.versionId, parent.id, command.payload.parentField, JSON.stringify(defaultFields(definition))])
        await this.normalizePositions(client, localeId, parent.id, command.payload.parentField, siblings)
        changed.add(parent.id); changed.add(id)
      } else if (command.type === 'moveBlock') {
        const block = requireBlock(before, command.payload.blockId)
        if (!block.parentId || !block.parentField) throw new StorypaneError('invalid', 'The root block cannot be moved')
        const oldParent = requireBlock(before, block.parentId)
        const parent = requireBlock(before, command.payload.parentId)
        await requireOwned(block); await requireOwned(oldParent); if (parent.id !== oldParent.id) await requireOwned(parent)
        const affected = subtree(before, block.id)
        await this.noCompetingLeases(client, actor, localeId, affected.map(b => b.id))
        if (affected.some(b => b.id === parent.id)) throw new StorypaneError('invalid', 'A block cannot contain itself')
        this.nestingField(before, parent, command.payload.parentField, before.definitions.find(d => d.versionId === block.schemaVersionId)!)
        const siblings = before.blocks.filter(b => b.parentId === parent.id && b.parentField === command.payload.parentField && b.id !== block.id).sort((a, b) => a.position - b.position).map(b => b.id)
        if (command.payload.position > siblings.length) throw new StorypaneError('invalid', 'Invalid move position')
        siblings.splice(command.payload.position, 0, block.id)
        await client.query('UPDATE block_drafts SET parent_id=$3,parent_field=$4,revision=revision+1 WHERE locale_id=$1 AND id=$2', [localeId, block.id, parent.id, command.payload.parentField])
        if (oldParent.id !== parent.id || block.parentField !== command.payload.parentField) await this.normalizePositions(client, localeId, oldParent.id, block.parentField)
        await this.normalizePositions(client, localeId, parent.id, command.payload.parentField, siblings)
        changed.add(block.id); changed.add(parent.id); changed.add(oldParent.id)
      } else if (command.type === 'deleteBlock') {
        const block = requireBlock(before, command.payload.blockId)
        if (!block.parentId || !block.parentField) throw new StorypaneError('invalid', 'The root block cannot be deleted')
        await requireOwned(block); await requireOwned(requireBlock(before, block.parentId))
        const affected = subtree(before, block.id)
        await this.noCompetingLeases(client, actor, localeId, affected.map(b => b.id))
        await client.query('DELETE FROM block_drafts WHERE locale_id=$1 AND id=$2', [localeId, block.id])
        await this.normalizePositions(client, localeId, block.parentId, block.parentField)
        affected.forEach(b => changed.add(b.id)); changed.add(block.parentId)
      } else if (command.type === 'importBlocks') {
        const parent = requireBlock(before, command.payload.parentId)
        await requireOwned(parent)
        if (command.payload.sourceLocaleId === localeId || before.locale.slug === '') throw new StorypaneError('invalid', 'Import from Default into another locale')
        await this.lockLocale(client, actor, storyId, command.payload.sourceLocaleId)
        const source = await this.snapshot(client, actor, storyId, command.payload.sourceLocaleId)
        if (source.locale.slug !== '') throw new StorypaneError('invalid', 'Only Default can be used as an import source')
        const selected = new Set(command.payload.blockIds)
        const roots = command.payload.blockIds.filter(id => { let current = requireBlock(source, id); while (current.parentId) { if (selected.has(current.parentId)) return false; current = requireBlock(source, current.parentId) } return true })
        let position = before.blocks.filter(b => b.parentId === parent.id && b.parentField === command.payload.parentField).length
        for (const rootId of roots) {
          const root = requireBlock(source, rootId)
          this.nestingField(before, parent, command.payload.parentField, source.definitions.find(d => d.versionId === root.schemaVersionId)!)
          const items = subtree(source, rootId)
          const ids = new Map(items.map(b => [b.id, randomUUID()]))
          for (const block of items) {
            const id = ids.get(block.id)!
            await client.query('INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, localeId, block.schemaVersionId, block.id === rootId ? parent.id : ids.get(block.parentId!)!, block.id === rootId ? command.payload.parentField : block.parentField, block.id === rootId ? position++ : block.position, JSON.stringify(block.fields)])
            changed.add(id)
          }
        }
        await this.normalizePositions(client, localeId, parent.id, command.payload.parentField)
        changed.add(parent.id)
      } else if (command.type === 'restoreBlock') {
        const block = requireBlock(before, command.payload.blockId)
        if (!block.parentId) throw new StorypaneError('invalid', 'Use page restore to restore the root block and its descendants')
        await requireOwned(block)
        const current = subtree(before, block.id)
        await this.noCompetingLeases(client, actor, localeId, current.map(b => b.id))
        const historical = await this.readCheckpoint(client, localeId, command.payload.checkpointId)
        historical.snapshot=await this.restoreMigrationSnapshot(client,actor,historical.snapshot)
        const restored = subtree(historical.snapshot, block.id)
        if (block.parentId) {
          const parent = requireBlock(before, block.parentId)
          this.nestingField(before, parent, block.parentField!, historical.snapshot.definitions.find(d => d.versionId === restored[0].schemaVersionId)!)
        }
        const removedIds = new Set(current.map(b => b.id))
        const ids = new Map(restored.map(b => [b.id, before.blocks.some(existing => existing.id === b.id && !removedIds.has(existing.id)) ? randomUUID() : b.id]))
        await client.query('DELETE FROM block_drafts WHERE locale_id=$1 AND id=$2', [localeId, block.id])
        for (const old of restored) {
          const id = ids.get(old.id)!
          const previous = before.blocks.find(b => b.id === old.id)
          await client.query('INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, localeId, old.schemaVersionId, old.id === block.id ? block.parentId : ids.get(old.parentId!)!, old.id === block.id ? block.parentField : old.parentField, old.id === block.id ? block.position : old.position, JSON.stringify(old.fields), (previous?.revision ?? old.revision) + 1])
          changed.add(id)
        }
        current.forEach(b => changed.add(b.id))
      } else if (command.type === 'restorePage') {
        await requireOwned(requireBlock(before, before.locale.rootBlockId))
        if (command.expectedRevisions.$locale !== before.revision) throw new StorypaneError('stale_revision', 'The page changed; review it before restoring')
        await this.noCompetingLeases(client, actor, localeId, before.blocks.map(b => b.id))
        const historical = await this.readCheckpoint(client, localeId, command.payload.checkpointId)
        historical.snapshot=await this.restoreMigrationSnapshot(client,actor,historical.snapshot)
        await client.query('DELETE FROM block_drafts WHERE locale_id=$1', [localeId])
        for (const block of historical.snapshot.blocks) {
          await client.query('INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [block.id, localeId, block.schemaVersionId, block.parentId, block.parentField, block.position, JSON.stringify(block.fields), Math.max(block.revision, before.blocks.find(b => b.id === block.id)?.revision ?? 0) + 1])
          changed.add(block.id)
        }
        before.blocks.forEach(b => changed.add(b.id))
        await client.query('UPDATE story_locales SET root_block_id=$2 WHERE id=$1', [localeId, historical.snapshot.locale.rootBlockId])
      } else if (command.type === 'publishCheckpoint') {
        const historical = await this.readCheckpoint(client, localeId, command.payload.checkpointId)
        if((historical.snapshot.migrationVersion ?? 0)!==deployed.version)throw new StorypaneError('invalid','Restore this checkpoint under the current schema before publishing it.')
        const collision=await client.query("SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id JOIN publications p ON p.id=l.published_version_id WHERE s.space_id=$1 AND l.space_locale_id=$2 AND l.id<>$3 AND coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug)=$4",[actor.spaceId,before.locale.spaceLocaleId,localeId,historical.snapshot.locale.urlSlug])
        if(collision.rowCount)throw new StorypaneError('invalid','Another page still publishes this URL. Republish it at its new URL first.')
        await this.validateSnapshot(client, actor, historical.snapshot, true)
        publicationId = randomUUID()
        await client.query('INSERT INTO publications(id,locale_id,checkpoint_id,revision,actor_id,content,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)', [publicationId, localeId, historical.id, historical.revision, actor.userId, JSON.stringify(historical.content), JSON.stringify(historical.snapshot)])
        await client.query('UPDATE story_locales SET published_version_id=$2 WHERE id=$1', [localeId, publicationId])
      }
      const after = await this.snapshot(client, actor, storyId, localeId)
      await this.validateSnapshot(client, actor, after, false)
      if (after.blocks.length > 1000) throw new StorypaneError('invalid', 'A locale supports at most 1,000 blocks')
      const snapshot = await this.checkpoint(client, actor, storyId, localeId, command.type)
      await client.query('INSERT INTO mutation_receipts(locale_id,mutation_id,actor_id,request_hash,checkpoint_id,changed_block_ids,publication_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [localeId, command.mutationId, actor.userId, hash, snapshot.checkpointId, JSON.stringify([...changed]), publicationId ?? null])
      return { mutationId: command.mutationId, localeRevision: snapshot.revision, changedBlockIds: [...changed], checkpointId: snapshot.checkpointId!, snapshot, ...(publicationId ? { publicationId } : {}) }
    })
  }
  async getPublication(actor: Actor, storyId: string, localeId: string): Promise<Publication | null> {
    return this.tx(actor, async client => {
      await this.lockLocale(client, actor, storyId, localeId)
      const result = await client.query('SELECT p.* FROM publications p JOIN story_locales l ON l.published_version_id=p.id WHERE l.id=$1', [localeId])
      if (!result.rowCount) return null
      const r = result.rows[0]
      return { id: r.id, checkpointId: r.checkpoint_id, revision: Number(r.revision), createdAt: iso(r.created_at), content: r.content }
    })
  }
  async getPublished(actor: Actor, storyId: string, localeId: string): Promise<Publication | null> { return this.getPublication(actor, storyId, localeId) }
  async listDatasources(actor: Actor): Promise<Datasource[]> { return this.tx(actor, async client => (await client.query('SELECT id,name,slug,items FROM datasources WHERE space_id=$1 ORDER BY name', [actor.spaceId])).rows as Datasource[]) }
  async saveDatasource(actor: Actor, value: unknown, datasourceId?: string): Promise<Datasource> {
    const input = parseInput(datasourceInputSchema, value)
    return this.tx(actor, async client => {
      const result = datasourceId ? await client.query('UPDATE datasources SET name=$3,slug=$4,items=$5 WHERE id=$1 AND space_id=$2 RETURNING id,name,slug,items', [datasourceId, actor.spaceId, input.name, input.slug, JSON.stringify(input.items)]) : await client.query('INSERT INTO datasources(space_id,name,slug,items) VALUES($1,$2,$3,$4) RETURNING id,name,slug,items', [actor.spaceId, input.name, input.slug, JSON.stringify(input.items)])
      if (!result.rowCount) throw new StorypaneError('not_found', 'Datasource not found')
      return result.rows[0]
    }, 'datasources:write')
  }
  async resolveOptions(actor: Actor, value: unknown): Promise<OptionPage> {
    const input = parseInput(z.object({ source: optionSourceSchema, query: z.string().trim().max(200).optional(), values:z.array(z.string().max(500)).max(200).optional(), cursor: z.string().regex(/^\d{1,6}$/).optional() }).strict(), value)
    const start = input.values ? 0 : Number(input.cursor ?? 0)
    const limit = input.values ? 200 : 50
    const search = input.query?.toLocaleLowerCase() ?? ''
    if (input.source.type === 'external') {
      await this.assertActor(actor)
      const items = await fetchExternalOptions(input.source.url, this.options.externalOptionHosts ?? [])
      const filtered = items.filter(i => input.values ? input.values.includes(i.value) : i.label.toLocaleLowerCase().includes(search) || i.value.toLocaleLowerCase().includes(search))
      return { items: filtered.slice(start, start + limit), ...(filtered.length > start + limit ? { nextCursor: String(start + limit) } : {}) }
    }
    return this.tx(actor, async client => {
      if (input.source.type === 'stories') {
        const result = await client.query(`SELECT s.id AS value,s.name AS label,'/' || s.slug AS description FROM stories s WHERE s.space_id=$1 AND ($2='' OR s.name ILIKE '%' || $2 || '%' OR ('/' || s.slug) ILIKE '%' || $2 || '%' OR s.id::text=$2) AND ($5::text[] IS NULL OR s.id::text=ANY($5)) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM story_locales l JOIN block_drafts b ON b.id=l.root_block_id AND b.locale_id=l.id JOIN definition_versions v ON v.id=b.schema_version_id WHERE l.story_id=s.id AND l.slug='' AND v.definition_id=$3)) ORDER BY s.name,s.id LIMIT $6 OFFSET $4`, [actor.spaceId, search, input.source.contentTypeId ?? null, start, input.values ?? null, limit+1])
        return { items: result.rows.slice(0, limit), ...(result.rows.length > limit ? { nextCursor: String(start + limit) } : {}) }
      }
      let items = input.source.type === 'inline' ? input.source.items : []
      if (input.source.type === 'datasource') { const source = await client.query('SELECT items FROM datasources WHERE id=$1 AND space_id=$2', [input.source.datasourceId, actor.spaceId]); if (!source.rowCount) throw new StorypaneError('not_found', 'Datasource not found'); items = source.rows[0].items }
      const filtered = items.filter(i => input.values ? input.values.includes(i.value) : i.label.toLocaleLowerCase().includes(search) || i.value.toLocaleLowerCase().includes(search))
      return { items: filtered.slice(start, start + limit), ...(filtered.length > start + limit ? { nextCursor: String(start + limit) } : {}) }
    })
  }

  // Seed is only used by the explicit local setup script; it is never exposed by an HTTP route.
  async seed(actor: Actor): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,91))',[actor.spaceId])
      await client.query('INSERT INTO spaces(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [actor.spaceId, 'My space'])
      await client.query("INSERT INTO space_locales(space_id,name,slug) VALUES($1,'Default','') ON CONFLICT(space_id,slug) DO NOTHING", [actor.spaceId])
      await client.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT(space_id,user_id) DO NOTHING", [actor.spaceId, actor.userId])
      const definitions: DefinitionInput[] = [
        { name: 'hero', displayName: 'Hero', kind: 'nestable', fields: [{ name: 'title', label: 'Title', type: 'text', format: 'singleline', required: true, defaultValue: 'Build something worth sharing.' }, { name: 'description', label: 'Description', type: 'text', format: 'textarea', defaultValue: 'Your next story starts here.' }, { name: 'image', label: 'Image', type: 'asset' }] },
        { name: 'footer', displayName: 'Footer', kind: 'nestable', fields: [{ name: 'text', label: 'Footer text', type: 'text', format: 'singleline', defaultValue: 'Made with Storypane.' }, { name: 'link', label: 'Link', type: 'link' }] },
        { name: 'page', displayName: 'Page', kind: 'content-type', fields: [{ name: 'title', label: 'Page title', type: 'text', format: 'singleline', required: true, defaultValue: 'Home' }, { name: 'body', label: 'Body', type: 'blocks' }] },
      ]
      for(const definition of definitions)for(const field of definition.fields)field.id=randomUUID()
      const versions = new Map<string, string>()
      for (const definition of definitions) {
        const result = await client.query('INSERT INTO definitions(space_id,name) VALUES($1,$2) ON CONFLICT(space_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id,current_version', [actor.spaceId, definition.name])
        const version = await client.query('INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,1,$2) ON CONFLICT(definition_id,version) DO UPDATE SET definition_id=EXCLUDED.definition_id RETURNING id', [result.rows[0].id, JSON.stringify(definition)])
        versions.set(definition.name, version.rows[0].id)
      }
      if(!(await client.query('SELECT 1 FROM schema_migrations WHERE space_id=$1 AND version>0',[actor.spaceId])).rowCount) {
        await client.query("INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions,deployed_at,deployed_by,contributors) VALUES($1,1,0,'Starter schemas','deployed',$2,now(),$3,ARRAY[$3]::text[])",[actor.spaceId,JSON.stringify(await this.definitionHeads(client,actor.spaceId)),actor.userId])
        await client.query('UPDATE spaces SET schema_version=1 WHERE id=$1',[actor.spaceId])
      }
      if (!(await client.query('SELECT id FROM stories WHERE space_id=$1 LIMIT 1', [actor.spaceId])).rowCount) {
        const story = await client.query("INSERT INTO stories(space_id,name,slug) VALUES($1,'Home','home') RETURNING id", [actor.spaceId])
        const root = randomUUID()
        const locale = await client.query("INSERT INTO story_locales(story_id,slug,name,url_slug,root_block_id,space_locale_id) SELECT $1,c.slug,c.name,'home',$2,c.id FROM space_locales c WHERE c.space_id=$3 AND c.slug='' RETURNING id", [story.rows[0].id, root,actor.spaceId])
        await client.query('INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)', [root, locale.rows[0].id, versions.get('page'), JSON.stringify(defaultFields(definitions[2]))])
        for (const [position, name] of ['hero', 'footer'].entries()) await client.query("INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,'body',$5,$6)", [randomUUID(), locale.rows[0].id, versions.get(name), root, position, JSON.stringify(defaultFields(definitions.find(d => d.name === name)!))])
        await this.checkpoint(client, actor, story.rows[0].id, locale.rows[0].id, 'Starter page')
      }
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
}
