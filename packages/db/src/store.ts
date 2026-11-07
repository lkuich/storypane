import * as reviews from './reviews.js';
import { teamInputSchema, discussionInputSchema, discussionActionSchema } from '@storypane/core';
import { readPageMap } from './page-map.js';
import { pageMapQuerySchema, pageMapResponseSchema } from '@storypane/core';
import { richTextAssetIds } from '@storypane/core';
import { recordWebhookEvent } from './webhooks.js';
import {
  storyActionSchema,
  bulkStoryActionSchema,
  scheduleInputSchema,
  cancelScheduleSchema,
  releaseInputSchema,
  type ContentRelease,
  scheduleInstants,
  pathSlugSchema,
  type LifecycleReview,
  type StoryActionResult,
  type BulkStoryActionResult,
  type PublicationSchedule,
  type PublicationReview,
  type PublicationReference,
  type PublicationReferenceChoice,
} from '@storypane/core';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { z } from 'zod';
import {
  StorypaneError,
  LEASE_SECONDS,
  commandSchema,
  managementTokenInputSchema,
  datasourceInputSchema,
  defaultFields,
  definitionInputSchema,
  definitionParentSchema,
  validateDefinitionHierarchy,
  localeInputSchema,
  optionSourceSchema,
  optionRequestContextSchema,
  parseInput,
  storyInputSchema,
  validateFields,
  type Actor,
  type BlockDefinition,
  type BlockDraft,
  type Checkpoint,
  type CheckpointDetail,
  type Command,
  type CommitResult,
  type Datasource,
  type DefinitionInput,
  type DefinitionReferencesPage,
  type FieldDefinition,
  type Json,
  type Lease,
  type LocaleSnapshot,
  type OptionPage,
  type Publication,
  type Story,
  type StorySummary,
  type PageEditors,
  type PageEditor,
  type StoryLocale,
} from '@storypane/core';
import {
  canonicalJson,
  definitionInput,
  migrateSnapshot,
  migrationChanges,
  type SchemaMigration,
  type MigrationReview,
  type ManagementToken,
} from '@storypane/core';
import { fetchExternalOptions } from './external-options.js';
import * as webhooks from './webhooks.js';
import {
  loadContentAccess,
  assertLocationAccess,
  assertSnapshotAccess,
  assertUnrestrictedRead,
  projectSnapshot,
  projectedContent,
  projectResult,
  hasContentResult,
  assertContentChanges,
  type StoreContentAccess,
} from './content-access.js';
import {
  locationAllowed,
  blockAllowed,
  unrestrictedRead,
  type ContentPermission,
} from '@storypane/core';
import { isPublishedAsset } from './media.js';
import type { AssetUsage, AssetUsagePage } from '@storypane/core';
import {
  folderPath,
  folderInputSchema,
  storyLocationSchema,
  type ContentFolder,
} from '@storypane/core';
import {
  roleInputSchema,
  type Permission,
  type SpaceRole,
  memberRoleSchema,
  spaceInvitationSchema,
  type SpaceInvitation,
  spaceInputSchema,
  portableDefinitions,
  validatePortableDefinitions,
  spaceLocaleInputSchema,
  deleteSpaceLocaleSchema,
  type Space,
  type SpaceDetails,
  type SpaceLocale,
  type SpaceLocaleDeletionReview,
} from '@storypane/core';
import {
  deliverySettingsSchema,
  isBlockAllowed,
  type DeliveredStory,
  type DeliverySettings,
  type UserDeliverySettings,
  defaultPreview,
  type DeliveryToken,
  type PreviewSession,
} from '@storypane/core';

const pendingLocaleSql =
  "p.id IS NULL OR c.content IS DISTINCT FROM p.content OR coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug) IS DISTINCT FROM l.url_slug";
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const secretToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
const deliveryQuerySchema = z
  .object({
    id: z.uuid().optional(),
    slug: z.string().max(2048).optional(),
    locale: z.string().max(80).optional(),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
const deliveredRow = (row: Row): DeliveredStory => ({
  migrationVersion: Number(row.migration_version ?? 0),
  id: row.story_id,
  name: row.name,
  slug: row.slug,
  locale: row.locale,
  localeId: row.locale_id,
  revision: Number(row.revision),
  content: row.content,
  publishedAt: row.published_at ? iso(row.published_at) : null,
});

const scheduleRow = (row: Row): PublicationSchedule => ({
  active: row.status === 'pending',
  id: row.id,
  releaseId: row.release_id,
  releaseName: row.release_name,
  releaseRevision: Number(row.release_revision),
  releaseStatus: row.release_status,
  storyId: row.story_id,
  localeId: row.locale_id,
  checkpointId: row.checkpoint_id,
  checkpointRevision: Number(row.checkpoint_revision),
  creatorId: row.creator_id,
  dueAt: iso(row.due_at),
  timezone: row.timezone,
  status: row.release_status === 'held' && row.status === 'pending' ? 'failed' : row.status,
  revision: row.revision,
  attemptCount: row.attempt_count,
  publicationId: row.publication_id,
  error: row.error,
});

function validateReleaseTime(input: { localTime: string; timezone: string; dueAt: string }) {
  if (
    !scheduleInstants(input.localTime, input.timezone).some(
      (item) => item.instant === new Date(input.dueAt).toISOString(),
    )
  )
    throw new StorypaneError(
      'invalid',
      'Choose a valid local date/time and explicit UTC offset for this timezone.',
    );
}

type AccountActor = Pick<Actor, 'userId' | 'sessionId'>;
async function spacesFor(
  client: PoolClient,
  userId: string,
  spaceId: string | null = null,
): Promise<Space[]> {
  const result = await client.query(
    `SELECT s.id,s.name,s.description,s.environment,s.schema_read_only AS "schemaReadOnly",s.production_space_id AS "productionSpaceId",m.role,r.name AS "roleName",r.permissions,r.content_scopes AS "contentScopes",s.created_at AS "createdAt",
    (SELECT count(*)::integer FROM stories WHERE space_id=s.id AND deleted_at IS NULL) AS "storyCount",
    (SELECT count(*)::integer FROM memberships WHERE space_id=s.id) AS "memberCount"
    FROM spaces s JOIN memberships m ON m.space_id=s.id JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role
    WHERE m.user_id=$1 AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.created_at,s.id`,
    [userId, spaceId],
  );
  const spaces: Space[] = [];
  for (const row of result.rows) {
    const access = await loadContentAccess(client, { spaceId: row.id, userId });
    spaces.push({
      ...row,
      storyCount: new Set(access.locales.map((locale) => locale.storyId)).size,
      createdAt: iso(row.createdAt),
    });
  }
  return spaces;
}

type Row = QueryResultRow;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);
const storyRow = (r: Row): Story => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  folderId: r.folder_id ?? null,
  slugSegment: r.slug_segment ?? r.slug,
  formOnly: r.form_only ?? false,
  deletedAt: r.deleted_at ? iso(r.deleted_at) : null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const localeRow = (r: Row): StoryLocale => ({
  id: r.id,
  storyId: r.story_id,
  spaceLocaleId: r.space_locale_id,
  slug: r.slug,
  name: r.name,
  urlSlug: r.url_slug,
  slugSegment: r.slug_segment ?? r.url_slug,
  rootBlockId: r.root_block_id,
  revision: Number(r.revision),
  checkpointId: r.checkpoint_id,
  publishedVersionId: r.published_version_id,
});
const folderRow = (r: Row): ContentFolder => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  parentId: r.parent_id,
  localeSlugs: r.locale_slugs,
  allowedDefinitionIds: r.allowed_definition_ids,
  defaultDefinitionId: r.default_definition_id,
  formOnly: r.form_only,
});
const joinPath = (prefix: string, slug: string) => [prefix, slug].filter(Boolean).join('/');
const blockRow = (r: Row): BlockDraft => ({
  id: r.id,
  definitionId: r.definition_id,
  schemaVersionId: r.schema_version_id,
  parentId: r.parent_id,
  parentField: r.parent_field,
  position: r.position,
  fields: r.fields,
  revision: Number(r.revision),
});
const definitionRow = (r: Row): BlockDefinition => ({
  ...definitionInput(r.schema),
  ...(r.parent_definition_id !== undefined ? { parentDefinitionId: r.parent_definition_id } : {}),
  id: r.definition_id,
  versionId: r.id,
  version: r.version,
  createdAt: iso(r.created_at),
});
const checkpointRow = (r: Row): Checkpoint => ({
  id: r.id,
  revision: Number(r.revision),
  reason: r.reason,
  actorId: r.actor_id,
  createdAt: iso(r.created_at),
});
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const migrationRow = (row: Row): SchemaMigration => ({
  id: row.id,
  spaceId: row.space_id,
  version: row.version,
  baseVersion: row.base_version,
  name: row.name,
  status: row.status,
  revision: row.revision,
  // Legacy snapshots omitted nesting; resolve it from the frozen upgrade baseline.
  definitions: row.definitions.map((definition: BlockDefinition) =>
    definition.parentDefinitionId === undefined &&
    Object.hasOwn(row.schema_hierarchy_baseline ?? {}, definition.id)
      ? { ...definition, parentDefinitionId: row.schema_hierarchy_baseline[definition.id] }
      : definition,
  ),
  contributors: row.contributors,
  createdAt: iso(row.created_at),
  deployedAt: row.deployed_at ? iso(row.deployed_at) : null,
  deployedBy: row.deployed_by,
  destructive: row.destructive ?? false,
});
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const migrationTarget = (migration: SchemaMigration) =>
  migration.definitions.map((definition) => ({
    id: definition.id,
    schema: definitionInput(definition),
  }));
function dbError(error: unknown): never {
  if (error instanceof StorypaneError) throw error;
  const code = (error as { code?: string })?.code;
  if (code === '23505') throw new StorypaneError('invalid', 'That name or slug already exists');
  if (['23503', '23514', '22P02'].includes(code ?? ''))
    throw new StorypaneError('invalid', 'Invalid reference or value');
  throw error;
}
function requireBlock(snapshot: LocaleSnapshot, id: string): BlockDraft {
  const block = snapshot.blocks.find((b) => b.id === id);
  if (!block) throw new StorypaneError('not_found', 'Block not found');
  return block;
}
function subtree(snapshot: LocaleSnapshot, id: string): BlockDraft[] {
  const result: BlockDraft[] = [];
  const visit = (blockId: string) => {
    if (result.some((b) => b.id === blockId))
      throw new StorypaneError('invalid', 'Cyclic block structure');
    result.push(requireBlock(snapshot, blockId));
    snapshot.blocks.filter((b) => b.parentId === blockId).forEach((b) => visit(b.id));
  };
  visit(id);
  return result;
}
export function assembleContent(snapshot: LocaleSnapshot): Json {
  const definitions = new Map(snapshot.definitions.map((d) => [d.versionId, d]));
  const visiting = new Set<string>();
  const visit = (id: string, depth: number): Json => {
    if (depth > 30 || visiting.has(id))
      throw new StorypaneError('invalid', 'Block nesting exceeds the supported depth');
    const block = requireBlock(snapshot, id);
    const definition = definitions.get(block.schemaVersionId);
    if (!definition) throw new StorypaneError('invalid', 'Missing schema version');
    visiting.add(id);
    const result: Record<string, Json> = {
      ...block.fields,
      _uid: block.id,
      component: definition.name,
    };
    for (const field of definition.fields.filter((f) => f.type === 'blocks'))
      result[field.name] = snapshot.blocks
        .filter((b) => b.parentId === id && b.parentField === field.name)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((b) => visit(b.id, depth + 1));
    visiting.delete(id);
    return result;
  };
  return visit(snapshot.locale.rootBlockId, 0);
}

export class StorypaneStore {
  readonly pool: Pool;
  private transactionClient?: PoolClient;
  private incomingSchema = false;
  constructor(
    connection: Pool | string,
    private options: {
      spaceId?: string;
      authorizeSession?: (actor: AccountActor) => Promise<void>;
      authorizeIdentity?: (userId: string) => Promise<void>;
      registerPreview?: (tokenHash: string, expiresAt: Date) => Promise<void>;
      externalOptionHosts?: string[];
      webhookHosts?: string[];
      webhookEncryptionKey?: string;
    } = {},
  ) {
    this.pool =
      typeof connection === 'string'
        ? new Pool({ connectionString: connection, max: 5 })
        : connection;
  }

  private async authorizeSession(client: PoolClient, actor: AccountActor): Promise<void> {
    if (!actor.userId || !actor.sessionId)
      throw new StorypaneError('unauthenticated', 'Sign in to continue');
    if (this.options.authorizeSession) return this.options.authorizeSession(actor);
    const session = await client.query(
      'SELECT id FROM cms_sessions WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp()',
      [actor.sessionId, actor.userId],
    );
    if (!session.rowCount) throw new StorypaneError('unauthenticated', 'Your session has expired');
  }
  private async authorize(
    client: PoolClient,
    actor: Actor,
    permission?: Permission | 'admin',
  ): Promise<void> {
    if (this.options.spaceId && actor.spaceId !== this.options.spaceId)
      throw new StorypaneError('forbidden', 'Space database binding mismatch');
    if (actor.managementTokenId) {
      await this.options.authorizeIdentity?.(actor.userId);
      const token = (
        await client.query(
          'SELECT capability,scopes FROM schema_management_tokens WHERE id=$1 AND space_id=$2 AND user_id=$3 AND revoked_at IS NULL',
          [actor.managementTokenId, actor.spaceId, actor.userId],
        )
      ).rows[0];
      if (!token) throw new StorypaneError('unauthenticated', 'Management token was revoked');
      if (token.scopes) {
        const scope = permission === 'content:read' || !permission ? 'read' : permission;
        if (!token.scopes.includes(scope)) {
          throw new StorypaneError('forbidden', 'Management token does not allow this action');
        }
      } else if (
        permission &&
        (permission === 'admin'
          ? token.capability !== 'deploy'
          : permission !== 'schemas:write' || token.capability === 'read')
      )
        throw new StorypaneError('forbidden', 'Management token does not allow this action');
    } else await this.authorizeSession(client, actor);
    const membership = await client.query(
      'SELECT m.role,r.permissions FROM memberships m JOIN "user" u ON u.id=m.user_id JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role WHERE m.space_id=$1 AND m.user_id=$2',
      [actor.spaceId, actor.userId],
    );
    if (
      !membership.rowCount ||
      (permission &&
        (permission === 'admin'
          ? membership.rows[0].role !== 'admin'
          : !membership.rows[0].permissions.includes(permission)))
    )
      throw new StorypaneError(
        'forbidden',
        permission
          ? 'Your role does not allow this action'
          : 'You do not have access to this space',
      );
    if (permission === 'schemas:write') await this.assertSchemaEditable(client, actor);
    if (permission && ['schemas:write', 'settings:write'].includes(permission))
      assertUnrestrictedRead(await loadContentAccess(client, actor));
  }
  private async assertSchemaEditable(client: PoolClient, actor: Actor) {
    const row = (
      await client.query('SELECT schema_read_only FROM spaces WHERE id=$1', [actor.spaceId])
    ).rows[0];
    if (row?.schema_read_only && !this.incomingSchema)
      throw new StorypaneError(
        'forbidden',
        'Schema editing is disabled. Promote changes from a linked dev space.',
      );
  }
  async readSchema<T>(
    actor: Actor,
    work: (client: PoolClient, store: StorypaneStore) => Promise<T>,
  ): Promise<T> {
    return this.tx(
      actor,
      async (client) => {
        assertUnrestrictedRead(await this.contentAccess(client, actor));
        const scoped = new StorypaneStore(this.pool, this.options);
        scoped.transactionClient = client;
        return work(client, scoped);
      },
      undefined,
      true,
    );
  }
  async schemaTransaction<T>(
    actor: Actor,
    work: (store: StorypaneStore, client: PoolClient) => Promise<T>,
    preview = false,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))', [actor.spaceId]);
      await this.authorize(client, actor, 'admin');
      assertUnrestrictedRead(await this.contentAccess(client, actor));
      const scoped = new StorypaneStore(this.pool, this.options);
      scoped.transactionClient = client;
      scoped.incomingSchema = true;
      const result = await work(scoped, client);
      await this.authorize(client, actor, 'admin');
      await client.query(preview ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      dbError(error);
    } finally {
      client.release();
    }
  }
  async pageMap(actor: Actor, raw: unknown) {
    const query = parseInput(pageMapQuerySchema, raw);
    return this.tx(
      actor,
      async (client) => pageMapResponseSchema.parse(await readPageMap(client, actor, query)),
      'content:read',
    );
  }
  async listTeams(actor: Actor) {
    return this.tx(actor, (client) => reviews.listTeams(client, actor.spaceId), 'content:read');
  }
  async saveTeam(actor: Actor, raw: unknown, id?: string) {
    const input = parseInput(teamInputSchema, raw);
    if (id) parseInput(z.uuid(), id);
    return this.tx(
      actor,
      async (client) => {
        await this.lockMembers(client, actor);
        return reviews.saveTeam(client, actor.spaceId, input, id);
      },
      'admin',
    );
  }
  async deleteTeam(actor: Actor, id: string) {
    parseInput(z.uuid(), id);
    return this.tx(
      actor,
      async (client) => {
        await this.lockMembers(client, actor);
        if (
          !(
            await client.query('DELETE FROM teams WHERE space_id=$1 AND id=$2', [actor.spaceId, id])
          ).rowCount
        )
          throw new StorypaneError('not_found', 'Team not found');
      },
      'admin',
    );
  }
  async reviewDirectory(actor: Actor, raw: unknown) {
    const input = parseInput(
      z
        .object({
          storyId: z.uuid(),
          localeId: z.uuid(),
          blockId: z.uuid().nullable().default(null),
        })
        .strict(),
      raw,
    );
    return this.tx(
      actor,
      async (client) => {
        await this.lockLocale(client, actor, input.storyId, input.localeId);
        return reviews.reviewDirectory(
          client,
          actor,
          await this.snapshot(client, actor, input.storyId, input.localeId),
          input.blockId,
        );
      },
      'content:read',
    );
  }
  async listDiscussions(actor: Actor, raw: unknown = {}) {
    const query = parseInput(
      z.object({ storyId: z.uuid().optional(), localeId: z.uuid().optional() }).strict(),
      raw,
    );
    return this.tx(
      actor,
      (client) =>
        reviews.listDiscussions(
          client,
          actor,
          (storyId, localeId) => this.snapshot(client, actor, storyId, localeId),
          query,
        ),
      'content:read',
    );
  }
  async createDiscussion(actor: Actor, raw: unknown) {
    if (actor.managementTokenId)
      throw new StorypaneError('forbidden', 'Reviews require a signed-in member');
    const input = parseInput(discussionInputSchema, raw);
    return this.tx(
      actor,
      async (client) => {
        await this.lockLocale(client, actor, input.storyId, input.localeId);
        return reviews.createDiscussion(
          client,
          actor,
          await this.snapshot(client, actor, input.storyId, input.localeId),
          input,
        );
      },
      'content:read',
    );
  }
  async actOnDiscussion(actor: Actor, id: string, raw: unknown) {
    if (actor.managementTokenId)
      throw new StorypaneError('forbidden', 'Reviews require a signed-in member');
    const input = parseInput(discussionActionSchema, raw);
    return this.tx(
      actor,
      async (client) => {
        const thread = await reviews.discussionTarget(client, actor, id);
        await this.lockLocale(client, actor, thread.story_id, thread.locale_id);
        // Refetch after the locale lock: withdrawal and approval share publication's lock.
        const current = await reviews.discussionTarget(client, actor, id);
        await reviews.actOnDiscussion(
          client,
          actor,
          current,
          await this.snapshot(client, actor, thread.story_id, thread.locale_id),
          input,
        );
      },
      'content:read',
    );
  }
  private async contentAccess(client: PoolClient, actor: Actor) {
    return loadContentAccess(client, actor);
  }
  private assertCompleteAccess(
    access: StoreContentAccess,
    snapshot: LocaleSnapshot,
    permission: ContentPermission,
  ) {
    assertSnapshotAccess(access, snapshot, permission);
    if (!projectSnapshot(access, snapshot).access.complete)
      throw new StorypaneError(
        'forbidden',
        'This action requires read access to all affected content and references',
      );
  }
  private async requirePublicationAccess(
    client: PoolClient,
    actor: Actor,
    snapshot: LocaleSnapshot,
  ) {
    const current = (
      await client.query(
        'SELECT * FROM stories WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL',
        [snapshot.story.id, actor.spaceId],
      )
    ).rows[0];
    if (!current) throw new StorypaneError('not_found', 'Story not found');
    const access = await this.contentAccess(client, actor);
    this.assertCompleteAccess(access, { ...snapshot, story: storyRow(current) }, 'content:publish');
  }
  private async requireStoryAccess(client: PoolClient, actor: Actor, storyId: string) {
    const access = await this.contentAccess(client, actor);
    if (!access.locales.some((locale) => locale.storyId === storyId))
      throw new StorypaneError('not_found', 'Story not found');
    return access;
  }
  private async requireAllStoryAccess(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    permission: ContentPermission,
  ) {
    const access = await this.requireStoryAccess(client, actor, storyId);
    const locales = (
      await client.query('SELECT id FROM story_locales WHERE story_id=$1', [storyId])
    ).rows;
    for (const locale of locales)
      assertSnapshotAccess(
        access,
        await this.snapshot(client, actor, storyId, locale.id),
        permission,
      );
    return access;
  }
  async assertActor(actor: Actor, permission?: Permission | 'admin'): Promise<void> {
    await this.tx(actor, async () => undefined, permission);
  }
  private webhookOptions() {
    return {
      allowedHosts: this.options.webhookHosts ?? [],
      encryptionKey: this.options.webhookEncryptionKey,
    };
  }
  async listWebhooks(actor: Actor) {
    return this.tx(
      actor,
      (client) => webhooks.listWebhooks(client, actor.spaceId, this.webhookOptions()),
      'admin',
    );
  }
  async saveWebhook(actor: Actor, raw: unknown, id?: string) {
    if (id) parseInput(z.uuid(), id);
    return this.tx(
      actor,
      (client) => webhooks.saveWebhook(client, actor.spaceId, raw, this.webhookOptions(), id),
      'admin',
      true,
    );
  }
  async rotateWebhookSecret(actor: Actor, id: string, raw: unknown) {
    parseInput(z.uuid(), id);
    return this.tx(
      actor,
      (client) =>
        webhooks.rotateWebhookSecret(client, actor.spaceId, id, raw, this.webhookOptions()),
      'admin',
    );
  }
  async deleteWebhook(actor: Actor, id: string, raw: unknown) {
    parseInput(z.uuid(), id);
    return this.tx(
      actor,
      (client) => webhooks.deleteWebhook(client, actor.spaceId, id, raw),
      'admin',
    );
  }
  async testWebhook(actor: Actor, id: string) {
    parseInput(z.uuid(), id);
    return this.tx(
      actor,
      (client) =>
        webhooks.testWebhook(client, actor.spaceId, id, actor.userId, this.webhookOptions()),
      'admin',
    );
  }
  async retryWebhook(actor: Actor, id: string, deliveryId: string) {
    parseInput(z.uuid(), id);
    parseInput(z.uuid(), deliveryId);
    return this.tx(
      actor,
      (client) =>
        webhooks.retryWebhook(client, actor.spaceId, id, deliveryId, this.webhookOptions()),
      'admin',
    );
  }
  async listWebhookDeliveries(actor: Actor, id: string, offset = 0) {
    parseInput(z.uuid(), id);
    parseInput(z.number().int().min(0).max(100000), offset);
    return this.tx(
      actor,
      (client) => webhooks.listWebhookDeliveries(client, actor.spaceId, id, offset),
      'admin',
    );
  }
  async listSpaces(actor: AccountActor): Promise<Space[]> {
    const client = await this.pool.connect();
    try {
      await this.authorizeSession(client, actor);
      return await spacesFor(client, actor.userId);
    } finally {
      client.release();
    }
  }
  async createSpace(actor: AccountActor, raw: unknown): Promise<Space> {
    if (this.options.spaceId)
      throw new StorypaneError('forbidden', 'Use installation provisioning');
    const input = parseInput(spaceInputSchema, raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.authorizeSession(client, actor);
      const { rows } = await client.query(
        'INSERT INTO spaces(name,description) VALUES($1,$2) RETURNING id',
        [input.name, input.description],
      );
      await client.query(
        "INSERT INTO space_locales(space_id,name,slug,is_default) VALUES($1,'Default','',true)",
        [rows[0].id],
      );
      await client.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'admin')", [
        rows[0].id,
        actor.userId,
      ]);
      await client.query(
        "INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions,deployed_at) VALUES($1,0,0,'Initial baseline','deployed','[]',now())",
        [rows[0].id],
      );
      const [space] = await spacesFor(client, actor.userId, rows[0].id);
      await client.query('COMMIT');
      return space!;
    } catch (error) {
      await client.query('ROLLBACK');
      dbError(error);
    } finally {
      client.release();
    }
  }
  async getSpace(actor: Actor): Promise<SpaceDetails> {
    return this.tx(actor, async (client) => {
      const [space] = await spacesFor(client, actor.userId, actor.spaceId);
      const members = await client.query(
        'SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.space_id=$1 ORDER BY m.role,u.name,u.id',
        [actor.spaceId],
      );
      return { ...space!, members: members.rows };
    });
  }
  private async lockMembers(client: PoolClient, actor: Actor) {
    await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [actor.spaceId]);
    // Recheck after waiting: another administrator may have removed our access.
    await this.authorize(client, actor, 'admin');
  }
  async listSpaceInvitations(actor: Actor): Promise<SpaceInvitation[]> {
    return this.tx(
      actor,
      async (client) =>
        (
          await client.query(
            'SELECT id,email,role,created_at,expires_at FROM space_invitations WHERE space_id=$1 ORDER BY created_at DESC',
            [actor.spaceId],
          )
        ).rows.map((row) => ({
          id: row.id,
          email: row.email,
          role: row.role,
          createdAt: iso(row.created_at),
          expiresAt: iso(row.expires_at),
        })),
      'admin',
    );
  }
  async inviteSpaceMember(actor: Actor, raw: unknown): Promise<{ token?: string }> {
    const input = parseInput(spaceInvitationSchema, raw);
    const token = this.options.spaceId ? secretToken('si') : undefined;
    await this.tx(
      actor,
      async (client) => {
        await this.lockMembers(client, actor);
        if (
          (
            await client.query(
              'SELECT 1 FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.space_id=$1 AND lower(u.email)=$2',
              [actor.spaceId, input.email],
            )
          ).rowCount
        )
          throw new StorypaneError('invalid', 'This person is already a member.');
        await this.requireRole(client, actor.spaceId, input.role);
        const result = await client.query(
          `INSERT INTO space_invitations(space_id,email,role) VALUES($1,$2,$3)
        ON CONFLICT(space_id,email) DO UPDATE SET role=EXCLUDED.role,created_at=now(),expires_at=now()+interval '7 days'
        WHERE space_invitations.expires_at<=clock_timestamp() RETURNING id`,
          [actor.spaceId, input.email, input.role],
        );
        if (!result.rowCount)
          throw new StorypaneError(
            'invalid',
            'An invitation is already pending for this email. Revoke it to change the role.',
          );
        if (token)
          await client.query('UPDATE space_invitations SET token_hash=$2 WHERE id=$1', [
            result.rows[0].id,
            tokenHash(token),
          ]);
      },
      'admin',
    );
    return { token };
  }
  async revokeSpaceInvitation(actor: Actor, id: string): Promise<void> {
    parseInput(z.uuid(), id);
    await this.tx(
      actor,
      async (client) => {
        await this.lockMembers(client, actor);
        const result = await client.query(
          'DELETE FROM space_invitations WHERE id=$1 AND space_id=$2',
          [id, actor.spaceId],
        );
        if (!result.rowCount) throw new StorypaneError('not_found', 'Invitation not found.');
      },
      'admin',
    );
  }
  async updateSpaceMember(actor: Actor, userId: string, raw: unknown): Promise<void> {
    const { role } = parseInput(memberRoleSchema, raw);
    await this.changeSpaceMember(actor, userId, role);
  }
  async removeSpaceMember(actor: Actor, userId: string): Promise<void> {
    await this.changeSpaceMember(actor, userId, null);
  }
  private async changeSpaceMember(
    actor: Actor,
    userId: string,
    role: Actor['role'] | null,
  ): Promise<void> {
    parseInput(z.string().min(1).max(256), userId);
    await this.tx(
      actor,
      async (client) => {
        await this.lockMembers(client, actor);
        if (role) await this.requireRole(client, actor.spaceId, role);
        const member = await client.query(
          'SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2',
          [actor.spaceId, userId],
        );
        if (!member.rowCount)
          throw new StorypaneError('not_found', 'Member not found in this space.');
        if (member.rows[0].role === 'admin' && role !== 'admin') {
          const admins = await client.query(
            "SELECT 1 FROM memberships WHERE space_id=$1 AND role='admin'",
            [actor.spaceId],
          );
          if (admins.rowCount === 1)
            throw new StorypaneError(
              'invalid',
              'A space must have at least one administrator. Promote another member first.',
            );
        }
        if (role)
          await client.query('UPDATE memberships SET role=$3 WHERE space_id=$1 AND user_id=$2', [
            actor.spaceId,
            userId,
            role,
          ]);
        else {
          await client.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
            actor.spaceId,
            userId,
          ]);
          await client.query(
            'DELETE FROM space_invitations WHERE space_id=$1 AND email IN (SELECT lower(email) FROM "user" WHERE id=$2)',
            [actor.spaceId, userId],
          );
          await client.query(
            'DELETE FROM edit_leases e USING story_locales l,stories s WHERE e.locale_id=l.id AND l.story_id=s.id AND s.space_id=$1 AND e.user_id=$2',
            [actor.spaceId, userId],
          );
        }
        await client.query(
          'DELETE FROM edit_leases e USING story_locales l,stories s WHERE e.locale_id=l.id AND l.story_id=s.id AND s.space_id=$1 AND e.user_id=$2',
          [actor.spaceId, userId],
        );
      },
      'admin',
      true,
    );
  }
  private async requireRole(client: PoolClient, spaceId: string, role: string) {
    if (
      !(
        await client.query('SELECT 1 FROM space_roles WHERE space_id=$1 AND id=$2', [spaceId, role])
      ).rowCount
    )
      throw new StorypaneError('invalid', 'Choose a role from this space.');
  }
  async listSpaceRoles(actor: Actor): Promise<SpaceRole[]> {
    return this.tx(
      actor,
      async (client) =>
        (
          await client.query(
            `SELECT r.id,r.name,r.permissions,r.content_scopes AS "contentScopes",r.system,
      (SELECT count(*)::integer FROM memberships m WHERE m.space_id=r.space_id AND m.role=r.id) AS "memberCount",
      (SELECT count(*)::integer FROM space_invitations i WHERE i.space_id=r.space_id AND i.role=r.id) AS "invitationCount"
      FROM space_roles r WHERE r.space_id=$1 ORDER BY r.system DESC,r.name`,
            [actor.spaceId],
          )
        ).rows,
    );
  }
  async saveSpaceRole(actor: Actor, raw: unknown, id?: string): Promise<void> {
    const input = parseInput(roleInputSchema, raw);
    await this.tx(
      actor,
      async (client) => {
        await this.lockMembers(client, actor);
        const idsByKind = {
          folder: new Set(
            (
              await client.query('SELECT id FROM content_folders WHERE space_id=$1', [
                actor.spaceId,
              ])
            ).rows.map((row) => row.id),
          ),
          story: new Set(
            (
              await client.query('SELECT id FROM stories WHERE space_id=$1', [actor.spaceId])
            ).rows.map((row) => row.id),
          ),
          locale: new Set(
            (
              await client.query('SELECT id FROM space_locales WHERE space_id=$1', [actor.spaceId])
            ).rows.map((row) => row.id),
          ),
          definition: new Set(
            (
              await client.query('SELECT id FROM definitions WHERE space_id=$1', [actor.spaceId])
            ).rows.map((row) => row.id),
          ),
          field: new Set(
            (
              await client.query(
                "SELECT f->>'id' AS id FROM definition_versions v JOIN definitions d ON d.id=v.definition_id CROSS JOIN LATERAL jsonb_array_elements(v.schema->'fields') f WHERE d.space_id=$1",
                [actor.spaceId],
              )
            ).rows.map((row) => row.id),
          ),
        };
        for (const scope of Object.values(input.contentScopes)) {
          for (const [kind, ids] of [
            ['folder', scope.locations?.folderIds],
            ['story', scope.locations?.storyIds],
            ['locale', scope.localeIds],
            ['definition', scope.definitionIds],
            ['field', scope.fieldIds],
          ] as const)
            if (ids?.some((id) => id !== null && !idsByKind[kind].has(id)))
              throw new StorypaneError('invalid', 'Choose permission targets from this space');
        }
        if (id) {
          const role = await client.query(
            'SELECT system FROM space_roles WHERE space_id=$1 AND id=$2',
            [actor.spaceId, id],
          );
          if (!role.rowCount) throw new StorypaneError('not_found', 'Role not found.');
          if (role.rows[0].system)
            throw new StorypaneError(
              'invalid',
              'Built-in roles cannot be changed. Create a custom role instead.',
            );
          await client.query(
            'UPDATE space_roles SET name=$3,permissions=$4,content_scopes=$5 WHERE space_id=$1 AND id=$2',
            [actor.spaceId, id, input.name, input.permissions, JSON.stringify(input.contentScopes)],
          );
        } else
          await client.query(
            'INSERT INTO space_roles(space_id,id,name,permissions,content_scopes) VALUES($1,$2,$3,$4,$5)',
            [
              actor.spaceId,
              randomUUID(),
              input.name,
              input.permissions,
              JSON.stringify(input.contentScopes),
            ],
          );
        if (id)
          await client.query(
            'DELETE FROM edit_leases e USING story_locales l,stories s,memberships m WHERE e.locale_id=l.id AND l.story_id=s.id AND s.space_id=$1 AND m.space_id=s.space_id AND m.user_id=e.user_id AND m.role=$2',
            [actor.spaceId, id],
          );
      },
      'admin',
      true,
    );
  }
  async deleteSpaceRole(actor: Actor, id: string): Promise<void> {
    await this.tx(
      actor,
      async (client) => {
        await this.lockMembers(client, actor);
        const role = await client.query(
          'SELECT system FROM space_roles WHERE space_id=$1 AND id=$2',
          [actor.spaceId, id],
        );
        if (!role.rowCount) throw new StorypaneError('not_found', 'Role not found.');
        if (role.rows[0].system)
          throw new StorypaneError('invalid', 'Built-in roles cannot be deleted.');
        if (
          (
            await client.query(
              'SELECT 1 FROM memberships WHERE space_id=$1 AND role=$2 UNION ALL SELECT 1 FROM space_invitations WHERE space_id=$1 AND role=$2',
              [actor.spaceId, id],
            )
          ).rowCount
        )
          throw new StorypaneError(
            'invalid',
            'Reassign members and revoke pending invitations before deleting this role.',
          );
        await client.query('DELETE FROM space_roles WHERE space_id=$1 AND id=$2', [
          actor.spaceId,
          id,
        ]);
      },
      'admin',
    );
  }
  async updateSpace(actor: Actor, raw: unknown): Promise<Space> {
    const input = parseInput(
      spaceInputSchema.extend({ schemaReadOnly: z.boolean().optional() }),
      raw,
    );
    return this.tx(
      actor,
      async (client) => {
        if (input.schemaReadOnly !== undefined) {
          await this.authorize(client, actor, 'admin');
          await client.query('UPDATE spaces SET schema_read_only=$2 WHERE id=$1', [
            actor.spaceId,
            input.schemaReadOnly,
          ]);
        }
        await client.query('UPDATE spaces SET name=$2,description=$3 WHERE id=$1', [
          actor.spaceId,
          input.name,
          input.description,
        ]);
        return (await spacesFor(client, actor.userId, actor.spaceId))[0]!;
      },
      'settings:write',
      true,
    );
  }
  async listSpaceLocales(actor: Actor): Promise<SpaceLocale[]> {
    return this.tx(actor, async (client) => {
      const access = await this.contentAccess(client, actor);
      const configured = (
        await client.query(
          'SELECT id,name,slug,is_default AS "isDefault" FROM space_locales WHERE space_id=$1 ORDER BY is_default DESC,name,id',
          [actor.spaceId],
        )
      ).rows;
      return configured
        .filter(
          (locale) =>
            access.admin ||
            (access.permissions.includes('content:read') &&
              (!access.scopes.read.localeIds || access.scopes.read.localeIds.includes(locale.id))),
        )
        .map((locale) => ({
          ...locale,
          storyCount: access.locales.filter((item) => item.spaceLocaleId === locale.id).length,
        }));
    });
  }
  async createSpaceLocale(actor: Actor, raw: unknown): Promise<SpaceLocale> {
    const input = parseInput(spaceLocaleInputSchema, raw);
    return this.tx(
      actor,
      async (client) => {
        const { rows } = await client.query(
          'INSERT INTO space_locales(space_id,name,slug) VALUES($1,$2,$3) RETURNING id,name,slug,is_default AS "isDefault"',
          [actor.spaceId, input.name, input.slug],
        );
        return { ...rows[0], storyCount: 0 };
      },
      'settings:write',
    );
  }
  async updateSpaceLocale(actor: Actor, id: string, raw: unknown): Promise<SpaceLocale> {
    parseInput(z.uuid(), id);
    return this.tx(
      actor,
      async (client) => {
        const { rows } = await client.query(
          'SELECT * FROM space_locales WHERE id=$1 AND space_id=$2 FOR UPDATE',
          [id, actor.spaceId],
        );
        if (!rows[0]) throw new StorypaneError('not_found', 'Locale not found');
        const input = parseInput(spaceLocaleInputSchema, raw);
        if (
          input.slug === '' &&
          rows[0].slug !== '' &&
          (
            await client.query(
              'SELECT 1 FROM content_folders WHERE space_id=$1 AND locale_slugs ? $2 LIMIT 1',
              [actor.spaceId, id],
            )
          ).rowCount
        )
          throw new StorypaneError(
            'invalid',
            'Remove this locale’s folder slug overrides before using root URLs.',
          );
        await client.query('UPDATE space_locales SET name=$2,slug=$3 WHERE id=$1', [
          id,
          input.name,
          input.slug,
        ]);
        const count = await client.query(
          'SELECT count(*)::integer AS count FROM story_locales WHERE space_locale_id=$1',
          [id],
        );
        return { id, ...input, isDefault: rows[0].is_default, storyCount: count.rows[0].count };
      },
      'settings:write',
      true,
    );
  }
  async setDefaultSpaceLocale(actor: Actor, id: string, raw: unknown): Promise<void> {
    parseInput(z.uuid(), id);
    const input = parseInput(z.object({ expectedDefaultLocaleId: z.uuid() }).strict(), raw);
    await this.tx(
      actor,
      async (client) => {
        const locales = (
          await client.query('SELECT id,is_default FROM space_locales WHERE space_id=$1', [
            actor.spaceId,
          ])
        ).rows;
        if (!locales.some((locale) => locale.id === id))
          throw new StorypaneError('not_found', 'Locale not found');
        const current = locales.find((locale) => locale.is_default);
        if (current?.id === id) return;
        if (current?.id !== input.expectedDefaultLocaleId)
          throw new StorypaneError(
            'stale_revision',
            'The default locale changed. Reload locales and try again.',
          );
        await client.query('UPDATE space_locales SET is_default=false WHERE id=$1', [current.id]);
        await client.query('UPDATE space_locales SET is_default=true WHERE id=$1', [id]);
      },
      'settings:write',
      true,
    );
  }
  private async localeDeletionReview(
    client: PoolClient,
    actor: Actor,
    id: string,
  ): Promise<SpaceLocaleDeletionReview> {
    const locale = (
      await client.query(
        'SELECT id,name,slug,is_default AS "isDefault" FROM space_locales WHERE id=$1 AND space_id=$2',
        [id, actor.spaceId],
      )
    ).rows[0];
    if (!locale) throw new StorypaneError('not_found', 'Locale not found');
    if (locale.isDefault)
      throw new StorypaneError('invalid', 'Choose another default locale before removing this one');
    // Include deleted stories: their retained translations must not outlive the configured locale.
    const rows = (
      await client.query(
        `SELECT s.id,s.name,s.folder_id,s.deleted_at,l.id AS locale_id,l.url_slug,l.revision,l.checkpoint_id,l.published_version_id,
        (SELECT coalesce(jsonb_agg(other.id ORDER BY other.id),'[]'::jsonb) FROM story_locales other WHERE other.story_id=s.id AND other.id<>l.id) AS other_locales,
        (SELECT coalesce(jsonb_agg(jsonb_build_array(p.id,p.revision) ORDER BY p.id),'[]'::jsonb)
          FROM publication_schedules p WHERE p.locale_id=l.id AND p.status='pending') AS schedules
        FROM story_locales l JOIN stories s ON s.id=l.story_id
        WHERE l.space_locale_id=$1 AND s.space_id=$2 ORDER BY s.name,s.id`,
        [id, actor.spaceId],
      )
    ).rows;
    return {
      locale: { ...locale, storyCount: rows.length },
      token: digest({ locale, rows }),
      stories: rows.map((row) => ({
        id: row.id,
        name: row.name,
        localeId: row.locale_id,
        urlSlug: row.url_slug,
        deleted: !!row.deleted_at,
        published: !!row.published_version_id,
        scheduled: !!row.schedules.length,
        lastLocale: row.other_locales.length === 0,
      })),
    };
  }
  async reviewSpaceLocaleDeletion(actor: Actor, id: string): Promise<SpaceLocaleDeletionReview> {
    parseInput(z.uuid(), id);
    return this.tx(
      actor,
      (client) => this.localeDeletionReview(client, actor, id),
      'settings:write',
    );
  }
  async deleteSpaceLocale(actor: Actor, id: string, raw: unknown = {}): Promise<void> {
    parseInput(z.uuid(), id);
    const input = parseInput(deleteSpaceLocaleSchema, raw);
    await this.tx(
      actor,
      async (client) => {
        const review = await this.localeDeletionReview(client, actor, id);
        if (review.stories.some((story) => story.lastLocale))
          throw new StorypaneError(
            'invalid',
            'Add another locale to each affected story before deleting its only remaining locale.',
          );
        if (review.stories.length && (!input.deleteContent || !input.reviewToken))
          throw new StorypaneError(
            'invalid',
            'Review the affected stories and confirm deletion of their locale content first.',
          );
        if (input.reviewToken && input.reviewToken !== review.token)
          throw new StorypaneError(
            'stale_revision',
            'The locale content changed. Review it again before deleting.',
          );
        const access = await loadContentAccess(client, actor, true);
        for (const story of review.stories) {
          const locale = (
            await client.query(
              'SELECT checkpoint_id,published_version_id FROM story_locales WHERE id=$1',
              [story.localeId],
            )
          ).rows[0];
          const checkpoint = await this.readCheckpoint(
            client,
            story.localeId,
            locale.checkpoint_id,
          );
          const current = access.locales.find((item) => item.id === story.localeId)!;
          const snapshot = {
            ...checkpoint.snapshot,
            story: { ...checkpoint.snapshot.story, folderId: current.folderId },
          };
          this.assertCompleteAccess(access, snapshot, 'content:edit');
          if (story.published || story.scheduled)
            this.assertCompleteAccess(access, snapshot, 'content:publish');
          await this.noCompetingLeases(
            client,
            actor,
            story.localeId,
            snapshot.blocks.map((block) => block.id),
          );
          await this.unpublishLocaleTx(
            client,
            actor,
            story.id,
            story.localeId,
            locale.published_version_id,
            true,
          );
        }
        await client.query('DELETE FROM story_locales WHERE space_locale_id=$1', [id]);
        await client.query(
          'UPDATE content_folders SET locale_slugs=locale_slugs-$2 WHERE space_id=$1',
          [actor.spaceId, id],
        );
        await client.query('DELETE FROM space_locales WHERE id=$1', [id]);
      },
      'settings:write',
      true,
    );
  }
  async deliveryLocales(
    token: string,
    spaceId: string,
  ): Promise<Pick<SpaceLocale, 'id' | 'name' | 'slug' | 'isDefault'>[]> {
    await this.authenticateDelivery(token, spaceId);
    return (
      await this.pool.query(
        'SELECT id,name,slug,is_default AS "isDefault" FROM space_locales WHERE space_id=$1 ORDER BY is_default DESC,name,id',
        [spaceId],
      )
    ).rows;
  }
  async getDeliverySettings(actor: Actor): Promise<UserDeliverySettings> {
    return this.tx(
      actor,
      async (client) =>
        (
          await client.query(
            'SELECT s.preview_urls AS "previewUrls",s.default_preview_id AS "defaultPreviewId",s.preview_parameter AS "previewParameter",m.personal_default_preview_id AS "personalDefaultPreviewId",m.block_previews AS "blockPreviews" FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE s.id=$1 AND m.user_id=$2',
            [actor.spaceId, actor.userId],
          )
        ).rows[0],
    );
  }
  async updatePersonalPreview(
    actor: Actor,
    raw: unknown,
  ): Promise<{ previewId: string | null; blockPreviews: boolean }> {
    if (actor.managementTokenId)
      throw new StorypaneError('forbidden', 'Sign in to choose your personal preview');
    const input = parseInput(
      z.object({ previewId: z.uuid().nullable(), blockPreviews: z.boolean().optional() }).strict(),
      raw,
    );
    return this.tx(actor, async (client) => {
      const { rows } = await client.query('SELECT preview_urls FROM spaces WHERE id=$1 FOR SHARE', [
        actor.spaceId,
      ]);
      if (
        input.previewId !== null &&
        !(rows[0].preview_urls as DeliverySettings['previewUrls']).some(
          (item) => item.id === input.previewId,
        )
      )
        throw new StorypaneError('invalid', 'Choose a configured preview URL');
      const updated = await client.query(
        'UPDATE memberships SET personal_default_preview_id=$3,block_previews=coalesce($4,block_previews) WHERE space_id=$1 AND user_id=$2 RETURNING personal_default_preview_id AS "previewId",block_previews AS "blockPreviews"',
        [actor.spaceId, actor.userId, input.previewId, input.blockPreviews ?? null],
      );
      return updated.rows[0];
    });
  }
  async updateDeliverySettings(actor: Actor, raw: unknown): Promise<DeliverySettings> {
    const input = parseInput(deliverySettingsSchema, raw);
    return this.tx(
      actor,
      async (client) => {
        await client.query(
          'UPDATE spaces SET preview_urls=$2,default_preview_id=$3,preview_parameter=$4 WHERE id=$1',
          [
            actor.spaceId,
            JSON.stringify(input.previewUrls),
            input.defaultPreviewId,
            input.previewParameter,
          ],
        );
        await client.query(
          'UPDATE memberships SET personal_default_preview_id=NULL WHERE space_id=$1 AND personal_default_preview_id <> ALL($2::uuid[])',
          [actor.spaceId, input.previewUrls.map((item) => item.id)],
        );
        await client.query(
          'DELETE FROM preview_sessions WHERE space_id=$1 AND origin <> ALL($2::text[])',
          [actor.spaceId, input.previewUrls.map((item) => new URL(item.url).origin)],
        );
        return input;
      },
      'settings:write',
    );
  }
  async listDeliveryTokens(actor: Actor): Promise<DeliveryToken[]> {
    return this.tx(
      actor,
      async (client) =>
        (
          await client.query(
            'SELECT id,name,scope,created_at AS "createdAt" FROM delivery_tokens WHERE space_id=$1 AND revoked_at IS NULL ORDER BY created_at,id',
            [actor.spaceId],
          )
        ).rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
      'settings:write',
    );
  }
  async createDeliveryToken(
    actor: Actor,
    raw: unknown,
  ): Promise<DeliveryToken & { token: string }> {
    const input = parseInput(
      z
        .object({ name: z.string().trim().min(1).max(80), scope: z.enum(['published', 'preview']) })
        .strict(),
      raw,
    );
    return this.tx(
      actor,
      async (client) => {
        const token = secretToken(input.scope === 'published' ? 'bl_pub' : 'bl_preview');
        const { rows } = await client.query(
          'INSERT INTO delivery_tokens(space_id,name,scope,token_hash) VALUES($1,$2,$3,$4) RETURNING id,name,scope,created_at AS "createdAt"',
          [actor.spaceId, input.name, input.scope, tokenHash(token)],
        );
        return { ...rows[0], createdAt: iso(rows[0].createdAt), token };
      },
      'settings:write',
    );
  }
  async revokeDeliveryToken(actor: Actor, id: string): Promise<void> {
    parseInput(z.uuid(), id);
    await this.tx(
      actor,
      async (client) => {
        await client.query(
          'UPDATE delivery_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND space_id=$2',
          [id, actor.spaceId],
        );
      },
      'settings:write',
    );
  }
  async authenticateDelivery(
    token: string,
    spaceId: string,
    preview = false,
  ): Promise<{ id: string; spaceId: string }> {
    parseInput(z.uuid(), spaceId);
    if (!token || token.length > 128)
      throw new StorypaneError('unauthenticated', 'A delivery token is required');
    const { rows } = await this.pool.query(
      'SELECT id,space_id AS "spaceId",scope FROM delivery_tokens WHERE token_hash=$1 AND space_id=$2 AND revoked_at IS NULL',
      [tokenHash(token), spaceId],
    );
    if (!rows[0] || (preview && rows[0].scope !== 'preview'))
      throw new StorypaneError('unauthenticated', 'Invalid or revoked delivery token');
    return rows[0];
  }
  async deliverySchema(token: string, spaceId: string) {
    await this.authenticateDelivery(token, spaceId, true);
    const row = (
      await this.pool.query(
        'SELECT m.version,m.definitions FROM spaces s JOIN schema_migrations m ON m.space_id=s.id AND m.version=s.schema_version WHERE s.id=$1',
        [spaceId],
      )
    ).rows[0];
    if (!row || row.version === 0)
      throw new StorypaneError(
        'invalid',
        'Deploy the initial schema migration before pulling schemas or generating types',
      );
    return {
      migrationVersion: row.version,
      components: (row.definitions as BlockDefinition[]).map((definition) => ({
        id: definition.id,
        name: definition.name,
        kind: definition.kind,
        version: definition.version,
        tags: definition.tags ?? [],
        fields: definition.fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required ?? false,
          ...(field.type === 'text' ? { format: field.format } : {}),
          ...(field.type === 'blocks'
            ? {
                allowedDefinitionIds: field.allowedDefinitionIds ?? [],
                allowedTags: field.allowedTags ?? [],
              }
            : {}),
          ...((field.type === 'option' || field.type === 'options') &&
          field.source.type === 'inline'
            ? { options: field.source.items.map((item) => item.value) }
            : {}),
        })),
      })),
    };
  }
  async authorizePublishedAsset(token: string, spaceId: string, assetId: string): Promise<void> {
    await this.authenticateDelivery(token, spaceId);
    parseInput(z.uuid(), assetId);
    if (!(await isPublishedAsset(this.pool, spaceId, assetId)))
      throw new StorypaneError('not_found', 'Published asset not found');
  }
  async getPublicMediaSettings(actor: Actor): Promise<{ enabled: boolean }> {
    return this.tx(
      actor,
      async (client) =>
        (
          await client.query('SELECT public_media AS enabled FROM spaces WHERE id=$1', [
            actor.spaceId,
          ])
        ).rows[0],
    );
  }
  async updatePublicMediaSettings(actor: Actor, raw: unknown): Promise<{ enabled: boolean }> {
    const input = parseInput(z.object({ enabled: z.boolean() }).strict(), raw);
    return this.tx(
      actor,
      async (client) => {
        await client.query('UPDATE spaces SET public_media=$2 WHERE id=$1', [
          actor.spaceId,
          input.enabled,
        ]);
        return input;
      },
      'admin',
    );
  }
  async listAssetUsage(actor: Actor, assetId: string, raw: unknown = {}): Promise<AssetUsagePage> {
    parseInput(z.uuid(), assetId);
    const { cursor } = parseInput(
      z.object({ cursor: z.coerce.number().int().min(0).max(1000000).default(0) }).strict(),
      raw,
    );
    return this.tx(actor, async (client) => {
      if (
        !(
          await client.query('SELECT 1 FROM assets WHERE id=$1 AND space_id=$2', [
            assetId,
            actor.spaceId,
          ])
        ).rowCount
      )
        throw new StorypaneError('not_found', 'Asset not found');
      const access = await this.contentAccess(client, actor);
      const { rows } = await client.query<AssetUsage>(
        `WITH usage AS (
        SELECT s.id AS "storyId",s.name AS "storyName",s.folder_id AS "folderId",
          l.id AS "localeId",l.slug AS "localeSlug",l.name AS "localeName",l.space_locale_id AS "spaceLocaleId",
          b.id AS "blockId",v.definition_id AS "definitionId",v.schema->>'displayName' AS "blockName",
          coalesce(f->>'id','') AS "fieldId",f->>'name' AS "fieldName",f->>'label' AS "fieldLabel",'draft' AS state
        FROM stories s JOIN story_locales l ON l.story_id=s.id JOIN block_drafts b ON b.locale_id=l.id
          JOIN definition_versions v ON v.id=b.schema_version_id
          CROSS JOIN LATERAL jsonb_array_elements(v.schema->'fields') f
        WHERE s.space_id=$1 AND s.deleted_at IS NULL
          AND ((f->>'type' IN ('asset','link') AND b.fields->(f->>'name')->>'assetId'=$2) OR
            (f->>'type'='text' AND f->>'format'='richtext' AND jsonb_path_exists(b.fields->(f->>'name'),'$.**.assetId ? (@ == $assetId)',jsonb_build_object('assetId',$2::text))))
        UNION ALL
        SELECT s.id,coalesce(p.snapshot->'story'->>'name',s.name),s.folder_id,
          l.id,l.slug,l.name,l.space_locale_id,(b->>'id')::uuid,(d->>'id')::uuid,d->>'displayName',
          coalesce(f->>'id',''),f->>'name',f->>'label','published'
        FROM stories s JOIN story_locales l ON l.story_id=s.id JOIN publications p ON p.id=l.published_version_id
          CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'blocks') b
          CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'definitions') d
          CROSS JOIN LATERAL jsonb_array_elements(d->'fields') f
        WHERE s.space_id=$1 AND s.deleted_at IS NULL AND d->>'versionId'=b->>'schemaVersionId'
          AND ((f->>'type' IN ('asset','link') AND b->'fields'->(f->>'name')->>'assetId'=$2) OR
            (f->>'type'='text' AND f->>'format'='richtext' AND jsonb_path_exists(b->'fields'->(f->>'name'),'$.**.assetId ? (@ == $assetId)',jsonb_build_object('assetId',$2::text))))
      ) SELECT * FROM usage WHERE "localeId"=ANY($4::uuid[]) AND ($5::uuid[] IS NULL OR "definitionId"=ANY($5)) AND ($6::text[] IS NULL OR "fieldId"=ANY($6)) ORDER BY "storyId","localeId","blockId","fieldName",state LIMIT 41 OFFSET $3`,
        [
          actor.spaceId,
          assetId,
          cursor,
          access.locales.map((locale) => locale.id),
          access.admin ? null : access.scopes.read.definitionIds,
          access.admin ? null : access.scopes.read.fieldIds,
        ],
      );
      return {
        items: rows.slice(0, 40),
        nextCursor: rows.length > 40 ? String(cursor + 40) : null,
      };
    });
  }
  async publishedStories(
    token: string,
    spaceId: string,
    raw: unknown,
  ): Promise<{ migrationVersion: number; stories: DeliveredStory[]; nextOffset: number | null }> {
    await this.authenticateDelivery(token, spaceId);
    const input = parseInput(deliveryQuerySchema, raw);
    const { rows } = await this.pool.query(
      `WITH page AS (
      SELECT s.id AS story_id,p.snapshot->'story'->>'name' AS name,coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug) AS slug,l.slug AS locale,l.id AS locale_id,p.revision,p.content,p.created_at AS published_at
      FROM stories s JOIN story_locales l ON l.story_id=s.id JOIN publications p ON p.id=l.published_version_id
      WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.slug=coalesce($2,(SELECT slug FROM space_locales WHERE space_id=$1 AND is_default)) AND ($3::uuid IS NULL OR s.id=$3) AND ($4::text IS NULL OR coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug)=$4)
      ORDER BY coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug),s.id LIMIT $5 OFFSET $6)
      SELECT s.schema_version,coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.slug,page.story_id) FILTER(WHERE page.locale_id IS NOT NULL),'[]') AS stories
      FROM spaces s LEFT JOIN page ON true WHERE s.id=$1 GROUP BY s.schema_version`,
      [
        spaceId,
        input.locale ?? null,
        input.id ?? null,
        input.slug ?? null,
        input.limit + 1,
        input.offset,
      ],
    );
    const version = Number(rows[0].schema_version),
      stories: Row[] = rows[0].stories;
    return {
      migrationVersion: version,
      stories: stories
        .slice(0, input.limit)
        .map((row) => deliveredRow({ ...row, migration_version: version })),
      nextOffset: stories.length > input.limit ? input.offset + input.limit : null,
    };
  }
  private async readReleaseSnapshot(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    localeId: string,
    scheduleId: string,
    revision: number,
  ) {
    const { rows } = await client.query(
      `SELECT p.*,st.folder_id FROM publication_schedules p
       JOIN content_releases r ON r.id=p.release_id AND r.space_id=p.space_id
       JOIN stories st ON st.id=p.story_id AND st.space_id=p.space_id
       WHERE p.id=$1 AND p.space_id=$2 AND p.story_id=$3 AND p.locale_id=$4
       AND p.status='pending' AND r.status IN ('scheduled','held') AND st.deleted_at IS NULL`,
      [scheduleId, actor.spaceId, storyId, localeId],
    );
    const schedule = rows[0];
    if (!schedule)
      throw new StorypaneError('not_found', 'This page is no longer in an upcoming release.');
    if (Number(schedule.revision) !== revision)
      throw new StorypaneError(
        'stale_revision',
        'The approved release version changed. Refresh the release view.',
      );
    if (!schedule.approved_snapshot)
      throw new StorypaneError(
        'invalid',
        'Update this release approval before previewing its saved version.',
      );
    const snapshot: LocaleSnapshot = schedule.approved_snapshot;
    snapshot.story.folderId = schedule.folder_id;
    snapshot.leases = [];
    return { schedule, snapshot };
  }
  async getScheduledSnapshot(
    actor: Actor,
    storyId: string,
    localeId: string,
    id: string,
    revision: number,
  ) {
    parseInput(z.object({ id: z.uuid(), revision: z.number().int().positive() }), { id, revision });
    return this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      return (await this.readReleaseSnapshot(client, actor, storyId, localeId, id, revision))
        .snapshot;
    });
  }
  async createEditorPreview(
    actor: Actor,
    storyId: string,
    localeId: string,
    raw: unknown = {},
  ): Promise<PreviewSession> {
    const input = parseInput(
      z
        .object({
          previewId: z.uuid().optional(),
          scheduleId: z.uuid().optional(),
          scheduleRevision: z.number().int().positive().optional(),
        })
        .strict()
        .refine(
          (value) => !!value.scheduleId === (value.scheduleRevision !== undefined),
          'Provide the release schedule and its revision together',
        ),
      raw,
    );
    return this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      const access = await this.contentAccess(client, actor);
      const snapshot = input.scheduleId
        ? (
            await this.readReleaseSnapshot(
              client,
              actor,
              storyId,
              localeId,
              input.scheduleId,
              input.scheduleRevision!,
            )
          ).snapshot
        : await this.snapshot(client, actor, storyId, localeId);
      if (!projectSnapshot(access, snapshot).access.preview)
        throw new StorypaneError(
          'forbidden',
          'Preview requires read access to every field and reference',
        );
      return this.insertPreview(
        client,
        actor.spaceId,
        storyId,
        localeId,
        { userId: actor.userId, sessionId: actor.sessionId },
        input.previewId,
        input.scheduleId
          ? { id: input.scheduleId, revision: input.scheduleRevision!, snapshot }
          : undefined,
      );
    });
  }
  async createTokenPreview(token: string, spaceId: string, raw: unknown): Promise<PreviewSession> {
    const credential = await this.authenticateDelivery(token, spaceId, true);
    const input = parseInput(
      z
        .object({
          id: z.uuid().optional(),
          slug: z.string().max(2048).optional(),
          locale: z.string().max(80).optional(),
          previewId: z.uuid().optional(),
        })
        .strict()
        .refine((value) => !!value.id !== (value.slug !== undefined), 'Specify either id or slug'),
      raw,
    );
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query(
        'SELECT s.id AS story_id,l.id AS locale_id FROM stories s JOIN story_locales l ON l.story_id=s.id WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.slug=coalesce($2,(SELECT slug FROM space_locales WHERE space_id=$1 AND is_default)) AND ($3::uuid IS NULL OR s.id=$3) AND ($4::text IS NULL OR l.url_slug=$4)',
        [spaceId, input.locale ?? null, input.id ?? null, input.slug ?? null],
      );
      if (!rows[0]) throw new StorypaneError('not_found', 'Story locale not found');
      return await this.insertPreview(
        client,
        spaceId,
        rows[0].story_id,
        rows[0].locale_id,
        { tokenId: credential.id },
        input.previewId,
      );
    } finally {
      client.release();
    }
  }
  private async insertPreview(
    client: PoolClient,
    spaceId: string,
    storyId: string,
    localeId: string,
    owner: { userId?: string; sessionId?: string; tokenId?: string },
    previewId?: string,
    release?: { id: string; revision: number; snapshot: LocaleSnapshot },
  ): Promise<PreviewSession> {
    const { rows } = await client.query(
      'SELECT s.preview_urls,s.default_preview_id,m.personal_default_preview_id,l.url_slug AS slug,l.slug AS locale FROM spaces s JOIN stories st ON st.space_id=s.id JOIN story_locales l ON l.story_id=st.id LEFT JOIN memberships m ON m.space_id=s.id AND m.user_id=$4 WHERE s.id=$1 AND st.id=$2 AND st.deleted_at IS NULL AND l.id=$3',
      [spaceId, storyId, localeId, owner.userId ?? null],
    );
    const settings: Pick<
      UserDeliverySettings,
      'previewUrls' | 'defaultPreviewId' | 'personalDefaultPreviewId'
    > = {
      previewUrls: rows[0]?.preview_urls ?? [],
      defaultPreviewId: rows[0]?.default_preview_id ?? null,
      personalDefaultPreviewId: rows[0]?.personal_default_preview_id ?? null,
    };
    const target = previewId
      ? settings.previewUrls.find((item) => item.id === previewId)
      : defaultPreview(settings);
    if (!target)
      throw new StorypaneError('invalid', 'Choose a configured preview URL in Space settings');
    const origin = new URL(target.url).origin;
    const token = secretToken('bp');
    await client.query('DELETE FROM preview_sessions WHERE space_id=$1 AND expires_at<now()', [
      spaceId,
    ]);
    const session = await client.query(
      "INSERT INTO preview_sessions(token_hash,space_id,story_id,locale_id,origin,user_id,session_id,delivery_token_id,publication_schedule_id,schedule_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '5 minutes') RETURNING expires_at",
      [
        tokenHash(token),
        spaceId,
        storyId,
        localeId,
        origin,
        owner.userId ?? null,
        owner.sessionId ?? null,
        owner.tokenId ?? null,
        release?.id ?? null,
        release?.revision ?? null,
      ],
    );
    await this.options.registerPreview?.(tokenHash(token), session.rows[0].expires_at);
    return {
      token,
      expiresAt: iso(session.rows[0].expires_at),
      spaceId,
      storyId,
      localeId,
      slug: release?.snapshot.locale.urlSlug ?? rows[0].slug,
      locale: release?.snapshot.locale.slug ?? rows[0].locale,
    };
  }
  async authenticatePreview(
    token: string,
    origin: string,
  ): Promise<{ id: string; spaceId: string; storyId: string; localeId: string }> {
    if (!/^bp_[\w-]{43}$/.test(token))
      throw new StorypaneError('unauthenticated', 'Invalid preview session');
    const { rows } = await this.pool.query(
      'SELECT p.id,p.space_id AS "spaceId",p.story_id AS "storyId",p.locale_id AS "localeId",s.preview_urls FROM preview_sessions p JOIN spaces s ON s.id=p.space_id WHERE p.token_hash=$1 AND p.origin=$2 AND p.expires_at>clock_timestamp()',
      [tokenHash(token), origin],
    );
    if (
      !rows[0] ||
      !(rows[0].preview_urls as DeliverySettings['previewUrls']).some(
        (item) => new URL(item.url).origin === origin,
      )
    )
      throw new StorypaneError(
        'unauthenticated',
        'Preview session expired or origin is not allowed',
      );
    await this.previewStory(rows[0].id);
    const { preview_urls: _urls, ...session } = rows[0];
    return session as { id: string; spaceId: string; storyId: string; localeId: string };
  }
  async previewStory(previewId: string): Promise<DeliveredStory> {
    const { rows } = await this.pool.query(
      `SELECT p.space_id,p.user_id,p.session_id,p.publication_schedule_id,ps.release_id,ps.approved_snapshot AS release_snapshot,st.folder_id,sp.schema_version AS migration_version,st.id AS story_id,st.name,l.url_slug AS slug,l.slug AS locale,l.id AS locale_id,c.revision,c.content,c.snapshot
      FROM preview_sessions p JOIN spaces sp ON sp.id=p.space_id JOIN stories st ON st.id=p.story_id AND st.space_id=p.space_id
      JOIN story_locales l ON l.id=p.locale_id AND l.story_id=st.id
      LEFT JOIN publication_schedules ps ON ps.id=p.publication_schedule_id AND ps.locale_id=p.locale_id AND ps.space_id=p.space_id
      LEFT JOIN content_releases cr ON cr.id=ps.release_id AND cr.space_id=p.space_id
      JOIN checkpoints c ON c.id=coalesce(ps.checkpoint_id,l.checkpoint_id)
      WHERE p.id=$1 AND st.deleted_at IS NULL AND p.expires_at>clock_timestamp()
      AND (p.publication_schedule_id IS NULL OR (ps.status='pending' AND ps.revision=p.schedule_revision AND cr.status IN ('scheduled','held') AND ps.approved_snapshot IS NOT NULL)) AND (
        ${
          this.options.authorizeSession
            ? 'EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=p.user_id AND m.space_id=p.space_id)'
            : 'EXISTS(SELECT 1 FROM cms_sessions se JOIN memberships m ON m.user_id=se.user_id AND m.space_id=p.space_id WHERE se.id=p.session_id AND se.user_id=p.user_id AND se.expires_at>clock_timestamp())'
        }
        OR EXISTS(SELECT 1 FROM delivery_tokens t WHERE t.id=p.delivery_token_id AND t.space_id=p.space_id AND t.scope='preview' AND t.revoked_at IS NULL))`,
      [previewId],
    );
    if (!rows[0])
      throw new StorypaneError('unauthenticated', 'Preview access expired or was revoked');
    const releaseId: string | undefined = rows[0].release_id;
    if (releaseId) {
      const approved: LocaleSnapshot = rows[0].release_snapshot;
      rows[0].snapshot = approved;
      rows[0].content = assembleContent(approved);
      rows[0].revision = approved.revision;
      rows[0].migration_version = approved.migrationVersion;
      rows[0].name = approved.story.name;
      rows[0].slug = approved.locale.urlSlug;
    }
    rows[0].snapshot.story.folderId = rows[0].folder_id;
    if (rows[0].user_id) {
      const actor: Actor = {
        spaceId: rows[0].space_id,
        userId: rows[0].user_id,
        sessionId: rows[0].session_id,
        role: '',
      };
      await this.tx(actor, async (client) => {
        assertSnapshotAccess(
          await this.contentAccess(client, actor),
          rows[0].snapshot,
          'content:read',
        );
      });
    }
    const story = deliveredRow(rows[0]),
      snapshot = rows[0].snapshot as LocaleSnapshot,
      ids = new Set<string>();
    // shortcut: Resolve direct story references only; add traversal when nested shared stories need it.
    for (const block of snapshot.blocks) {
      const definition = snapshot.definitions.find(
        (item) => item.versionId === block.schemaVersionId,
      );
      for (const field of definition?.fields ?? []) {
        const value = block.fields[field.name];
        let values: Json[] = [];
        if (
          (field.type === 'option' || field.type === 'options') &&
          field.source.type === 'stories'
        )
          values = Array.isArray(value) ? value : [value ?? null];
        if (
          field.type === 'link' &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          value.type === 'story'
        )
          values = [value.storyId];
        for (const id of values)
          if (typeof id === 'string' && z.uuid().safeParse(id).success) ids.add(id);
      }
    }
    const references = ids.size
      ? (
          await this.pool.query(
            `SELECT DISTINCT ON (st.id) st.id AS story_id,st.name,l.url_slug AS slug,l.slug AS locale,l.id AS locale_id,c.revision,c.content,
      CASE WHEN $4::uuid IS NULL THEN c.snapshot ELSE coalesce(ps.approved_snapshot,pub.snapshot) END AS snapshot
      FROM stories st JOIN story_locales l ON l.story_id=st.id
      LEFT JOIN publication_schedules ps ON ps.locale_id=l.id AND ps.release_id=$4 AND ps.status='pending'
      LEFT JOIN publications pub ON pub.id=l.published_version_id
      JOIN checkpoints c ON c.id=CASE WHEN $4::uuid IS NULL THEN l.checkpoint_id ELSE coalesce(ps.checkpoint_id,pub.checkpoint_id) END AND c.locale_id=l.id
      WHERE st.space_id=$1 AND st.deleted_at IS NULL AND st.id=ANY($2::uuid[]) AND l.slug IN ($3,(SELECT slug FROM space_locales WHERE space_id=$1 AND is_default))
      ORDER BY st.id,(l.slug=$3) DESC`,
            [rows[0].space_id, [...ids], story.locale, releaseId ?? null],
          )
        ).rows
      : [];
    if (releaseId) {
      for (const row of references) {
        if (!row.snapshot)
          throw new StorypaneError(
            'invalid',
            'Update the linked release approval before previewing.',
          );
        const approved: LocaleSnapshot = row.snapshot;
        row.content = assembleContent(approved);
        row.revision = approved.revision;
        row.name = approved.story.name;
        row.slug = approved.locale.urlSlug;
      }
    }
    if (rows[0].user_id) {
      const actor: Actor = {
        spaceId: rows[0].space_id,
        userId: rows[0].user_id,
        sessionId: rows[0].session_id,
        role: '',
      };
      await this.tx(actor, async (client) => {
        const access = await this.contentAccess(client, actor);
        for (const reference of references) {
          const target = access.locales.find((locale) => locale.id === reference.locale_id);
          if (!target) throw new StorypaneError('forbidden', 'A referenced story is unavailable');
          const snapshot = {
            ...reference.snapshot,
            story: { ...reference.snapshot.story, folderId: target.folderId },
          };
          assertSnapshotAccess(access, snapshot, 'content:read');
        }
      });
    }
    const deliveredReferences = references.map((row) =>
      deliveredRow({ ...row, migration_version: story.migrationVersion }),
    );
    return {
      ...story,
      references: deliveredReferences,
      referencesRevision: digest(
        deliveredReferences.map((item) => [
          item.id,
          item.localeId,
          item.revision,
          item.name,
          item.slug,
        ]),
      ),
    };
  }
  private async tx<T>(
    actor: Actor,
    fn: (client: PoolClient) => Promise<T>,
    permission?: Permission | 'admin',
    exclusive = false,
  ): Promise<T> {
    if (this.transactionClient) {
      await this.authorize(this.transactionClient, actor, permission);
      const result = await fn(this.transactionClient);
      return hasContentResult(result)
        ? projectResult(await this.contentAccess(this.transactionClient, actor), result)
        : result;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        exclusive
          ? 'SELECT pg_advisory_xact_lock(hashtextextended($1,91))'
          : 'SELECT pg_advisory_xact_lock_shared(hashtextextended($1,91))',
        [actor.spaceId],
      );
      await this.authorize(client, actor, permission);
      const result = await fn(client);
      const projected = hasContentResult(result)
        ? projectResult(await this.contentAccess(client, actor), result)
        : result;
      await client.query('COMMIT');
      return projected;
    } catch (error) {
      await client.query('ROLLBACK');
      dbError(error);
    } finally {
      client.release();
    }
  }
  private async lockLocale(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    localeId: string,
  ): Promise<void> {
    const result = await client.query(
      'SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE l.id=$1 AND s.id=$2 AND s.space_id=$3 AND s.deleted_at IS NULL FOR UPDATE OF l',
      [localeId, storyId, actor.spaceId],
    );
    if (!result.rowCount) throw new StorypaneError('not_found', 'Story locale not found');
    if (
      !(await this.contentAccess(client, actor)).locales.some(
        (locale) => locale.id === localeId && locale.storyId === storyId,
      )
    )
      throw new StorypaneError('not_found', 'Story locale not found');
  }
  private async snapshot(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    localeId: string,
  ): Promise<LocaleSnapshot> {
    const story = await client.query(
      'SELECT s.*,f.form_only FROM stories s LEFT JOIN content_folders f ON f.id=s.folder_id WHERE s.id=$1 AND s.space_id=$2 AND s.deleted_at IS NULL',
      [storyId, actor.spaceId],
    );
    const locale = await client.query('SELECT * FROM story_locales WHERE id=$1 AND story_id=$2', [
      localeId,
      storyId,
    ]);
    if (!story.rowCount || !locale.rowCount)
      throw new StorypaneError('not_found', 'Story locale not found');
    const blocks = await client.query(
      'SELECT b.*, v.definition_id FROM block_drafts b JOIN definition_versions v ON v.id=b.schema_version_id WHERE b.locale_id=$1 ORDER BY b.position,b.id',
      [localeId],
    );
    const versions = await client.query(
      'SELECT DISTINCT v.* FROM definition_versions v JOIN block_drafts b ON b.schema_version_id=v.id WHERE b.locale_id=$1',
      [localeId],
    );
    const leases = await client.query(
      'SELECT * FROM edit_leases WHERE locale_id=$1 AND expires_at>clock_timestamp()',
      [localeId],
    );
    const migrationVersion = Number(
      (await client.query('SELECT schema_version FROM spaces WHERE id=$1', [actor.spaceId])).rows[0]
        .schema_version,
    );
    const snapshot: LocaleSnapshot = {
      migrationVersion,
      story: storyRow(story.rows[0]),
      locale: localeRow(locale.rows[0]),
      blocks: blocks.rows.map(blockRow),
      definitions: versions.rows.map(definitionRow),
      leases: leases.rows.map((r) => ({
        blockId: r.block_id,
        userId: r.user_id,
        sessionId: r.session_id,
        expiresAt: iso(r.expires_at),
        ...(r.session_id === actor.sessionId && r.user_id === actor.userId
          ? { token: r.token }
          : {}),
      })),
      revision: Number(locale.rows[0].revision),
      checkpointId: locale.rows[0].checkpoint_id,
    };
    const publication = snapshot.locale.publishedVersionId
      ? (
          await client.query(
            "SELECT content,snapshot->'locale'->>'urlSlug' AS slug FROM publications WHERE id=$1",
            [snapshot.locale.publishedVersionId],
          )
        ).rows[0]
      : null;
    // Publishing itself creates a checkpoint; compare delivered content, not revision IDs.
    snapshot.publicationStatus = !publication
      ? 'draft'
      : canonical(assembleContent(snapshot)) === canonical(publication.content) &&
          (publication.slug ?? snapshot.locale.urlSlug) === snapshot.locale.urlSlug
        ? 'published'
        : 'changed';
    return snapshot;
  }
  private async checkpoint(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    localeId: string,
    reason: string,
  ): Promise<LocaleSnapshot> {
    const previous = (
      await client.query<{ content: Json; path: string }>(
        "SELECT c.content,c.snapshot->'locale'->>'urlSlug' AS path FROM story_locales l JOIN checkpoints c ON c.id=l.checkpoint_id WHERE l.id=$1",
        [localeId],
      )
    ).rows[0];
    const checkpointId = randomUUID();
    await client.query(
      'UPDATE story_locales SET revision=revision+1,checkpoint_id=$2 WHERE id=$1',
      [localeId, checkpointId],
    );
    await client.query(
      'UPDATE stories SET updated_at=clock_timestamp(),updated_by=$2 WHERE id=$1',
      [storyId, actor.userId],
    );
    const snapshot = await this.snapshot(client, actor, storyId, localeId);
    // shortcut: full snapshots per autosave batch; switch to deltas when measured history storage warrants it.
    await client.query(
      'INSERT INTO checkpoints(id,locale_id,revision,actor_id,reason,snapshot,content) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        checkpointId,
        localeId,
        snapshot.revision,
        actor.userId,
        reason,
        JSON.stringify({ ...snapshot, leases: [] }),
        JSON.stringify(assembleContent(snapshot)),
      ],
    );
    if (
      !['publishCheckpoint', 'unpublishLocale'].includes(reason) &&
      !reason.startsWith('Migration ') &&
      (reason === 'Restore deleted story' ||
        !previous ||
        canonicalJson(previous.content) !== canonicalJson(assembleContent(snapshot)) ||
        previous.path !== snapshot.locale.urlSlug)
    ) {
      const data = {
        storyId,
        localeId,
        locale: snapshot.locale.slug,
        checkpointId,
        revision: snapshot.revision,
        path: snapshot.locale.urlSlug,
      };
      await webhooks.recordWebhookEvent(client, {
        spaceId: actor.spaceId,
        actorId: actor.userId,
        type: 'story.saved',
        key: 'story.saved:' + checkpointId,
        data,
      });
      if (previous && previous.path !== snapshot.locale.urlSlug)
        await webhooks.recordWebhookEvent(client, {
          spaceId: actor.spaceId,
          actorId: actor.userId,
          type: 'story.moved',
          key: 'story.moved:' + checkpointId,
          data: { ...data, oldPath: previous.path },
        });
    }
    return snapshot;
  }
  async listDefinitions(actor: Actor, deployed = false): Promise<BlockDefinition[]> {
    return this.tx(actor, async (client) => {
      const access = await this.contentAccess(client, actor);
      const definitions = deployed
        ? (await this.deployedMigration(client, actor.spaceId)).definitions
        : await this.definitionHeads(client, actor.spaceId, true);
      if (unrestrictedRead(access)) return definitions;
      if (
        !access.permissions.includes('content:read') ||
        access.scopes.read.localeIds?.length === 0 ||
        (access.scopes.read.locations &&
          !access.scopes.read.locations.folderIds.length &&
          !access.scopes.read.locations.storyIds.length)
      )
        return [];
      return definitions
        .filter(
          (definition) =>
            !access.scopes.read.definitionIds ||
            access.scopes.read.definitionIds.includes(definition.id),
        )
        .map((definition) => ({
          ...definition,
          fields: definition.fields
            .filter(
              (field) =>
                !access.scopes.read.fieldIds ||
                (!!field.id && access.scopes.read.fieldIds.includes(field.id)),
            )
            .map((field) => {
              const { defaultValue: _defaultValue, ...safe } = field;
              return safe;
            }),
        }))
        .filter(
          (definition) => access.scopes.read.fieldIds === null || definition.fields.length > 0,
        );
    });
  }
  async listDefinitionReferenceCounts(actor: Actor): Promise<Record<string, number>> {
    return this.tx(actor, async (client) => {
      const access = await this.contentAccess(client, actor);
      const { rows } = await client.query<{ definition_id: string; total: number }>(
        `WITH usage AS (
          SELECT v.definition_id,s.id AS story_id
          FROM stories s JOIN story_locales l ON l.story_id=s.id
            JOIN block_drafts b ON b.locale_id=l.id JOIN definition_versions v ON v.id=b.schema_version_id
          WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.id=ANY($2::uuid[])
            AND ($3::uuid[] IS NULL OR v.definition_id=ANY($3))
            AND ($4::text[] IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.schema->'fields') f WHERE f->>'id'=ANY($4)))
          UNION ALL
          SELECT (d->>'id')::uuid,s.id
          FROM stories s JOIN story_locales l ON l.story_id=s.id JOIN publications p ON p.id=l.published_version_id
            CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'blocks') b
            CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'definitions') d
          WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.id=ANY($2::uuid[])
            AND d->>'versionId'=b->>'schemaVersionId'
            AND ($3::uuid[] IS NULL OR (d->>'id')::uuid=ANY($3))
            AND ($4::text[] IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'fields') f WHERE f->>'id'=ANY($4)))
        ) SELECT definition_id,count(DISTINCT story_id)::int AS total
          FROM usage GROUP BY definition_id`,
        [
          actor.spaceId,
          access.locales.map((locale) => locale.id),
          access.admin ? null : access.scopes.read.definitionIds,
          access.admin ? null : access.scopes.read.fieldIds,
        ],
      );
      return Object.fromEntries(rows.map((row) => [row.definition_id, row.total]));
    });
  }
  async listDefinitionReferences(
    actor: Actor,
    definitionId: string,
    raw: unknown = {},
  ): Promise<DefinitionReferencesPage> {
    parseInput(z.uuid(), definitionId);
    const { cursor } = parseInput(
      z.object({ cursor: z.coerce.number().int().min(0).max(1000000).default(0) }).strict(),
      raw,
    );
    return this.tx(actor, async (client) => {
      if (
        !(
          await client.query('SELECT 1 FROM definitions WHERE id=$1 AND space_id=$2', [
            definitionId,
            actor.spaceId,
          ])
        ).rowCount
      )
        throw new StorypaneError('not_found', 'Definition not found');
      const access = await this.contentAccess(client, actor);
      if (
        !access.admin &&
        access.scopes.read.definitionIds &&
        !access.scopes.read.definitionIds.includes(definitionId)
      )
        return { total: 0, items: [], nextCursor: null };
      const { rows } = await client.query<{
        total: number;
        items: DefinitionReferencesPage['items'];
      }>(
        `WITH usage AS (
          SELECT s.id AS story_id,s.name AS story_name,l.id AS locale_id,l.name AS locale_name,
            l.slug AS locale_slug,l.url_slug AS path,b.id::text AS block_id,true AS draft,false AS published
          FROM stories s JOIN story_locales l ON l.story_id=s.id
            JOIN block_drafts b ON b.locale_id=l.id JOIN definition_versions v ON v.id=b.schema_version_id
          WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.id=ANY($4::uuid[]) AND v.definition_id=$2
            AND ($5::text[] IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.schema->'fields') f WHERE f->>'id'=ANY($5)))
          UNION ALL
          SELECT s.id,s.name,l.id,l.name,l.slug,l.url_slug,NULL,false,true
          FROM stories s JOIN story_locales l ON l.story_id=s.id JOIN publications p ON p.id=l.published_version_id
            CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'blocks') b
            CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'definitions') d
          WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.id=ANY($4::uuid[])
            AND d->>'id'=$2::text AND d->>'versionId'=b->>'schemaVersionId'
            AND ($5::text[] IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'fields') f WHERE f->>'id'=ANY($5)))
        ), locales AS (
          SELECT story_id,story_name,locale_id,locale_name,locale_slug,path,min(block_id) AS block_id,
            bool_or(draft) AS draft,bool_or(published) AS published
          FROM usage GROUP BY story_id,story_name,locale_id,locale_name,locale_slug,path
        ), referenced_stories AS (
          SELECT story_id AS "storyId",story_name AS "storyName",
            jsonb_agg(jsonb_build_object('localeId',locale_id,'localeName',locale_name,'localeSlug',locale_slug,'path',path,'blockId',block_id,'draft',draft,'published',published)
              ORDER BY (locale_slug='') DESC,locale_name,locale_id) AS locales
          FROM locales GROUP BY story_id,story_name
        ) SELECT (SELECT count(*)::int FROM referenced_stories) AS total,
          coalesce((SELECT jsonb_agg(page ORDER BY "storyName","storyId") FROM (
            SELECT * FROM referenced_stories ORDER BY "storyName","storyId" LIMIT 21 OFFSET $3
          ) page),'[]'::jsonb) AS items`,
        [
          actor.spaceId,
          definitionId,
          cursor,
          access.locales.map((locale) => locale.id),
          access.admin ? null : access.scopes.read.fieldIds,
        ],
      );
      return {
        total: rows[0].total,
        items: rows[0].items.slice(0, 20),
        nextCursor: rows[0].items.length > 20 ? String(cursor + 20) : null,
      };
    });
  }
  private async definitionHeads(
    client: PoolClient,
    spaceId: string,
    workspace = false,
  ): Promise<BlockDefinition[]> {
    return (
      await client.query(
        `SELECT v.*,d.parent_definition_id FROM definitions d JOIN definition_versions v ON v.definition_id=d.id AND v.version=d.current_version
          WHERE d.space_id=$1 AND (NOT $2::boolean OR d.id IN (
            SELECT (entry->>'id')::uuid FROM jsonb_array_elements((SELECT definitions FROM schema_migrations WHERE space_id=$1 ORDER BY version DESC LIMIT 1)) entry
          )) ORDER BY d.name`,
        [spaceId, workspace],
      )
    ).rows.map(definitionRow);
  }
  private async deployedMigration(client: PoolClient, spaceId: string): Promise<SchemaMigration> {
    const row = (
      await client.query(
        'SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id AND s.schema_version=m.version WHERE s.id=$1',
        [spaceId],
      )
    ).rows[0];
    if (!row) throw new StorypaneError('invalid', 'Initialize this space before editing schemas');
    return migrationRow(row);
  }
  private async validateDefinition(
    client: PoolClient,
    actor: Actor,
    input: DefinitionInput,
    incoming?: { id: string; schema: DefinitionInput }[],
  ): Promise<void> {
    const issues = validateFields(input, defaultFields(input));
    if (issues.length) throw new StorypaneError('invalid', 'Invalid default values', issues);
    await this.validateReferences(client, actor, input, defaultFields(input));
    if (input.previewData) {
      const definitions =
        incoming ??
        (await this.definitionHeads(client, actor.spaceId, true)).map((definition) => ({
          id: definition.id,
          schema: definitionInput(definition),
        }));
      const byName = new Map(
        definitions.map((definition) => [
          definition.schema.name,
          {
            ...definition,
            schema: definition.schema.name === input.name ? input : definition.schema,
          },
        ]),
      );
      const visit = async (schema: DefinitionInput, values: Record<string, Json>) => {
        const scalar = Object.fromEntries(
          Object.entries(values).filter(
            ([name]) => schema.fields.find((field) => field.name === name)?.type !== 'blocks',
          ),
        );
        const issues = validateFields(schema, scalar);
        if (issues.length) throw new StorypaneError('invalid', 'Invalid preview data', issues);
        await this.validateReferences(client, actor, schema, scalar);
        for (const field of schema.fields) {
          if (field.type !== 'blocks' || values[field.name] === undefined) continue;
          const children = values[field.name];
          if (!Array.isArray(children))
            throw new StorypaneError('invalid', 'Preview child blocks must be an array');
          if (field.maxItems !== undefined && children.length > field.maxItems)
            throw new StorypaneError('invalid', 'Preview child blocks exceed the field maximum');
          for (const child of children) {
            if (
              !child ||
              typeof child !== 'object' ||
              Array.isArray(child) ||
              typeof child._uid !== 'string' ||
              typeof child.component !== 'string'
            )
              throw new StorypaneError('invalid', 'Preview child blocks need _uid and component');
            const definition = byName.get(child.component);
            if (!definition || !isBlockAllowed(field, { id: definition.id, ...definition.schema }))
              throw new StorypaneError(
                'invalid',
                'A preview child block is not allowed in this field',
              );
            const { _uid, component, ...fields } = child;
            await visit(definition.schema, fields);
          }
        }
      };
      await visit(input, input.previewData);
    }
    for (const field of input.fields) {
      if (
        (field.type === 'option' || field.type === 'options') &&
        field.source.type === 'datasource'
      ) {
        if (
          !(
            await client.query('SELECT id FROM datasources WHERE id=$1 AND space_id=$2', [
              field.source.datasourceId,
              actor.spaceId,
            ])
          ).rowCount
        )
          throw new StorypaneError('invalid', 'Datasource must belong to this space');
      }
      if (field.type === 'blocks' && field.allowedDefinitionIds?.length) {
        const found = await client.query(
          'SELECT id FROM definitions WHERE id=ANY($1::uuid[]) AND space_id=$2',
          [field.allowedDefinitionIds, actor.spaceId],
        );
        if (found.rowCount !== new Set(field.allowedDefinitionIds).size)
          throw new StorypaneError(
            'invalid',
            'Allowed block definitions must belong to this space',
          );
      }
    }
  }
  private async identifyFields(
    client: PoolClient,
    definitionId: string,
    input: DefinitionInput,
    previous?: BlockDefinition,
  ): Promise<DefinitionInput> {
    const known = (
      await client.query(
        "SELECT DISTINCT field->>'id' AS id FROM definition_versions,jsonb_array_elements(schema->'fields') field WHERE definition_id=$1",
        [definitionId],
      )
    ).rows.map((row) => row.id);
    return {
      ...input,
      fields: input.fields.map((field) => {
        const retained = field.id
          ? previous?.fields.find((old) => old.id === field.id)
          : previous?.fields.find((old) => old.name === field.name);
        // Transfers preserve identities from immutable history when rebasing a developer branch.
        if (field.id && !retained && known.includes(field.id) && !this.incomingSchema)
          throw new StorypaneError(
            'invalid',
            'A deleted field identity cannot be reused; create a new field',
          );
        return { ...field, id: retained?.id ?? field.id ?? randomUUID() };
      }),
    };
  }
  private async activeMigration(client: PoolClient, actor: Actor): Promise<SchemaMigration> {
    // Serializes workspace saves while page editing remains concurrent.
    await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [actor.spaceId]);
    const row = (
      await client.query(
        "SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id WHERE m.space_id=$1 AND m.status='active'",
        [actor.spaceId],
      )
    ).rows[0];
    if (row) return migrationRow(row);
    const base = await this.deployedMigration(client, actor.spaceId);
    return migrationRow(
      (
        await client.query(
          "INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions) VALUES($1,$2,$3,$4,'active',$5) RETURNING *",
          [
            actor.spaceId,
            base.version + 1,
            base.version,
            `Migration ${base.version + 1}`,
            JSON.stringify(base.definitions),
          ],
        )
      ).rows[0],
    );
  }
  private async saveMigrationDefinitions(
    client: PoolClient,
    actor: Actor,
    migration: SchemaMigration,
    definitions: BlockDefinition[],
  ) {
    await client.query(
      'UPDATE schema_migrations SET definitions=$2,revision=revision+1,contributors=ARRAY(SELECT DISTINCT unnest(contributors || ARRAY[$3]::text[])) WHERE id=$1',
      [migration.id, JSON.stringify(definitions), actor.userId],
    );
  }
  async createDefinition(
    actor: Actor,
    value: unknown,
    baseVersion?: number,
    parentDefinitionId: string | null = null,
  ): Promise<BlockDefinition> {
    const input = parseInput(definitionInputSchema, value);
    const parent = parseInput(z.uuid().nullable(), parentDefinitionId);
    return this.tx(
      actor,
      async (client) => {
        const migration = await this.activeMigration(client, actor);
        if (baseVersion !== undefined && baseVersion !== migration.baseVersion)
          throw new StorypaneError(
            'stale_revision',
            'A migration was deployed. Reload the schema workspace.',
          );
        if (parent && !migration.definitions.some((item) => item.id === parent))
          throw new StorypaneError('invalid', 'Choose a parent from the current block library');
        await this.validateDefinition(client, actor, input);
        const definitionId = (
          await client.query(
            'INSERT INTO definitions(space_id,name,parent_definition_id) VALUES($1,$2,$3) RETURNING id',
            [actor.spaceId, input.name, parent],
          )
        ).rows[0].id;
        const schema = await this.identifyFields(client, definitionId, input);
        const definition = definitionRow(
          (
            await client.query(
              'INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,1,$2) RETURNING *',
              [definitionId, JSON.stringify(schema)],
            )
          ).rows[0],
        );
        await this.saveMigrationDefinitions(client, actor, migration, [
          ...migration.definitions,
          { ...definition, parentDefinitionId: parent },
        ]);
        return { ...definition, parentDefinitionId: parent };
      },
      'schemas:write',
    );
  }
  async updateDefinition(
    actor: Actor,
    definitionId: string,
    value: unknown,
    expectedVersionId?: string,
    baseVersion?: number,
  ): Promise<BlockDefinition> {
    const input = parseInput(definitionInputSchema, value);
    return this.tx(
      actor,
      async (client) => {
        const migration = await this.activeMigration(client, actor);
        const previous = migration.definitions.find((item) => item.id === definitionId);
        if (!previous) throw new StorypaneError('not_found', 'Definition not found');
        if (
          (expectedVersionId !== undefined && previous.versionId !== expectedVersionId) ||
          (baseVersion !== undefined && baseVersion !== migration.baseVersion)
        )
          throw new StorypaneError(
            'stale_revision',
            'The schema changed. Your edits are preserved; reload and review before saving.',
          );
        if (input.name !== previous.name)
          throw new StorypaneError('invalid', 'Definition API names cannot be renamed');
        const schema = await this.identifyFields(client, definitionId, input, previous);
        await this.validateDefinition(client, actor, schema);
        const parentRow = (
          await client.query(
            'SELECT parent_definition_id FROM definitions WHERE id=$1 AND space_id=$2',
            [definitionId, actor.spaceId],
          )
        ).rows[0];
        if (canonicalJson(schema) === canonicalJson(definitionInput(previous)))
          return { ...previous, parentDefinitionId: parentRow.parent_definition_id };
        const definition = definitionRow(
          (
            await client.query(
              'INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,$2,$3) RETURNING *',
              [definitionId, previous.version + 1, JSON.stringify(schema)],
            )
          ).rows[0],
        );
        await client.query('UPDATE definitions SET current_version=$2 WHERE id=$1', [
          definitionId,
          definition.version,
        ]);
        await this.saveMigrationDefinitions(
          client,
          actor,
          migration,
          migration.definitions.map((item) =>
            item.id === definitionId
              ? { ...definition, parentDefinitionId: parentRow.parent_definition_id }
              : item,
          ),
        );
        return { ...definition, parentDefinitionId: parentRow.parent_definition_id };
      },
      'schemas:write',
    );
  }
  async moveDefinition(actor: Actor, definitionId: string, raw: unknown): Promise<BlockDefinition> {
    const input = parseInput(definitionParentSchema, raw);
    return this.tx(
      actor,
      async (client) => {
        await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [actor.spaceId]);
        const migration = await this.activeMigration(client, actor);
        const definitions = await this.definitionHeads(client, actor.spaceId, true);
        const previous = definitions.find((item) => item.id === definitionId);
        if (!previous) throw new StorypaneError('not_found', 'Definition not found');
        if ((previous.parentDefinitionId ?? null) !== input.expectedParentDefinitionId)
          throw new StorypaneError(
            'stale_revision',
            'The parent changed. Reload before moving this block.',
          );
        const moved = { ...previous, parentDefinitionId: input.parentDefinitionId };
        validateDefinitionHierarchy(
          definitions.map((item) => (item.id === definitionId ? moved : item)),
        );
        await client.query(
          'UPDATE definitions SET parent_definition_id=$2 WHERE id=$1 AND space_id=$3',
          [definitionId, input.parentDefinitionId, actor.spaceId],
        );
        await this.saveMigrationDefinitions(
          client,
          actor,
          migration,
          definitions.map((item) => (item.id === definitionId ? moved : item)),
        );
        return moved;
      },
      'schemas:write',
    );
  }
  private async assertDefinitionUnused(
    client: PoolClient,
    actor: Actor,
    definitionId: string,
    definitions: BlockDefinition[],
  ): Promise<void> {
    const usage = await client.query(
      `SELECT EXISTS(SELECT 1 FROM block_drafts b JOIN definition_versions v ON v.id=b.schema_version_id
        JOIN story_locales l ON l.id=b.locale_id JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 AND v.definition_id=$2)
        OR EXISTS(SELECT 1 FROM stories s JOIN story_locales l ON l.story_id=s.id JOIN publications p ON p.id=l.published_version_id
        WHERE s.space_id=$1 AND p.snapshot->'blocks' @> $3::jsonb) AS used`,
      [actor.spaceId, definitionId, JSON.stringify([{ definitionId }])],
    );
    if (usage.rows[0].used)
      throw new StorypaneError(
        'invalid',
        'This block is still used by story content, including published or deleted stories. Remove those references before deleting it.',
      );
    for (const definition of definitions)
      for (const field of definition.fields)
        if (
          definition.id !== definitionId &&
          field.type === 'blocks' &&
          field.allowedDefinitionIds?.includes(definitionId)
        )
          throw new StorypaneError(
            'invalid',
            `Remove this block from Allowed blocks in ${definition.displayName} / ${field.label} before deleting it.`,
          );
    const folder = (await this.folders(client, actor.spaceId)).find(
      (item) =>
        item.defaultDefinitionId === definitionId ||
        item.allowedDefinitionIds.includes(definitionId),
    );
    if (folder)
      throw new StorypaneError(
        'invalid',
        `Remove this block from the content type settings for folder “${folder.name}” before deleting it.`,
      );
  }
  async deleteDefinition(actor: Actor, definitionId: string, raw: unknown): Promise<void> {
    parseInput(z.uuid(), definitionId);
    const input = parseInput(
      z
        .object({ expectedVersionId: z.uuid(), baseVersion: z.number().int().nonnegative() })
        .strict(),
      raw,
    );
    await this.tx(
      actor,
      async (client) => {
        assertUnrestrictedRead(await this.contentAccess(client, actor));
        const migration = await this.activeMigration(client, actor);
        const previous = migration.definitions.find((item) => item.id === definitionId);
        if (!previous) throw new StorypaneError('not_found', 'Definition not found');
        if (
          previous.versionId !== input.expectedVersionId ||
          migration.baseVersion !== input.baseVersion
        )
          throw new StorypaneError(
            'stale_revision',
            'The schema changed. Reload and review before deleting this block.',
          );
        await this.assertDefinitionUnused(client, actor, definitionId, migration.definitions);
        await this.saveMigrationDefinitions(
          client,
          actor,
          migration,
          migration.definitions
            .filter((item) => item.id !== definitionId)
            .map((item) =>
              item.parentDefinitionId === definitionId
                ? { ...item, parentDefinitionId: previous.parentDefinitionId ?? null }
                : item,
            ),
        );
        // Keep immutable versions for history; only move the surviving organizational children.
        await client.query(
          'UPDATE definitions SET parent_definition_id=(SELECT parent_definition_id FROM definitions WHERE id=$1) WHERE space_id=$2 AND parent_definition_id=$1',
          [definitionId, actor.spaceId],
        );
      },
      'schemas:write',
      true,
    );
  }
  private async currentDefinition(
    client: PoolClient,
    actor: Actor,
    definitionId: string,
  ): Promise<BlockDefinition> {
    const definition = (await this.deployedMigration(client, actor.spaceId)).definitions.find(
      (item) => item.id === definitionId,
    );
    if (!definition)
      throw new StorypaneError('invalid', 'Deploy this block schema before adding it to content');
    return definition;
  }
  async listMigrations(actor: Actor, workspace = false): Promise<SchemaMigration[]> {
    return this.tx(actor, async (client) => {
      assertUnrestrictedRead(await this.contentAccess(client, actor));
      return (
        await client.query(
          "SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id WHERE m.space_id=$1 AND (NOT $2 OR m.status='active' OR m.version=s.schema_version) ORDER BY m.version",
          [actor.spaceId, workspace],
        )
      ).rows.map(migrationRow);
    });
  }
  async authenticateManagement(
    token: string,
    spaceId: string,
    resource = 'migrations',
  ): Promise<Actor> {
    parseInput(z.uuid(), spaceId);
    if (!/^sm_[\w-]{43}$/.test(token))
      throw new StorypaneError('unauthenticated', 'A schema management token is required');
    const row = (
      await this.pool.query(
        'SELECT t.id,t.user_id,t.scopes,m.role FROM schema_management_tokens t JOIN memberships m ON m.space_id=t.space_id AND m.user_id=t.user_id WHERE t.token_hash=$1 AND t.space_id=$2 AND t.revoked_at IS NULL',
        [tokenHash(token), spaceId],
      )
    ).rows[0];
    if (!row) throw new StorypaneError('unauthenticated', 'Invalid or revoked management token');
    if (!row.scopes && resource !== 'migrations') {
      throw new StorypaneError('forbidden', 'This token only allows schema migrations');
    }
    return {
      userId: row.user_id,
      sessionId: `management:${row.id}`,
      spaceId,
      role: row.role,
      managementTokenId: row.id,
    };
  }
  async listManagementTokens(actor: Actor): Promise<ManagementToken[]> {
    return this.tx(
      actor,
      async (client) =>
        (
          await client.query(
            'SELECT id,name,capability,scopes,created_at FROM schema_management_tokens WHERE space_id=$1 AND revoked_at IS NULL ORDER BY created_at',
            [actor.spaceId],
          )
        ).rows.map((row) => ({
          id: row.id,
          name: row.name,
          capability: row.capability,
          scopes: row.scopes,
          createdAt: iso(row.created_at),
        })),
      'admin',
    );
  }
  async createManagementToken(
    actor: Actor,
    raw: unknown,
  ): Promise<ManagementToken & { token: string }> {
    const input = parseInput(
      z.union([
        managementTokenInputSchema,
        z
          .object({
            name: z.string().trim().min(1).max(80),
            capability: z.enum(['read', 'stage', 'deploy']),
          })
          .strict(),
      ]),
      raw,
    );
    if (actor.managementTokenId) throw new StorypaneError('forbidden', 'Sign in to manage tokens');
    return this.tx(
      actor,
      async (client) => {
        const token = secretToken('sm');
        const row = (
          await client.query(
            'INSERT INTO schema_management_tokens(space_id,user_id,name,capability,token_hash,scopes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at',
            [
              actor.spaceId,
              actor.userId,
              input.name,
              'capability' in input ? input.capability : 'read',
              tokenHash(token),
              'scopes' in input ? input.scopes : null,
            ],
          )
        ).rows[0];
        return {
          id: row.id,
          name: input.name,
          capability: 'capability' in input ? input.capability : 'read',
          scopes: 'scopes' in input ? input.scopes : null,
          createdAt: iso(row.created_at),
          token,
        };
      },
      'admin',
    );
  }
  async revokeManagementToken(actor: Actor, id: string) {
    parseInput(z.uuid(), id);
    if (actor.managementTokenId) throw new StorypaneError('forbidden', 'Sign in to manage tokens');
    return this.tx(
      actor,
      async (client) => {
        await client.query(
          'UPDATE schema_management_tokens SET revoked_at=now() WHERE id=$1 AND space_id=$2',
          [id, actor.spaceId],
        );
      },
      'admin',
    );
  }
  async pushMigration(actor: Actor, raw: unknown): Promise<SchemaMigration> {
    const input = parseInput(
      z
        .object({
          formatVersion: z.union([z.literal(1), z.literal(2)]),
          id: z.uuid(),
          spaceId: z.uuid(),
          version: z.number().int().positive(),
          baseVersion: z.number().int().nonnegative(),
          name: z.string().trim().min(1).max(120),
          definitions: z
            .array(
              z
                .object({
                  id: z.uuid(),
                  parentDefinitionId: z.uuid().nullable().optional(),
                  schema: definitionInputSchema,
                })
                .strict(),
            )
            .max(10000),
          remoteRevision: z.number().int().positive().nullable(),
          sourceHash: z.string().nullable(),
          status: z.literal('active'),
        })
        .strict(),
      raw,
    );
    if (input.spaceId !== actor.spaceId || input.version !== input.baseVersion + 1)
      throw new StorypaneError('invalid', 'Migration space or version does not match its base');
    if (
      new Set(input.definitions.map((d) => d.id)).size !== input.definitions.length ||
      new Set(input.definitions.map((d) => d.schema.name)).size !== input.definitions.length
    )
      throw new StorypaneError('invalid', 'Duplicate block identities or names');
    return this.tx(
      actor,
      async (client) => {
        await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [actor.spaceId]);
        const found = (
          await client.query(
            'SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id WHERE m.id=$1 AND m.space_id=$2',
            [input.id, actor.spaceId],
          )
        ).rows[0];
        const previous = found ? migrationRow(found) : undefined;
        const same =
          previous &&
          digest({
            name: previous.name,
            definitions:
              input.formatVersion === 2
                ? portableDefinitions(previous.definitions)
                : migrationTarget(previous),
          }) ===
            digest({
              name: input.name,
              definitions:
                input.formatVersion === 2
                  ? [...input.definitions].sort((a, b) => a.id.localeCompare(b.id))
                  : input.definitions,
            });
        if (same) return previous!;
        if (previous?.status === 'deployed')
          throw new StorypaneError('stale_revision', 'Deployed migrations are immutable');
        const base = await this.deployedMigration(client, actor.spaceId);
        if (base.version !== input.baseVersion)
          throw new StorypaneError(
            'stale_revision',
            'The deployed migration changed. Pull and reconcile your local migration.',
          );
        const activeRow = (
          await client.query(
            "SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id WHERE m.space_id=$1 AND m.status='active'",
            [actor.spaceId],
          )
        ).rows[0];
        if (activeRow && (activeRow.id !== input.id || activeRow.revision !== input.remoteRevision))
          throw new StorypaneError(
            'stale_revision',
            'The shared active migration changed. Pull a separate copy and reconcile before pushing.',
          );
        if (!activeRow && input.remoteRevision !== null)
          throw new StorypaneError('stale_revision', 'The active migration no longer exists');
        const old = activeRow ? migrationRow(activeRow).definitions : base.definitions;
        if (
          input.formatVersion === 1 &&
          old.some((definition) => !input.definitions.some((item) => item.id === definition.id))
        )
          throw new StorypaneError(
            'invalid',
            'Delete blocks from the CMS schema editor, then pull the updated migration',
          );
        // Create identities first so newly added definitions can reference one another.
        for (const item of input.definitions) {
          const prior = old.find((definition) => definition.id === item.id);
          if (prior && prior.name !== item.schema.name)
            throw new StorypaneError('invalid', 'Definition API names cannot be renamed');
          if (!prior)
            await client.query(
              'INSERT INTO definitions(id,space_id,name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
              [item.id, actor.spaceId, item.schema.name],
            );
        }
        const parents = (
          await client.query('SELECT id,parent_definition_id FROM definitions WHERE space_id=$1', [
            actor.spaceId,
          ])
        ).rows;
        const definitions: BlockDefinition[] = [];
        for (const item of input.definitions) {
          const prior = old.find((definition) => definition.id === item.id);
          const schema = await this.identifyFields(client, item.id, item.schema, prior);
          await this.validateDefinition(client, actor, schema, input.definitions);
          if (prior && canonicalJson(definitionInput(prior)) === canonicalJson(schema)) {
            definitions.push({
              ...prior,
              parentDefinitionId:
                item.parentDefinitionId === undefined
                  ? (parents.find((d) => d.id === item.id)?.parent_definition_id ?? null)
                  : item.parentDefinitionId,
            });
            continue;
          }
          const version = Number(
            (
              await client.query(
                'SELECT coalesce(max(version),0)+1 AS version FROM definition_versions WHERE definition_id=$1',
                [item.id],
              )
            ).rows[0].version,
          );
          const definition = definitionRow(
            (
              await client.query(
                'INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,$2,$3) RETURNING *',
                [item.id, version, JSON.stringify(schema)],
              )
            ).rows[0],
          );
          await client.query('UPDATE definitions SET current_version=$2 WHERE id=$1', [
            item.id,
            version,
          ]);
          definitions.push({
            ...definition,
            parentDefinitionId:
              item.parentDefinitionId === undefined
                ? (parents.find((d) => d.id === item.id)?.parent_definition_id ?? null)
                : item.parentDefinitionId,
          });
        }
        validatePortableDefinitions(portableDefinitions(definitions));
        for (const definition of definitions)
          await client.query(
            'UPDATE definitions SET parent_definition_id=$2 WHERE id=$1 AND space_id=$3',
            [definition.id, definition.parentDefinitionId ?? null, actor.spaceId],
          );
        const row = (
          await client.query(
            "INSERT INTO schema_migrations(id,space_id,version,base_version,name,status,definitions,contributors) VALUES($1,$2,$3,$4,$5,'active',$6,ARRAY[$7]::text[]) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,definitions=EXCLUDED.definitions,revision=schema_migrations.revision+1,contributors=ARRAY(SELECT DISTINCT unnest(schema_migrations.contributors || EXCLUDED.contributors)) RETURNING *",
            [
              input.id,
              actor.spaceId,
              input.version,
              input.baseVersion,
              input.name,
              JSON.stringify(definitions),
              actor.userId,
            ],
          )
        ).rows[0];
        return migrationRow(row);
      },
      'schemas:write',
    );
  }
  private async hydrateHistoricalDefinitions(
    client: PoolClient,
    snapshot: LocaleSnapshot,
  ): Promise<LocaleSnapshot> {
    const versions = (
      await client.query('SELECT * FROM definition_versions WHERE id=ANY($1::uuid[])', [
        snapshot.definitions.map((definition) => definition.versionId),
      ])
    ).rows.map(definitionRow);
    return { ...snapshot, definitions: versions };
  }
  private async migrateContent(
    client: PoolClient,
    actor: Actor,
    source: LocaleSnapshot,
    migration: SchemaMigration,
    destructive = false,
  ) {
    const result = migrateSnapshot(source, migration.definitions, migration.version, destructive);
    if (destructive)
      for (const block of result.snapshot.blocks) {
        const definition = result.snapshot.definitions.find(
          (item) => item.id === block.definitionId,
        )!;
        for (const field of definition.fields) {
          try {
            await this.validateReferences(
              client,
              actor,
              { ...definition, fields: [field] },
              block.fields,
            );
          } catch (error) {
            if (!(error instanceof StorypaneError) || error.code !== 'invalid') throw error;
            delete block.fields[field.name];
            if (field.defaultValue !== undefined)
              block.fields[field.name] = structuredClone(field.defaultValue);
            result.resetValues++;
          }
        }
      }
    return result;
  }
  private async restoreMigrationSnapshot(
    client: PoolClient,
    actor: Actor,
    snapshot: LocaleSnapshot,
  ): Promise<LocaleSnapshot> {
    let current = await this.hydrateHistoricalDefinitions(client, snapshot);
    const migrations = (
      await client.query(
        "SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id WHERE m.space_id=$1 AND m.status='deployed' AND m.version>$2 ORDER BY m.version",
        [actor.spaceId, snapshot.migrationVersion ?? 0],
      )
    ).rows.map(migrationRow);
    for (const migration of migrations)
      current = (
        await this.migrateContent(client, actor, current, migration, migration.destructive)
      ).snapshot;
    return current;
  }
  private async inspectMigration(
    client: PoolClient,
    actor: Actor,
    id: string,
    destructive = false,
  ) {
    const row = (
      await client.query(
        'SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id WHERE m.id=$1 AND m.space_id=$2',
        [id, actor.spaceId],
      )
    ).rows[0];
    if (!row) throw new StorypaneError('not_found', 'Migration not found');
    const migration = migrationRow(row),
      base = await this.deployedMigration(client, actor.spaceId);
    if (migration.status !== 'active' || migration.baseVersion !== base.version)
      throw new StorypaneError('stale_revision', 'This migration is no longer active');
    const blockers: MigrationReview['blockers'] = [],
      impacts: MigrationReview['impacts'] = [],
      changes = migrationChanges(base.definitions, migration.definitions);
    const plans: { draft: LocaleSnapshot; published?: LocaleSnapshot }[] = [],
      heads: unknown[] = [];
    for (const removed of base.definitions.filter(
      (item) => !migration.definitions.some((next) => next.id === item.id),
    )) {
      try {
        await this.assertDefinitionUnused(client, actor, removed.id, migration.definitions);
      } catch (error) {
        if (!(error instanceof StorypaneError)) throw error;
        blockers.push({ path: removed.name, message: error.message });
      }
    }
    for (const definition of migration.definitions) {
      try {
        await this.validateDefinition(client, actor, definition);
      } catch (error) {
        if (!(error instanceof StorypaneError)) throw error;
        blockers.push({ path: definition.name, message: error.message });
      }
      for (const field of definition.fields)
        if (
          field.type === 'blocks' &&
          field.allowedDefinitionIds?.some(
            (id) => !migration.definitions.some((item) => item.id === id),
          )
        )
          blockers.push({
            path: `${definition.name}.${field.name}`,
            message: 'Allowed blocks includes a deleted block. Update this field before deploying.',
          });
    }
    const folders = await this.folders(client, actor.spaceId);
    for (const folder of folders)
      for (const id of [
        ...folder.allowedDefinitionIds,
        ...(folder.defaultDefinitionId ? [folder.defaultDefinitionId] : []),
      ]) {
        if (
          !migration.definitions.some(
            (definition) => definition.id === id && definition.kind !== 'nestable',
          )
        )
          blockers.push({
            path: `folder:${folder.id}`,
            message: 'Folder content types must remain content-type or universal definitions',
          });
      }
    const locales = (
      await client.query(
        'SELECT l.id,l.story_id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 AND s.deleted_at IS NULL ORDER BY l.id',
        [actor.spaceId],
      )
    ).rows;
    for (const locale of locales) {
      const draft = await this.snapshot(client, actor, locale.story_id, locale.id);
      const publication = draft.locale.publishedVersionId
        ? (
            await client.query('SELECT * FROM publications WHERE id=$1', [
              draft.locale.publishedVersionId,
            ])
          ).rows[0]
        : null;
      heads.push([locale.id, draft.revision, draft.checkpointId, draft.locale.publishedVersionId]);
      const plan: { draft: LocaleSnapshot; published?: LocaleSnapshot } = { draft };
      for (const target of ['draft', 'published'] as const) {
        if (target === 'published' && !publication) continue;
        const source = await this.hydrateHistoricalDefinitions(
          client,
          target === 'draft' ? draft : publication.snapshot,
        );
        const missing = source.blocks.find(
          (block) =>
            !migration.definitions.some((definition) => definition.id === block.definitionId),
        );
        if (missing) {
          blockers.push({
            path: `${draft.story.name}/${draft.locale.name}/${target}`,
            message:
              'This story still uses a block marked for deletion. Remove the block before deploying.',
            storyId: draft.story.id,
            storyName: draft.story.name,
            localeSlug: draft.locale.slug,
            localeName: draft.locale.name,
            target,
            blockId: missing.id,
          });
          continue;
        }
        if (base.version === 0)
          for (const change of migrationChanges(
            source.definitions,
            migration.definitions.filter((definition) =>
              source.definitions.some((old) => old.id === definition.id),
            ),
          ))
            if (!changes.some((existing) => digest(existing) === digest(change)))
              changes.push(change);
        const result = await this.migrateContent(client, actor, source, migration, destructive);
        plan[target] = result.snapshot;
        impacts.push({
          storyId: draft.story.id,
          localeId: locale.id,
          name: draft.story.name,
          locale: draft.locale.name,
          localeSlug: draft.locale.slug,
          target,
          deletedValues: result.deletedValues,
          resetValues: result.resetValues,
          deletedBlocks: result.deletedBlocks,
        });
        try {
          await this.validateSnapshot(client, actor, result.snapshot, target === 'published');
        } catch (error) {
          if (!(error instanceof StorypaneError)) throw error;
          for (const issue of error.details ?? [{ path: '', message: error.message }]) {
            const [blockId, field] = issue.path.split('.');
            const block = result.snapshot.blocks.find((item) => item.id === blockId);
            const definition = result.snapshot.definitions.find(
              (item) => item.id === block?.definitionId,
            );
            blockers.push({
              path: `${draft.story.name}/${draft.locale.name}/${target}/${issue.path}`,
              message: issue.message,
              storyId: draft.story.id,
              storyName: draft.story.name,
              localeSlug: draft.locale.slug,
              localeName: draft.locale.name,
              target,
              blockId: block?.id,
              blockName: definition?.displayName,
              field,
            });
          }
        }
      }
      plans.push(plan);
    }
    const confirmation =
      destructive ||
      impacts.some((item) => item.deletedValues + item.resetValues + item.deletedBlocks > 0)
        ? `DEPLOY ${migration.version}`
        : null;
    const review: MigrationReview = {
      migration,
      destructive,
      confirmation,
      changes,
      impacts,
      blockers,
      token: digest({
        id: migration.id,
        revision: migration.revision,
        destructive,
        heads,
        folders,
        blockers,
        plans,
      }),
    };
    return { review, plans };
  }
  async reviewMigration(actor: Actor, id: string, destructive = false): Promise<MigrationReview> {
    parseInput(z.uuid(), id);
    return this.tx(
      actor,
      async (client) => {
        assertUnrestrictedRead(await this.contentAccess(client, actor));
        return (await this.inspectMigration(client, actor, id, destructive)).review;
      },
      undefined,
      true,
    );
  }
  async deployMigration(
    actor: Actor,
    id: string,
    reviewToken: string,
    options: { destructive?: boolean; confirmation?: string } = {},
  ): Promise<SchemaMigration> {
    parseInput(z.uuid(), id);
    parseInput(z.string().regex(/^[a-f0-9]{64}$/), reviewToken);
    const { destructive, confirmation } = parseInput(
      z
        .object({ destructive: z.boolean().default(false), confirmation: z.string().optional() })
        .strict(),
      options,
    );
    const started = Date.now();
    try {
      const result = await this.tx(
        actor,
        async (client) => {
          await this.assertSchemaEditable(client, actor);
          const existing = (
            await client.query(
              'SELECT m.*,s.schema_hierarchy_baseline FROM schema_migrations m JOIN spaces s ON s.id=m.space_id WHERE m.id=$1 AND m.space_id=$2',
              [id, actor.spaceId],
            )
          ).rows[0];
          if (existing?.status === 'deployed') {
            if (existing.review_token !== reviewToken)
              throw new StorypaneError(
                'stale_revision',
                'This migration was deployed from a different review',
              );
            return migrationRow(existing);
          }
          const { review, plans } = await this.inspectMigration(client, actor, id, destructive);
          if (review.token !== reviewToken)
            throw new StorypaneError(
              'stale_revision',
              'The migration or affected content changed. Review it again before deploying.',
            );
          if (review.blockers.length)
            throw new StorypaneError(
              'invalid',
              'Resolve migration validation errors before deploying',
              review.blockers,
            );
          if (review.confirmation && confirmation !== review.confirmation)
            throw new StorypaneError(
              'invalid',
              `Data loss requires explicit confirmation: ${review.confirmation}`,
            );
          await client.query(
            "UPDATE content_releases SET status='held',error='The schema changed. Review and approve every page under the new schema.',revision=revision+1,updated_at=clock_timestamp() WHERE space_id=$1 AND status='scheduled' AND EXISTS(SELECT 1 FROM publication_schedules s WHERE s.release_id=content_releases.id AND s.status='pending')",
            [actor.spaceId],
          );
          await client.query(
            "UPDATE publication_schedules SET error='The schema changed; review and schedule a new checkpoint.',revision=revision+1,updated_at=clock_timestamp() WHERE space_id=$1 AND status='pending'",
            [actor.spaceId],
          );
          await client.query('UPDATE spaces SET schema_version=$2 WHERE id=$1', [
            actor.spaceId,
            review.migration.version,
          ]);
          for (const { draft, published } of plans) {
            const localeId = draft.locale.id;
            if (published) {
              const checkpointId = randomUUID(),
                publicationId = randomUUID();
              const revision = Number(
                (
                  await client.query(
                    'UPDATE story_locales SET revision=revision+1 WHERE id=$1 RETURNING revision',
                    [localeId],
                  )
                ).rows[0].revision,
              );
              published.revision = revision;
              published.locale.revision = revision;
              published.checkpointId = checkpointId;
              published.locale.checkpointId = checkpointId;
              published.leases = [];
              await client.query(
                'INSERT INTO checkpoints(id,locale_id,revision,actor_id,reason,snapshot,content) VALUES($1,$2,$3,$4,$5,$6,$7)',
                [
                  checkpointId,
                  localeId,
                  revision,
                  actor.userId,
                  `Migration ${review.migration.version} (published)`,
                  JSON.stringify(published),
                  JSON.stringify(assembleContent(published)),
                ],
              );
              await client.query(
                'INSERT INTO publications(id,locale_id,checkpoint_id,revision,actor_id,content,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
                [
                  publicationId,
                  localeId,
                  checkpointId,
                  revision,
                  actor.userId,
                  JSON.stringify(assembleContent(published)),
                  JSON.stringify(published),
                ],
              );
              await client.query('UPDATE story_locales SET published_version_id=$2 WHERE id=$1', [
                localeId,
                publicationId,
              ]);
            }
            await client.query('DELETE FROM edit_leases WHERE locale_id=$1', [localeId]);
            await client.query(
              'DELETE FROM block_drafts WHERE locale_id=$1 AND id<>ALL($2::uuid[])',
              [localeId, draft.blocks.map((block) => block.id)],
            );
            for (const block of draft.blocks)
              await client.query(
                'UPDATE block_drafts SET schema_version_id=$3,parent_field=$4,fields=$5,revision=$6 WHERE locale_id=$1 AND id=$2',
                [
                  localeId,
                  block.id,
                  block.schemaVersionId,
                  block.parentField,
                  JSON.stringify(block.fields),
                  block.revision,
                ],
              );
            await this.checkpoint(
              client,
              actor,
              draft.story.id,
              localeId,
              `Migration ${review.migration.version}`,
            );
          }
          await webhooks.recordWebhookEvent(client, {
            spaceId: actor.spaceId,
            actorId: actor.userId,
            type: 'schema.deployed',
            key: 'schema.deployed:' + id,
            data: { migrationVersion: review.migration.version },
          });
          return migrationRow(
            (
              await client.query(
                "UPDATE schema_migrations SET status='deployed',deployed_at=clock_timestamp(),deployed_by=$2,review_token=$3,destructive=$4 WHERE id=$1 RETURNING *,(SELECT schema_hierarchy_baseline FROM spaces WHERE spaces.id=schema_migrations.space_id) AS schema_hierarchy_baseline",
                [id, actor.userId, reviewToken, destructive],
              )
            ).rows[0],
          );
        },
        'admin',
        true,
      );
      if (!this.transactionClient)
        console.info('Schema migration deployed', {
          spaceId: actor.spaceId,
          version: result.version,
          actor: actor.userId,
          managementTokenId: actor.managementTokenId,
          durationMs: Date.now() - started,
        });
      return result;
    } catch (error) {
      if (!this.transactionClient)
        console.warn('Schema migration failed', {
          spaceId: actor.spaceId,
          migrationId: id,
          actor: actor.userId,
          code: error instanceof StorypaneError ? error.code : 'unavailable',
          durationMs: Date.now() - started,
        });
      throw error;
    }
  }

  async listPageEditors(actor: Actor): Promise<PageEditors> {
    return this.tx(actor, async (client) => {
      const access = await this.contentAccess(client, actor);
      const { rows } = await client.query<PageEditor & { storyId: string; sessionIds: string[] }>(
        `SELECT s.id AS "storyId",u.id AS "userId",u.name,u.avatar_url AS "avatarUrl",
        array_agg(DISTINCT l.name ORDER BY l.name) AS locales, array_agg(DISTINCT e.session_id) AS "sessionIds"
        FROM edit_leases e JOIN story_locales l ON l.id=e.locale_id JOIN stories s ON s.id=l.story_id
        JOIN "user" u ON u.id=e.user_id ${this.options.authorizeSession ? '' : 'JOIN cms_sessions se ON se.id=e.session_id AND se.user_id=e.user_id'}
        JOIN memberships m ON m.space_id=s.space_id AND m.user_id=e.user_id
        JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role
        WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.id=ANY($2::uuid[]) AND e.expires_at>clock_timestamp() ${this.options.authorizeSession ? '' : 'AND se.expires_at>clock_timestamp()'}
          AND 'content:edit'=ANY(r.permissions) AND ($5 OR EXISTS(SELECT 1 FROM block_drafts b JOIN definition_versions v ON v.id=b.schema_version_id WHERE b.id=e.block_id AND ($3::uuid[] IS NULL OR v.definition_id=ANY($3)) AND ($4::text[] IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.schema->'fields') f WHERE f->>'id'=ANY($4)))))
        GROUP BY s.id,u.id,u.name,u.avatar_url ORDER BY u.name,u.id`,
        [
          actor.spaceId,
          access.locales.map((locale) => locale.id),
          access.scopes.read.definitionIds,
          access.scopes.read.fieldIds,
          access.admin,
        ],
      );
      const editors: PageEditors = {};
      for (const { storyId, sessionIds, ...editor } of rows) {
        if (this.options.authorizeSession) {
          let active = false;
          for (const sessionId of sessionIds) {
            try {
              await this.options.authorizeSession({ userId: editor.userId, sessionId });
              active = true;
              break;
            } catch (error) {
              if (!(error instanceof StorypaneError) || error.code !== 'unauthenticated')
                throw error;
            }
          }
          if (!active) continue;
        }
        (editors[storyId] ??= []).push(editor);
      }
      return editors;
    });
  }
  private async lockPaths(client: PoolClient, spaceId: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,17))', [spaceId]);
  }
  private async folders(client: PoolClient, spaceId: string): Promise<ContentFolder[]> {
    return (
      await client.query('SELECT * FROM content_folders WHERE space_id=$1 ORDER BY name,id', [
        spaceId,
      ])
    ).rows.map(folderRow);
  }
  async listFolders(actor: Actor): Promise<ContentFolder[]> {
    return this.tx(actor, async (client) => {
      const access = await this.contentAccess(client, actor);
      const folders = await this.folders(client, actor.spaceId);
      if (unrestrictedRead(access)) return folders;
      const visible = new Set<string>();
      const locales = (
        await client.query('SELECT id FROM space_locales WHERE space_id=$1', [actor.spaceId])
      ).rows;
      for (const folder of folders)
        if (
          locales.some((locale) =>
            locationAllowed(
              access,
              { storyId: '', folderId: folder.id, spaceLocaleId: locale.id },
              'content:read',
            ),
          )
        )
          visible.add(folder.id);
      for (const locale of access.locales) if (locale.folderId) visible.add(locale.folderId);
      for (const id of [...visible]) {
        let parent = folders.find((folder) => folder.id === id)?.parentId;
        while (parent) {
          visible.add(parent);
          parent = folders.find((folder) => folder.id === parent)?.parentId;
        }
      }
      return folders.filter((folder) => visible.has(folder.id));
    });
  }
  private checkFolderType(folders: ContentFolder[], folderId: string | null, definitionId: string) {
    const folder = folders.find((item) => item.id === folderId);
    if (folderId && !folder)
      throw new StorypaneError('not_found', 'Folder not found in this space');
    if (folder?.allowedDefinitionIds.length && !folder.allowedDefinitionIds.includes(definitionId))
      throw new StorypaneError('invalid', `${folder.name} does not allow this content type`);
  }
  private async validateFolderTree(client: PoolClient, actor: Actor, folders: ContentFolder[]) {
    const locales = (
      await client.query('SELECT id,slug FROM space_locales WHERE space_id=$1', [actor.spaceId])
    ).rows;
    const definitions = (await this.deployedMigration(client, actor.spaceId)).definitions;
    for (const folder of folders) {
      if (
        Object.keys(folder.localeSlugs).some(
          (id) => !locales.some((locale) => locale.id === id && locale.slug !== ''),
        )
      )
        throw new StorypaneError(
          'invalid',
          'Folder translations must use configured locales with a URL prefix from this space',
        );
      for (const id of [
        ...folder.allowedDefinitionIds,
        ...(folder.defaultDefinitionId ? [folder.defaultDefinitionId] : []),
      ]) {
        if (
          !definitions.some((definition) => definition.id === id && definition.kind !== 'nestable')
        )
          throw new StorypaneError('invalid', 'Choose content types from this space');
      }
      if (folder.defaultDefinitionId)
        this.checkFolderType(folders, folder.id, folder.defaultDefinitionId);
    }
    for (const locale of locales) {
      const paths = new Set<string>();
      for (const folder of folders) {
        const path = folderPath(folders, folder.id, locale.id);
        if (path.length > 1800 || paths.has(path))
          throw new StorypaneError(
            'invalid',
            'Folder paths must be unique in each locale and shorter than 1,800 characters',
          );
        paths.add(path);
      }
    }
  }
  private async refreshPaths(
    client: PoolClient,
    actor: Actor,
    folders: ContentFolder[],
    forceStoryId?: string,
  ) {
    const locales = (
      await client.query(
        'SELECT l.* FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 ORDER BY l.id FOR UPDATE OF l',
        [actor.spaceId],
      )
    ).rows;
    const stories = (
      await client.query(
        'SELECT s.*,v.definition_id FROM stories s LEFT JOIN LATERAL (SELECT l.* FROM story_locales l JOIN space_locales c ON c.id=l.space_locale_id WHERE l.story_id=s.id ORDER BY c.is_default DESC,l.id LIMIT 1) l ON true LEFT JOIN block_drafts b ON b.id=l.root_block_id AND b.locale_id=l.id LEFT JOIN definition_versions v ON v.id=b.schema_version_id WHERE s.space_id=$1',
        [actor.spaceId],
      )
    ).rows;
    const paths = new Set<string>(
      locales
        .filter((locale) => stories.find((story) => story.id === locale.story_id)?.deleted_at)
        .map((locale) => `${locale.space_locale_id}:${locale.url_slug}`),
    );
    for (const story of stories) {
      if (story.deleted_at) continue;
      this.checkFolderType(folders, story.folder_id, story.definition_id);
      const path = joinPath(folderPath(folders, story.folder_id), story.slug_segment ?? story.slug);
      if (path.length > 2048)
        throw new StorypaneError('invalid', 'Page paths cannot exceed 2,048 characters');
      if (path !== story.slug)
        await client.query('UPDATE stories SET slug=$2 WHERE id=$1', [story.id, path]);
    }
    for (const locale of locales) {
      const story = stories.find((item) => item.id === locale.story_id)!;
      if (story.deleted_at) continue;
      const path = joinPath(
        folderPath(folders, story.folder_id, locale.space_locale_id),
        locale.slug_segment ?? locale.url_slug,
      );
      const key = `${locale.space_locale_id}:${path}`;
      if (path.length > 2048 || paths.has(key))
        throw new StorypaneError(
          'invalid',
          'Each page needs a unique path in its locale, up to 2,048 characters; deleted stories keep their paths reserved',
        );
      paths.add(key);
      if (path !== locale.url_slug || story.id === forceStoryId) {
        await client.query('UPDATE story_locales SET url_slug=$2 WHERE id=$1', [locale.id, path]);
        await this.checkpoint(client, actor, story.id, locale.id, 'Update page path');
      }
    }
  }
  private async requireFolderEdit(
    client: PoolClient,
    actor: Actor,
    folderId: string | null,
    folders: ContentFolder[],
  ) {
    const access = await this.contentAccess(client, actor);
    const configured = (
      await client.query('SELECT id FROM space_locales WHERE space_id=$1', [actor.spaceId])
    ).rows;
    const targetAccess = { ...access, folders };
    for (const locale of configured)
      assertLocationAccess(
        targetAccess,
        { storyId: '', folderId, spaceLocaleId: locale.id },
        'content:edit',
      );
    const scope = access.scopes.edit;
    if (
      !access.admin &&
      (scope.definitionIds !== null ||
        scope.fieldIds !== null ||
        access.scopes.read.definitionIds !== null ||
        access.scopes.read.fieldIds !== null)
    )
      throw new StorypaneError(
        'forbidden',
        'Changing folders requires access to all content in the folder',
      );
  }
  async saveFolder(actor: Actor, raw: unknown, folderId?: string): Promise<ContentFolder> {
    const input = parseInput(folderInputSchema, raw);
    if (folderId) parseInput(z.uuid(), folderId);
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        const folders = await this.folders(client, actor.spaceId);
        if (folderId && !folders.some((folder) => folder.id === folderId))
          throw new StorypaneError('not_found', 'Folder not found');
        const folder: ContentFolder = { ...input, id: folderId ?? randomUUID() };
        const next = [...folders.filter((item) => item.id !== folder.id), folder];
        if (folderId) await this.requireFolderEdit(client, actor, folderId, folders);
        if (!folderId || folders.find((item) => item.id === folderId)?.parentId !== folder.parentId)
          await this.requireFolderEdit(client, actor, folder.parentId, next);
        await this.validateFolderTree(client, actor, next);
        await client.query(
          `INSERT INTO content_folders(id,space_id,name,slug,parent_id,locale_slugs,allowed_definition_ids,default_definition_id,form_only) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET name=$3,slug=$4,parent_id=$5,locale_slugs=$6,allowed_definition_ids=$7,default_definition_id=$8,form_only=$9`,
          [
            folder.id,
            actor.spaceId,
            input.name,
            input.slug,
            input.parentId,
            JSON.stringify(input.localeSlugs),
            input.allowedDefinitionIds,
            input.defaultDefinitionId,
            input.formOnly,
          ],
        );
        if (folderId) await this.refreshPaths(client, actor, next);
        return folder;
      },
      'content:edit',
    );
  }
  async deleteFolder(actor: Actor, folderId: string): Promise<void> {
    parseInput(z.uuid(), folderId);
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        await this.requireFolderEdit(
          client,
          actor,
          folderId,
          await this.folders(client, actor.spaceId),
        );
        if (
          !(
            await client.query('SELECT id FROM content_folders WHERE id=$1 AND space_id=$2', [
              folderId,
              actor.spaceId,
            ])
          ).rowCount
        )
          throw new StorypaneError('not_found', 'Folder not found');
        if (
          (
            await client.query(
              'SELECT id FROM content_folders WHERE parent_id=$1 UNION ALL SELECT id FROM stories WHERE folder_id=$1',
              [folderId],
            )
          ).rowCount
        )
          throw new StorypaneError(
            'invalid',
            'Move the pages and subfolders out before deleting this folder',
          );
        await client.query('DELETE FROM content_folders WHERE id=$1', [folderId]);
      },
      'content:edit',
    );
  }
  async updateStoryLocation(actor: Actor, storyId: string, raw: unknown): Promise<Story> {
    parseInput(z.uuid(), storyId);
    const input = parseInput(storyLocationSchema, raw);
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        const access = await this.requireAllStoryAccess(client, actor, storyId, 'content:edit');
        if (
          !(
            await client.query(
              'SELECT id FROM stories WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL',
              [storyId, actor.spaceId],
            )
          ).rowCount
        )
          throw new StorypaneError('not_found', 'Story not found');
        const locales = (
          await client.query(
            'SELECT l.* FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 ORDER BY l.id FOR UPDATE OF l',
            [actor.spaceId],
          )
        ).rows.filter((locale) => locale.story_id === storyId);
        if (
          Object.keys(input.localeSlugs).some(
            (id) => !locales.some((locale) => locale.space_locale_id === id && locale.slug !== ''),
          )
        )
          throw new StorypaneError(
            'invalid',
            'Only existing page locales can have translated page slugs',
          );
        const folders = await this.folders(client, actor.spaceId);
        folderPath(folders, input.folderId);
        for (const locale of locales) {
          const snapshot = await this.snapshot(client, actor, storyId, locale.id);
          snapshot.story.folderId = input.folderId;
          assertSnapshotAccess(access, snapshot, 'content:edit');
        }
        await client.query('UPDATE stories SET folder_id=$2,slug_segment=$3 WHERE id=$1', [
          storyId,
          input.folderId,
          input.slug,
        ]);
        for (const locale of locales)
          await client.query('UPDATE story_locales SET slug_segment=$2 WHERE id=$1', [
            locale.id,
            locale.slug === ''
              ? input.slug
              : (input.localeSlugs[locale.space_locale_id] ??
                locale.slug_segment ??
                locale.url_slug),
          ]);
        await this.refreshPaths(client, actor, folders, storyId);
        return storyRow(
          (
            await client.query(
              'SELECT s.*,f.form_only FROM stories s LEFT JOIN content_folders f ON f.id=s.folder_id WHERE s.id=$1',
              [storyId],
            )
          ).rows[0],
        );
      },
      'content:edit',
    );
  }
  async listStories(actor: Actor, deleted = false): Promise<StorySummary[]> {
    return this.tx(actor, async (client) => {
      const access = await loadContentAccess(client, actor, deleted);
      return (
        await client.query(
          `SELECT s.*,f.form_only,u.name AS editor_name,v.definition_id AS content_type_id,v.schema->>'displayName' AS content_type_name,
      '/' || concat_ws('/',nullif(base.slug,''),base.url_slug) AS path,
      EXISTS(SELECT 1 FROM story_pins pin WHERE pin.story_id=s.id AND pin.user_id=$2) AS pinned,
      coalesce((SELECT jsonb_agg(to_jsonb(job)) FROM (SELECT sch.*,cp.revision AS checkpoint_revision,r.name AS release_name,r.revision AS release_revision,r.status AS release_status FROM publication_schedules sch JOIN checkpoints cp ON cp.id=sch.checkpoint_id JOIN content_releases r ON r.id=sch.release_id WHERE sch.story_id=s.id AND sch.locale_id=ANY($3::uuid[]) AND sch.status IN ('pending','failed') ORDER BY sch.created_at DESC) job),'[]') AS schedules,
      count(l.id)::integer AS locale_count,count(p.id)::integer AS published_count,
      (count(l.id) FILTER (WHERE ${pendingLocaleSql}))::integer AS pending_count,
      coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'slug',l.slug) ORDER BY (l.slug='') DESC,l.name) FILTER (WHERE l.id IS NOT NULL AND (${pendingLocaleSql})),'[]'::jsonb) AS pending_locales
      FROM stories s LEFT JOIN story_locales l ON l.story_id=s.id LEFT JOIN checkpoints c ON c.id=l.checkpoint_id
      LEFT JOIN publications p ON p.id=l.published_version_id LEFT JOIN "user" u ON u.id=s.updated_by
      LEFT JOIN LATERAL (SELECT l.* FROM story_locales l JOIN space_locales c ON c.id=l.space_locale_id WHERE l.story_id=s.id AND l.id=ANY($3::uuid[]) ORDER BY c.is_default DESC,(l.slug='') DESC,l.id LIMIT 1) base ON true
      LEFT JOIN block_drafts root ON root.id=base.root_block_id AND root.locale_id=base.id
      LEFT JOIN definition_versions v ON v.id=root.schema_version_id
      LEFT JOIN content_folders f ON f.id=s.folder_id
      WHERE s.space_id=$1 AND (s.deleted_at IS NOT NULL)=$4 AND l.id=ANY($3::uuid[]) GROUP BY s.id,u.id,v.id,f.id,base.slug,base.url_slug ORDER BY pinned DESC,s.updated_at DESC,s.id`,
          [actor.spaceId, actor.userId, access.locales.map((locale) => locale.id), deleted],
        )
      ).rows.map((row) => ({
        ...storyRow(row),
        path: row.path,
        pinned: row.pinned,
        schedules: row.schedules.map(scheduleRow),
        localeCount: row.locale_count,
        pendingLocaleCount: row.pending_count,
        pendingLocales: row.pending_locales,
        publicationStatus: !row.published_count
          ? 'draft'
          : row.pending_count
            ? 'changed'
            : 'published',
        modifiedBy:
          unrestrictedRead(access) && row.updated_by
            ? { id: row.updated_by, name: row.editor_name ?? 'Unknown editor' }
            : null,
        contentType: row.content_type_id
          ? { id: row.content_type_id, name: row.content_type_name }
          : null,
      }));
    });
  }
  async setStoryPinned(actor: Actor, storyId: string, pinned: boolean): Promise<void> {
    const id = parseInput(z.uuid(), storyId);
    return this.tx(actor, async (client) => {
      await this.requireStoryAccess(client, actor, id);
      const story = await client.query(
        'SELECT id FROM stories WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR KEY SHARE',
        [id, actor.spaceId],
      );
      if (!story.rowCount) throw new StorypaneError('not_found', 'Story not found in this space');
      if (pinned)
        await client.query(
          'INSERT INTO story_pins(user_id,story_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [actor.userId, id],
        );
      else
        await client.query('DELETE FROM story_pins WHERE user_id=$1 AND story_id=$2', [
          actor.userId,
          id,
        ]);
    });
  }
  async getStory(actor: Actor, storyId: string): Promise<Story> {
    const id = parseInput(z.uuid(), storyId);
    return this.tx(actor, async (client) => {
      await this.requireStoryAccess(client, actor, id);
      const result = await client.query(
        'SELECT s.*,f.form_only FROM stories s LEFT JOIN content_folders f ON f.id=s.folder_id WHERE s.id=$1 AND s.space_id=$2 AND s.deleted_at IS NULL',
        [id, actor.spaceId],
      );
      if (!result.rowCount) throw new StorypaneError('not_found', 'Story not found in this space');
      return storyRow(result.rows[0]);
    });
  }
  async createStory(actor: Actor, value: unknown): Promise<LocaleSnapshot> {
    const input = parseInput(storyInputSchema, value);
    return this.tx(actor, async (client) => {
      await this.authorize(client, actor, 'content:edit');
      const definition = await this.currentDefinition(client, actor, input.definitionId);
      if (definition.kind === 'nestable')
        throw new StorypaneError('invalid', 'A story requires a content-type or universal block');
      await this.lockPaths(client, actor.spaceId);
      const folders = await this.folders(client, actor.spaceId);
      this.checkFolderType(folders, input.folderId, input.definitionId);
      const path = joinPath(folderPath(folders, input.folderId), input.slug);
      if (path.length > 2048)
        throw new StorypaneError('invalid', 'Page paths cannot exceed 2,048 characters');
      if (
        (
          await client.query(
            'SELECT 1 FROM stories WHERE space_id=$1 AND slug=$2 AND deleted_at IS NOT NULL',
            [actor.spaceId, path],
          )
        ).rowCount
      )
        throw new StorypaneError(
          'invalid',
          'This path is reserved by a deleted story. Restore it or choose another path.',
        );
      const story = await client.query(
        'INSERT INTO stories(space_id,name,slug,slug_segment,folder_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [actor.spaceId, input.name, path, input.slug, input.folderId],
      );
      const rootId = randomUUID();
      const configured = (
        await client.query('SELECT id FROM space_locales WHERE space_id=$1 AND is_default', [
          actor.spaceId,
        ])
      ).rows[0];
      const localePath = joinPath(folderPath(folders, input.folderId, configured.id), input.slug);
      if (localePath.length > 2048)
        throw new StorypaneError('invalid', 'Page paths cannot exceed 2,048 characters');
      const locale = await client.query(
        'INSERT INTO story_locales(story_id,slug,name,url_slug,slug_segment,root_block_id,space_locale_id) SELECT $1,c.slug,c.name,$2,$5,$3,c.id FROM space_locales c WHERE c.space_id=$4 AND c.is_default RETURNING id',
        [story.rows[0].id, localePath, rootId, actor.spaceId, input.slug],
      );
      await client.query(
        'INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)',
        [
          rootId,
          locale.rows[0].id,
          definition.versionId,
          JSON.stringify(defaultFields(definition)),
        ],
      );
      const created = await this.checkpoint(
        client,
        actor,
        story.rows[0].id,
        locale.rows[0].id,
        'Create story',
      );
      assertSnapshotAccess(await this.contentAccess(client, actor), created, 'content:edit');
      return created;
    });
  }
  async listLocales(actor: Actor, storyId: string): Promise<StoryLocale[]> {
    return this.tx(actor, async (client) => {
      const access = await this.requireStoryAccess(client, actor, storyId);
      const story = await client.query(
        'SELECT id FROM stories WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL',
        [storyId, actor.spaceId],
      );
      if (!story.rowCount) throw new StorypaneError('not_found', 'Story not found');
      return (
        await client.query(
          'SELECT l.* FROM story_locales l JOIN space_locales c ON c.id=l.space_locale_id WHERE l.story_id=$1 AND l.id=ANY($2::uuid[]) ORDER BY c.is_default DESC,l.name',
          [storyId, access.locales.map((locale) => locale.id)],
        )
      ).rows.map(localeRow);
    });
  }
  async createLocale(actor: Actor, storyId: string, value: unknown): Promise<LocaleSnapshot> {
    const input = parseInput(localeInputSchema, value);
    return this.tx(actor, async (client) => {
      await this.authorize(client, actor, 'content:edit');
      await this.lockPaths(client, actor.spaceId);
      const configured = await client.query(
        'SELECT * FROM space_locales WHERE id=$1 AND space_id=$2 FOR UPDATE',
        [input.spaceLocaleId, actor.spaceId],
      );
      if (!configured.rows[0])
        throw new StorypaneError('not_found', 'Configure this locale in Space settings first');
      if (
        !(
          await client.query(
            'SELECT id FROM stories WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL',
            [storyId, actor.spaceId],
          )
        ).rowCount
      )
        throw new StorypaneError('not_found', 'Story not found');
      const existing = await client.query(
        'SELECT id FROM story_locales WHERE story_id=$1 AND space_locale_id=$2',
        [storyId, input.spaceLocaleId],
      );
      if (existing.rows[0]) {
        await this.lockLocale(client, actor, storyId, existing.rows[0].id);
        return this.snapshot(client, actor, storyId, existing.rows[0].id);
      }
      const original = await client.query(
        'SELECT l.*,s.folder_id,b.schema_version_id FROM story_locales l JOIN space_locales c ON c.id=l.space_locale_id JOIN stories s ON s.id=l.story_id JOIN block_drafts b ON b.id=l.root_block_id AND b.locale_id=l.id WHERE s.id=$1 AND s.space_id=$2 AND s.deleted_at IS NULL ORDER BY c.is_default DESC,l.id LIMIT 1',
        [storyId, actor.spaceId],
      );
      if (!original.rowCount) throw new StorypaneError('not_found', 'Story not found');
      const rootId = randomUUID();
      const segment = input.urlSlug ?? original.rows[0].slug_segment ?? original.rows[0].url_slug;
      const path = joinPath(
        folderPath(
          await this.folders(client, actor.spaceId),
          original.rows[0].folder_id,
          input.spaceLocaleId,
        ),
        segment,
      );
      if (
        path.length > 2048 ||
        (
          await client.query(
            'SELECT id FROM story_locales WHERE space_locale_id=$1 AND url_slug=$2',
            [input.spaceLocaleId, path],
          )
        ).rowCount
      )
        throw new StorypaneError(
          'invalid',
          'This locale already has that page path, or the path exceeds 2,048 characters',
        );
      const locale = await client.query(
        'INSERT INTO story_locales(story_id,slug,name,url_slug,root_block_id,space_locale_id,slug_segment) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [
          storyId,
          configured.rows[0].slug,
          configured.rows[0].name,
          path,
          rootId,
          input.spaceLocaleId,
          segment,
        ],
      );
      const version = await client.query('SELECT schema FROM definition_versions WHERE id=$1', [
        original.rows[0].schema_version_id,
      ]);
      await client.query(
        'INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)',
        [
          rootId,
          locale.rows[0].id,
          original.rows[0].schema_version_id,
          JSON.stringify(defaultFields(version.rows[0].schema)),
        ],
      );
      const created = await this.checkpoint(
        client,
        actor,
        storyId,
        locale.rows[0].id,
        'Create locale',
      );
      assertSnapshotAccess(await this.contentAccess(client, actor), created, 'content:edit');
      return created;
    });
  }
  async getSnapshot(actor: Actor, storyId: string, localeId: string): Promise<LocaleSnapshot> {
    return this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      return this.snapshot(client, actor, storyId, localeId);
    });
  }
  async listCheckpoints(actor: Actor, storyId: string, localeId: string): Promise<Checkpoint[]> {
    return this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      const showActors = unrestrictedRead(await this.contentAccess(client, actor));
      return (
        await client.query(
          'SELECT id,revision,reason,actor_id,created_at FROM checkpoints WHERE locale_id=$1 ORDER BY revision DESC LIMIT 100',
          [localeId],
        )
      ).rows.map((row) => ({ ...checkpointRow(row), actorId: showActors ? row.actor_id : '' }));
    });
  }
  async getCheckpoint(
    actor: Actor,
    storyId: string,
    localeId: string,
    checkpointId: string,
  ): Promise<CheckpointDetail> {
    return this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      const checkpoint = await this.readCheckpoint(client, localeId, checkpointId);
      const current = await this.snapshot(client, actor, storyId, localeId);
      checkpoint.snapshot.story.folderId = current.story.folderId;
      return checkpoint;
    });
  }
  private async readCheckpoint(
    client: PoolClient,
    localeId: string,
    checkpointId: string,
  ): Promise<CheckpointDetail> {
    const result = await client.query('SELECT * FROM checkpoints WHERE id=$1 AND locale_id=$2', [
      checkpointId,
      localeId,
    ]);
    if (!result.rowCount) throw new StorypaneError('not_found', 'Checkpoint not found');
    return {
      ...checkpointRow(result.rows[0]),
      snapshot: result.rows[0].snapshot,
      content: result.rows[0].content,
    };
  }
  async acquireLease(
    actor: Actor,
    storyId: string,
    localeId: string,
    blockId: string,
  ): Promise<Lease> {
    return this.tx(actor, async (client) => {
      await this.authorize(client, actor, 'content:edit');
      await this.lockLocale(client, actor, storyId, localeId);
      const snapshot = await this.snapshot(client, actor, storyId, localeId);
      requireBlock(snapshot, blockId);
      if (
        !projectSnapshot(await this.contentAccess(client, actor), snapshot).access.blocks[blockId]
          .edit
      )
        throw new StorypaneError('forbidden', 'Your role cannot edit this block');
      if (
        !(
          await client.query('SELECT id FROM block_drafts WHERE id=$1 AND locale_id=$2', [
            blockId,
            localeId,
          ])
        ).rowCount
      )
        throw new StorypaneError('not_found', 'Block not found');
      const lease = await client.query(
        'SELECT *,expires_at>clock_timestamp() AS active FROM edit_leases WHERE locale_id=$1 AND block_id=$2 FOR UPDATE',
        [localeId, blockId],
      );
      const old = lease.rows[0];
      if (old?.active && (old.user_id !== actor.userId || old.session_id !== actor.sessionId))
        throw new StorypaneError('locked', 'This block is being edited by someone else');
      const token = old?.active ? old.token : randomUUID();
      const updated = await client.query(
        `INSERT INTO edit_leases(locale_id,block_id,user_id,session_id,token,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '${LEASE_SECONDS} seconds') ON CONFLICT(locale_id,block_id) DO UPDATE SET user_id=EXCLUDED.user_id,session_id=EXCLUDED.session_id,token=EXCLUDED.token,expires_at=EXCLUDED.expires_at RETURNING *`,
        [localeId, blockId, actor.userId, actor.sessionId, token],
      );
      return {
        blockId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        token,
        expiresAt: iso(updated.rows[0].expires_at),
      };
    });
  }
  async renewLease(
    actor: Actor,
    storyId: string,
    localeId: string,
    blockId: string,
    token: string,
  ): Promise<Lease> {
    return this.tx(actor, async (client) => {
      await this.authorize(client, actor, 'content:edit');
      await this.lockLocale(client, actor, storyId, localeId);
      const snapshot = await this.snapshot(client, actor, storyId, localeId);
      requireBlock(snapshot, blockId);
      if (
        !projectSnapshot(await this.contentAccess(client, actor), snapshot).access.blocks[blockId]
          .edit
      )
        throw new StorypaneError('forbidden', 'Your role cannot edit this block');
      const result = await client.query(
        `UPDATE edit_leases SET expires_at=clock_timestamp()+interval '${LEASE_SECONDS} seconds' WHERE locale_id=$1 AND block_id=$2 AND user_id=$3 AND session_id=$4 AND token=$5 AND expires_at>clock_timestamp() RETURNING *`,
        [localeId, blockId, actor.userId, actor.sessionId, token],
      );
      if (!result.rowCount)
        throw new StorypaneError('locked', 'Your editing lease expired; reconnect before editing');
      return {
        blockId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        token,
        expiresAt: iso(result.rows[0].expires_at),
      };
    });
  }
  async releaseLease(
    actor: Actor,
    storyId: string,
    localeId: string,
    blockId: string,
    token: string,
  ): Promise<void> {
    await this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      await client.query(
        'DELETE FROM edit_leases WHERE locale_id=$1 AND block_id=$2 AND user_id=$3 AND session_id=$4 AND token=$5',
        [localeId, blockId, actor.userId, actor.sessionId, token],
      );
    });
  }

  private async requireLease(
    client: PoolClient,
    actor: Actor,
    localeId: string,
    block: BlockDraft,
    command: Command,
  ): Promise<void> {
    if (command.expectedRevisions[block.id] !== block.revision)
      throw new StorypaneError(
        'stale_revision',
        'This block changed; review the latest version before retrying',
      );
    if (actor.managementTokenId) {
      // Automation holds the locale transaction lock instead of a browser lease.
      await this.noCompetingLeases(client, actor, localeId, [block.id]);
      return;
    }
    const token = command.leaseTokens[block.id];
    if (!token || !z.uuid().safeParse(token).success)
      throw new StorypaneError('locked', 'Acquire this block before editing');
    const lease = await client.query(
      'SELECT block_id FROM edit_leases WHERE locale_id=$1 AND block_id=$2 AND user_id=$3 AND session_id=$4 AND token=$5 AND expires_at>clock_timestamp()',
      [localeId, block.id, actor.userId, actor.sessionId, token],
    );
    if (!lease.rowCount)
      throw new StorypaneError('locked', 'Your editing lease expired; reconnect before editing');
  }
  private async noCompetingLeases(
    client: PoolClient,
    actor: Actor,
    localeId: string,
    blockIds: string[],
  ): Promise<void> {
    const result = await client.query(
      'SELECT block_id FROM edit_leases WHERE locale_id=$1 AND block_id=ANY($2::uuid[]) AND expires_at>clock_timestamp() AND (user_id<>$3 OR session_id<>$4)',
      [localeId, blockIds, actor.userId, actor.sessionId],
    );
    if (result.rowCount)
      throw new StorypaneError('locked', 'Another editor is working in the affected subtree');
  }
  private nestingField(
    snapshot: LocaleSnapshot,
    parent: BlockDraft,
    fieldName: string,
    definition: BlockDefinition,
  ): Extract<FieldDefinition, { type: 'blocks' }> {
    const parentDefinition = snapshot.definitions.find(
      (d) => d.versionId === parent.schemaVersionId,
    )!;
    const field = parentDefinition.fields.find((f) => f.name === fieldName);
    if (!field || field.type !== 'blocks')
      throw new StorypaneError('invalid', 'Select a Blocks field');
    if (!isBlockAllowed(field, definition))
      throw new StorypaneError('invalid', 'This block type is not allowed here');
    return field;
  }
  private async validateReferences(
    client: PoolClient,
    actor: Actor,
    schema: DefinitionInput,
    fields: Record<string, Json>,
  ): Promise<void> {
    for (const field of schema.fields) {
      const value = fields[field.name];
      if (value === null || value === undefined || value === '') continue;
      const assetId =
        field.type === 'asset'
          ? (value as { assetId: string }).assetId
          : field.type === 'link' && (value as { type: string }).type === 'asset'
            ? (value as { assetId: string }).assetId
            : undefined;
      const assetIds =
        field.type === 'text' && field.format === 'richtext'
          ? richTextAssetIds(value)
          : assetId
            ? [assetId]
            : [];
      for (const assetId of new Set(assetIds)) {
        const asset = (
          await client.query('SELECT mime_type FROM assets WHERE id=$1 AND space_id=$2', [
            assetId,
            actor.spaceId,
          ])
        ).rows[0];
        if (!asset) throw new StorypaneError('invalid', 'Asset must belong to this space');
        if (field.type === 'text' && !String(asset.mime_type).startsWith('image/'))
          throw new StorypaneError('invalid', 'Rich text images must use image assets');
        if (
          field.type === 'asset' &&
          field.mimeTypes?.length &&
          !field.mimeTypes.some((allowed) => {
            const mime = String(asset.mime_type).toLowerCase();
            const restriction = allowed.toLowerCase();
            return restriction.endsWith('/*')
              ? mime.startsWith(restriction.slice(0, -1))
              : mime === restriction;
          })
        )
          throw new StorypaneError('invalid', `${field.label} does not allow this asset type`);
      }
      const storyIds =
        field.type === 'link' && (value as { type: string }).type === 'story'
          ? [(value as { storyId: string }).storyId]
          : (field.type === 'option' || field.type === 'options') && field.source.type === 'stories'
            ? Array.isArray(value)
              ? value
              : [value]
            : [];
      if (storyIds.length) {
        if (!storyIds.every((v) => typeof v === 'string' && z.uuid().safeParse(v).success))
          throw new StorypaneError('invalid', 'Expected story IDs');
        const stories = await client.query(
          'SELECT id FROM stories WHERE space_id=$1 AND deleted_at IS NULL AND id=ANY($2::uuid[])',
          [actor.spaceId, storyIds],
        );
        if (stories.rowCount !== new Set(storyIds).size)
          throw new StorypaneError('invalid', 'Story references must belong to this space');
      }
    }
  }
  private async validateSnapshot(
    client: PoolClient,
    actor: Actor,
    snapshot: LocaleSnapshot,
    publish: boolean,
  ): Promise<void> {
    const issues = [];
    const root = snapshot.blocks.find((block) => block.id === snapshot.locale.rootBlockId);
    if (
      !root ||
      snapshot.definitions.find((definition) => definition.versionId === root.schemaVersionId)
        ?.kind === 'nestable'
    )
      issues.push({
        path: snapshot.locale.rootBlockId,
        message: 'The root must use a content type or universal schema',
      });
    for (const block of snapshot.blocks) {
      const definition = snapshot.definitions.find((d) => d.versionId === block.schemaVersionId)!;
      issues.push(
        ...validateFields(definition, block.fields, publish).map((i) => ({
          ...i,
          path: `${block.id}.${i.path}`,
        })),
      );
      for (const field of definition.fields.filter((f) => f.type === 'blocks')) {
        const children = snapshot.blocks.filter(
          (b) => b.parentId === block.id && b.parentField === field.name,
        );
        if (
          publish &&
          (field.required || field.minItems) &&
          children.length < Math.max(field.required ? 1 : 0, field.minItems ?? 0)
        )
          issues.push({
            path: `${block.id}.${field.name}`,
            message: `Requires at least ${Math.max(field.required ? 1 : 0, field.minItems ?? 0)} blocks`,
          });
        if (field.maxItems !== undefined && children.length > field.maxItems)
          issues.push({
            path: `${block.id}.${field.name}`,
            message: `Allows at most ${field.maxItems} blocks`,
          });
        for (const child of children) {
          try {
            this.nestingField(
              snapshot,
              block,
              field.name,
              snapshot.definitions.find((d) => d.versionId === child.schemaVersionId)!,
            );
          } catch (error) {
            if (!(error instanceof StorypaneError)) throw error;
            issues.push({
              path: child.id,
              message: `${definition.displayName} → ${field.label}: ${error.message}`,
            });
          }
        }
      }
      for (const field of definition.fields) {
        try {
          await this.validateReferences(
            client,
            actor,
            { ...definition, fields: [field] },
            block.fields,
          );
        } catch (error) {
          if (!(error instanceof StorypaneError)) throw error;
          issues.push({ path: `${block.id}.${field.name}`, message: error.message });
        }
      }
    }
    if (issues.length)
      throw new StorypaneError(
        'invalid',
        issues.length === 1
          ? issues[0]!.message
          : publish
            ? 'Resolve validation errors before publishing'
            : 'Invalid field values',
        issues,
      );
    assembleContent(snapshot);
  }
  private async normalizePositions(
    client: PoolClient,
    localeId: string,
    parentId: string,
    field: string,
    orderedIds?: string[],
  ): Promise<void> {
    const ids =
      orderedIds ??
      (
        await client.query(
          'SELECT id FROM block_drafts WHERE locale_id=$1 AND parent_id=$2 AND parent_field=$3 ORDER BY position,id',
          [localeId, parentId, field],
        )
      ).rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i++)
      await client.query('UPDATE block_drafts SET position=$3 WHERE locale_id=$1 AND id=$2', [
        localeId,
        ids[i],
        i,
      ]);
    await client.query('UPDATE block_drafts SET revision=revision+1 WHERE locale_id=$1 AND id=$2', [
      localeId,
      parentId,
    ]);
  }
  async command(
    actor: Actor,
    storyId: string,
    localeId: string,
    value: unknown,
  ): Promise<CommitResult> {
    const command = parseInput(commandSchema, value);
    const hash = createHash('sha256')
      .update(canonical({ command, userId: actor.userId, sessionId: actor.sessionId }))
      .digest('hex');
    return this.tx(actor, async (client) => {
      await this.authorize(
        client,
        actor,
        ['publishCheckpoint', 'unpublishLocale'].includes(command.type)
          ? 'content:publish'
          : 'content:edit',
      );
      if (['publishCheckpoint', 'unpublishLocale'].includes(command.type))
        await this.lockPaths(client, actor.spaceId);
      await this.lockLocale(client, actor, storyId, localeId);
      const deployed = await this.deployedMigration(client, actor.spaceId);
      if (command.migrationVersion !== undefined && command.migrationVersion !== deployed.version)
        throw new StorypaneError(
          'stale_revision',
          'A schema migration was deployed. Sync before applying your preserved edits.',
        );
      const receipt = await client.query(
        'SELECT * FROM mutation_receipts WHERE locale_id=$1 AND mutation_id=$2',
        [localeId, command.mutationId],
      );
      if (receipt.rowCount) {
        const previous = receipt.rows[0];
        if (previous.actor_id !== actor.userId || previous.request_hash !== hash)
          throw new StorypaneError(
            'invalid',
            'Mutation ID was already used for a different request',
          );
        const checkpoint = await this.readCheckpoint(client, localeId, previous.checkpoint_id);
        if (command.type === 'publishCheckpoint')
          await this.requirePublicationAccess(
            client,
            actor,
            (await this.readCheckpoint(client, localeId, command.payload.checkpointId)).snapshot,
          );
        if (command.type === 'unpublishLocale')
          await this.requirePublicationAccess(client, actor, checkpoint.snapshot);
        if ((checkpoint.snapshot.migrationVersion ?? 0) !== deployed.version)
          throw new StorypaneError(
            'stale_revision',
            'This change was committed before a schema migration. Sync to review the current content.',
          );
        return {
          mutationId: command.mutationId,
          localeRevision: checkpoint.revision,
          changedBlockIds: previous.changed_block_ids,
          checkpointId: checkpoint.id,
          snapshot: checkpoint.snapshot,
          ...(previous.publication_id ? { publicationId: previous.publication_id } : {}),
        };
      }
      const before = await this.snapshot(client, actor, storyId, localeId);
      const access = await this.contentAccess(client, actor);
      const changed = new Set<string>();
      let publicationId: string | undefined;
      const requireOwned = (block: BlockDraft) =>
        this.requireLease(client, actor, localeId, block, command);
      if (command.type === 'saveBlock') {
        const block = requireBlock(before, command.payload.blockId);
        await requireOwned(block);
        const definition = before.definitions.find((d) => d.versionId === block.schemaVersionId)!;
        const visible = projectSnapshot(access, before).access.blocks[block.id];
        for (const [name, value] of Object.entries(command.payload.fields))
          if (
            !visible.fields[name]?.read ||
            (!visible.fields[name]?.edit &&
              JSON.stringify(value) !== JSON.stringify(block.fields[name]))
          )
            throw new StorypaneError('forbidden', 'Your role cannot change this field');
        command.payload.fields = {
          ...Object.fromEntries(
            Object.entries(block.fields).filter(([name]) => !visible.fields[name]?.edit),
          ),
          ...command.payload.fields,
        };
        const issues = validateFields(definition, command.payload.fields);
        if (issues.length) throw new StorypaneError('invalid', 'Invalid field values', issues);
        await this.validateReferences(client, actor, definition, command.payload.fields);
        await client.query(
          'UPDATE block_drafts SET fields=$3,revision=revision+1 WHERE locale_id=$1 AND id=$2',
          [localeId, block.id, JSON.stringify(command.payload.fields)],
        );
        changed.add(block.id);
      } else if (command.type === 'insertBlock') {
        const parent = requireBlock(before, command.payload.parentId);
        await requireOwned(parent);
        const definition = await this.currentDefinition(
          client,
          actor,
          command.payload.definitionId,
        );
        this.nestingField(before, parent, command.payload.parentField, definition);
        const id = randomUUID();
        const siblings = before.blocks
          .filter((b) => b.parentId === parent.id && b.parentField === command.payload.parentField)
          .sort((a, b) => a.position - b.position)
          .map((b) => b.id);
        const position = command.payload.position ?? siblings.length;
        if (position > siblings.length)
          throw new StorypaneError('invalid', 'Invalid insertion position');
        siblings.splice(position, 0, id);
        await client.query(
          'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,fields) VALUES($1,$2,$3,$4,$5,$6)',
          [
            id,
            localeId,
            definition.versionId,
            parent.id,
            command.payload.parentField,
            JSON.stringify(defaultFields(definition)),
          ],
        );
        await this.normalizePositions(
          client,
          localeId,
          parent.id,
          command.payload.parentField,
          siblings,
        );
        changed.add(parent.id);
        changed.add(id);
      } else if (command.type === 'pasteBlock') {
        const { clipboard, parentId, parentField } = command.payload;
        if (clipboard.spaceId !== actor.spaceId)
          throw new StorypaneError(
            'invalid',
            'Blocks can only be pasted within the space they were copied from',
          );
        if (clipboard.migrationVersion !== deployed.version)
          throw new StorypaneError(
            'stale_revision',
            'The schema changed since this block was copied. Copy it again before pasting.',
          );
        const parent = requireBlock(before, parentId);
        await requireOwned(parent);
        const siblings = before.blocks
          .filter((block) => block.parentId === parentId && block.parentField === parentField)
          .sort((a, b) => a.position - b.position)
          .map((block) => block.id);
        const position = command.payload.position ?? siblings.length;
        if (position > siblings.length)
          throw new StorypaneError('invalid', 'Invalid insertion position');
        const ids = clipboard.blocks.map(() => randomUUID());
        siblings.splice(position, 0, ids[0]!);
        const definitions = new Map(
          deployed.definitions.map((definition) => [definition.id, definition]),
        );
        const pasted: BlockDraft[] = clipboard.blocks.map((block, index) => {
          const definition = definitions.get(block.definitionId);
          if (!definition)
            throw new StorypaneError(
              'invalid',
              'A copied block schema is not deployed in this space',
            );
          return {
            id: ids[index]!,
            definitionId: definition.id,
            schemaVersionId: definition.versionId,
            parentId: block.parentIndex === null ? parentId : ids[block.parentIndex]!,
            parentField: block.parentIndex === null ? parentField : block.parentField,
            position: block.parentIndex === null ? position : block.position,
            fields: block.fields,
            revision: 1,
          };
        });
        const proposed = {
          ...before,
          blocks: [...before.blocks, ...pasted],
          definitions: [
            ...new Map(
              [...before.definitions, ...definitions.values()].map((definition) => [
                definition.versionId,
                definition,
              ]),
            ).values(),
          ],
        };
        for (const block of pasted)
          this.nestingField(
            proposed,
            requireBlock(proposed, block.parentId!),
            block.parentField!,
            definitions.get(block.definitionId)!,
          );
        for (const block of pasted) {
          await client.query(
            'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              block.id,
              localeId,
              block.schemaVersionId,
              block.parentId,
              block.parentField,
              block.position,
              JSON.stringify(block.fields),
            ],
          );
          changed.add(block.id);
        }
        await this.normalizePositions(client, localeId, parentId, parentField, siblings);
        changed.add(parentId);
      } else if (command.type === 'moveBlock') {
        const block = requireBlock(before, command.payload.blockId);
        if (!block.parentId || !block.parentField)
          throw new StorypaneError('invalid', 'The root block cannot be moved');
        const oldParent = requireBlock(before, block.parentId);
        const parent = requireBlock(before, command.payload.parentId);
        await requireOwned(block);
        await requireOwned(oldParent);
        if (parent.id !== oldParent.id) await requireOwned(parent);
        const affected = subtree(before, block.id);
        await this.noCompetingLeases(
          client,
          actor,
          localeId,
          affected.map((b) => b.id),
        );
        if (affected.some((b) => b.id === parent.id))
          throw new StorypaneError('invalid', 'A block cannot contain itself');
        this.nestingField(
          before,
          parent,
          command.payload.parentField,
          before.definitions.find((d) => d.versionId === block.schemaVersionId)!,
        );
        const siblings = before.blocks
          .filter(
            (b) =>
              b.parentId === parent.id &&
              b.parentField === command.payload.parentField &&
              b.id !== block.id,
          )
          .sort((a, b) => a.position - b.position)
          .map((b) => b.id);
        if (command.payload.position > siblings.length)
          throw new StorypaneError('invalid', 'Invalid move position');
        siblings.splice(command.payload.position, 0, block.id);
        await client.query(
          'UPDATE block_drafts SET parent_id=$3,parent_field=$4,revision=revision+1 WHERE locale_id=$1 AND id=$2',
          [localeId, block.id, parent.id, command.payload.parentField],
        );
        if (oldParent.id !== parent.id || block.parentField !== command.payload.parentField)
          await this.normalizePositions(client, localeId, oldParent.id, block.parentField);
        await this.normalizePositions(
          client,
          localeId,
          parent.id,
          command.payload.parentField,
          siblings,
        );
        changed.add(block.id);
        changed.add(parent.id);
        changed.add(oldParent.id);
      } else if (command.type === 'deleteBlock') {
        const block = requireBlock(before, command.payload.blockId);
        if (!block.parentId || !block.parentField)
          throw new StorypaneError('invalid', 'The root block cannot be deleted');
        await requireOwned(block);
        await requireOwned(requireBlock(before, block.parentId));
        const affected = subtree(before, block.id);
        await this.noCompetingLeases(
          client,
          actor,
          localeId,
          affected.map((b) => b.id),
        );
        await client.query('DELETE FROM block_drafts WHERE locale_id=$1 AND id=$2', [
          localeId,
          block.id,
        ]);
        await this.normalizePositions(client, localeId, block.parentId, block.parentField);
        affected.forEach((b) => changed.add(b.id));
        changed.add(block.parentId);
      } else if (command.type === 'importBlocks') {
        const parent = requireBlock(before, command.payload.parentId);
        await requireOwned(parent);
        const defaultLocale = (
          await client.query('SELECT id FROM space_locales WHERE space_id=$1 AND is_default', [
            actor.spaceId,
          ])
        ).rows[0];
        if (
          command.payload.sourceLocaleId === localeId ||
          before.locale.spaceLocaleId === defaultLocale.id
        )
          throw new StorypaneError('invalid', 'Import from the default locale into another locale');
        await this.lockLocale(client, actor, storyId, command.payload.sourceLocaleId);
        const source = await this.snapshot(client, actor, storyId, command.payload.sourceLocaleId);
        if (source.locale.spaceLocaleId !== defaultLocale.id)
          throw new StorypaneError(
            'invalid',
            'Only the default locale can be used as an import source',
          );
        const selected = new Set(command.payload.blockIds);
        const roots = command.payload.blockIds.filter((id) => {
          let current = requireBlock(source, id);
          while (current.parentId) {
            if (selected.has(current.parentId)) return false;
            current = requireBlock(source, current.parentId);
          }
          return true;
        });
        let position = before.blocks.filter(
          (b) => b.parentId === parent.id && b.parentField === command.payload.parentField,
        ).length;
        for (const rootId of roots) {
          const root = requireBlock(source, rootId);
          this.nestingField(
            before,
            parent,
            command.payload.parentField,
            source.definitions.find((d) => d.versionId === root.schemaVersionId)!,
          );
          const items = subtree(source, rootId);
          for (const item of items)
            if (!blockAllowed(access, source, item, 'content:read'))
              throw new StorypaneError(
                'forbidden',
                'Importing requires read access to every source field',
              );
          const ids = new Map(items.map((b) => [b.id, randomUUID()]));
          for (const block of items) {
            const id = ids.get(block.id)!;
            await client.query(
              'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                id,
                localeId,
                block.schemaVersionId,
                block.id === rootId ? parent.id : ids.get(block.parentId!)!,
                block.id === rootId ? command.payload.parentField : block.parentField,
                block.id === rootId ? position++ : block.position,
                JSON.stringify(block.fields),
              ],
            );
            changed.add(id);
          }
        }
        await this.normalizePositions(client, localeId, parent.id, command.payload.parentField);
        changed.add(parent.id);
      } else if (command.type === 'restoreBlock') {
        const block = requireBlock(before, command.payload.blockId);
        if (!block.parentId)
          throw new StorypaneError(
            'invalid',
            'Use page restore to restore the root block and its descendants',
          );
        await requireOwned(block);
        const current = subtree(before, block.id);
        await this.noCompetingLeases(
          client,
          actor,
          localeId,
          current.map((b) => b.id),
        );
        const historical = await this.readCheckpoint(
          client,
          localeId,
          command.payload.checkpointId,
        );
        historical.snapshot = await this.restoreMigrationSnapshot(
          client,
          actor,
          historical.snapshot,
        );
        const restored = subtree(historical.snapshot, block.id);
        if (block.parentId) {
          const parent = requireBlock(before, block.parentId);
          this.nestingField(
            before,
            parent,
            block.parentField!,
            historical.snapshot.definitions.find(
              (d) => d.versionId === restored[0].schemaVersionId,
            )!,
          );
        }
        const removedIds = new Set(current.map((b) => b.id));
        const ids = new Map(
          restored.map((b) => [
            b.id,
            before.blocks.some((existing) => existing.id === b.id && !removedIds.has(existing.id))
              ? randomUUID()
              : b.id,
          ]),
        );
        await client.query('DELETE FROM block_drafts WHERE locale_id=$1 AND id=$2', [
          localeId,
          block.id,
        ]);
        for (const old of restored) {
          const id = ids.get(old.id)!;
          const previous = before.blocks.find((b) => b.id === old.id);
          await client.query(
            'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              id,
              localeId,
              old.schemaVersionId,
              old.id === block.id ? block.parentId : ids.get(old.parentId!)!,
              old.id === block.id ? block.parentField : old.parentField,
              old.id === block.id ? block.position : old.position,
              JSON.stringify(old.fields),
              (previous?.revision ?? old.revision) + 1,
            ],
          );
          changed.add(id);
        }
        current.forEach((b) => changed.add(b.id));
      } else if (command.type === 'restorePage') {
        assertSnapshotAccess(access, before, 'content:edit');
        await requireOwned(requireBlock(before, before.locale.rootBlockId));
        if (command.expectedRevisions.$locale !== before.revision)
          throw new StorypaneError(
            'stale_revision',
            'The page changed; review it before restoring',
          );
        await this.noCompetingLeases(
          client,
          actor,
          localeId,
          before.blocks.map((b) => b.id),
        );
        const historical = await this.readCheckpoint(
          client,
          localeId,
          command.payload.checkpointId,
        );
        historical.snapshot = await this.restoreMigrationSnapshot(
          client,
          actor,
          historical.snapshot,
        );
        await client.query('DELETE FROM block_drafts WHERE locale_id=$1', [localeId]);
        for (const block of historical.snapshot.blocks) {
          await client.query(
            'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              block.id,
              localeId,
              block.schemaVersionId,
              block.parentId,
              block.parentField,
              block.position,
              JSON.stringify(block.fields),
              Math.max(
                block.revision,
                before.blocks.find((b) => b.id === block.id)?.revision ?? 0,
              ) + 1,
            ],
          );
          changed.add(block.id);
        }
        before.blocks.forEach((b) => changed.add(b.id));
        await client.query('UPDATE story_locales SET root_block_id=$2 WHERE id=$1', [
          localeId,
          historical.snapshot.locale.rootBlockId,
        ]);
      } else if (command.type === 'publishCheckpoint') {
        if (command.payload.expectedScheduleId !== undefined) {
          const scheduled = (
            await client.query(
              "SELECT id,revision FROM publication_schedules WHERE locale_id=$1 AND status='pending'",
              [localeId],
            )
          ).rows[0];
          if (
            (scheduled?.id ?? null) !== command.payload.expectedScheduleId ||
            (scheduled?.revision ?? null) !== command.payload.expectedScheduleRevision
          )
            throw new StorypaneError(
              'stale_revision',
              'This page’s release changed. Review it again before publishing now.',
            );
        }
        publicationId = await this.publishCheckpointTx(
          client,
          actor,
          storyId,
          localeId,
          command.payload.checkpointId,
          command.payload.referenceChoices,
        );
        await this.cancelPendingSchedules(client, localeId);
      } else if (command.type === 'unpublishLocale') {
        await this.requirePublicationAccess(client, actor, before);
        await this.unpublishLocaleTx(
          client,
          actor,
          storyId,
          localeId,
          command.payload.publicationId,
          command.payload.acknowledgeReferences,
        );
      }

      const after = await this.snapshot(client, actor, storyId, localeId);
      if (command.type !== 'publishCheckpoint') assertContentChanges(access, before, after);
      for (const block of after.blocks) {
        const old = before.blocks.find((item) => item.id === block.id);
        const definition = after.definitions.find(
          (item) => item.versionId === block.schemaVersionId,
        )!;
        for (const field of definition.fields) {
          if (canonical(old?.fields[field.name]) === canonical(block.fields[field.name])) continue;
          const value = block.fields[field.name];
          const ids =
            field.type === 'link' &&
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.type === 'story'
              ? [value.storyId]
              : (field.type === 'option' || field.type === 'options') &&
                  field.source.type === 'stories'
                ? Array.isArray(value)
                  ? value
                  : value
                    ? [value]
                    : []
                : [];
          if (ids.some((id) => !access.locales.some((locale) => locale.storyId === id)))
            throw new StorypaneError('forbidden', 'A referenced story is unavailable');
        }
      }
      await this.validateSnapshot(client, actor, after, false);
      if (after.blocks.length > 1000)
        throw new StorypaneError('invalid', 'A locale supports at most 1,000 blocks');
      const snapshot = await this.checkpoint(client, actor, storyId, localeId, command.type);
      await client.query(
        'INSERT INTO mutation_receipts(locale_id,mutation_id,actor_id,request_hash,checkpoint_id,changed_block_ids,publication_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          localeId,
          command.mutationId,
          actor.userId,
          hash,
          snapshot.checkpointId,
          JSON.stringify([...changed]),
          publicationId ?? null,
        ],
      );
      return {
        mutationId: command.mutationId,
        localeRevision: snapshot.revision,
        changedBlockIds: [...changed],
        checkpointId: snapshot.checkpointId!,
        snapshot,
        ...(publicationId ? { publicationId } : {}),
      };
    });
  }
  private async actionReceipt<T>(
    client: PoolClient,
    actor: Actor,
    requestId: string,
    input: unknown,
    run: () => Promise<T>,
    requiresPublish = false,
  ): Promise<T> {
    const hash = digest(input);
    const previous = (
      await client.query(
        'SELECT request_hash,result FROM story_action_receipts WHERE space_id=$1 AND actor_id=$2 AND request_id=$3',
        [actor.spaceId, actor.userId, requestId],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== hash)
        throw new StorypaneError('invalid', 'Request ID was already used for a different action');
      if (previous.result.requiresPublish) await this.authorize(client, actor, 'content:publish');
      return previous.result.value;
    }
    const result = await run();
    await client.query(
      'INSERT INTO story_action_receipts(space_id,actor_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',
      [
        actor.spaceId,
        actor.userId,
        requestId,
        hash,
        JSON.stringify({ value: result, requiresPublish }),
      ],
    );
    return result;
  }
  private async incomingStoryReferences(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    publishedOnly = false,
    access?: StoreContentAccess,
  ): Promise<LifecycleReview['incomingReferences']> {
    const rows = (
      await client.query(
        `SELECT s.id,s.name,s.folder_id,l.id AS locale_id,c.snapshot AS draft,p.snapshot AS published FROM stories s JOIN story_locales l ON l.story_id=s.id LEFT JOIN checkpoints c ON c.id=l.checkpoint_id LEFT JOIN publications p ON p.id=l.published_version_id WHERE s.space_id=$1 AND s.id<>$2 AND s.deleted_at IS NULL`,
        [actor.spaceId, storyId],
      )
    ).rows;
    const references: LifecycleReview['incomingReferences'] = [];
    for (const row of rows)
      for (const kind of publishedOnly ? ['published'] : ['draft', 'published']) {
        const snapshot = row[kind] as LocaleSnapshot | null;
        if (!snapshot) continue;
        const projected = access?.locales.some((locale) => locale.id === row.locale_id)
          ? projectSnapshot(access, {
              ...snapshot,
              story: { ...snapshot.story, folderId: row.folder_id },
            }).access
          : undefined;
        let readable = false;
        const found = snapshot.blocks.some((block) => {
          const definition = snapshot.definitions.find(
            (item) => item.versionId === block.schemaVersionId,
          );
          return definition?.fields.some((field) => {
            const value = block.fields[field.name];
            const matches =
              field.type === 'link'
                ? !!value &&
                  typeof value === 'object' &&
                  !Array.isArray(value) &&
                  value.type === 'story' &&
                  value.storyId === storyId
                : (field.type === 'option' || field.type === 'options') &&
                  field.source.type === 'stories' &&
                  (Array.isArray(value) ? value.includes(storyId) : value === storyId);
            if (matches && projected?.blocks[block.id]?.fields[field.name]?.read) readable = true;
            return matches;
          });
        });
        if (found)
          references.push({
            storyId: access && !readable ? '' : row.id,
            storyName: access && !readable ? 'Restricted story' : row.name,
            localeId: access && !readable ? '' : row.locale_id,
            published: kind === 'published',
          });
      }
    return references;
  }
  async reviewStoryAction(actor: Actor, storyId: string): Promise<LifecycleReview> {
    parseInput(z.uuid(), storyId);
    return this.tx(actor, async (client) => {
      const story = (
        await client.query('SELECT * FROM stories WHERE id=$1 AND space_id=$2', [
          storyId,
          actor.spaceId,
        ])
      ).rows[0];
      if (!story) throw new StorypaneError('not_found', 'Story not found');
      const access = await loadContentAccess(client, actor, !!story.deleted_at);
      if (!access.locales.some((locale) => locale.storyId === storyId))
        throw new StorypaneError('not_found', 'Story not found');
      const rows = (
        await client.query(
          "SELECT l.*,p.snapshot->'locale'->>'urlSlug' AS published_url_slug FROM story_locales l LEFT JOIN publications p ON p.id=l.published_version_id WHERE l.story_id=$1 ORDER BY l.id",
          [storyId],
        )
      ).rows;
      return {
        story: storyRow(story),
        locales: rows
          .filter((row) => access.locales.some((locale) => locale.id === row.id))
          .map((row) => ({
            id: row.id,
            spaceLocaleId: row.space_locale_id,
            slugSegment: row.slug_segment ?? row.url_slug,
            publishedUrlSlug: row.published_url_slug ?? null,
            checkpointId: row.checkpoint_id,
            publicationId: row.published_version_id,
            name: row.name,
            slug: row.slug,
            urlSlug: row.url_slug,
            revision: Number(row.revision),
          })),
        incomingReferences: await this.incomingStoryReferences(
          client,
          actor,
          storyId,
          false,
          access,
        ),
      };
    });
  }
  private async cancelPendingSchedules(client: PoolClient, localeId: string) {
    await client.query(
      "UPDATE publication_schedules SET status='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE locale_id=$1 AND status='pending'",
      [localeId],
    );
  }
  async reviewPublication(
    actor: Actor,
    storyId: string,
    localeId: string,
    checkpointId: string,
  ): Promise<PublicationReview> {
    return this.tx(
      actor,
      async (client) => {
        await this.lockLocale(client, actor, storyId, localeId);
        const checkpoint = await this.readCheckpoint(client, localeId, checkpointId);
        const live = await client.query(
          'SELECT p.snapshot FROM publications p JOIN story_locales l ON l.published_version_id=p.id WHERE l.id=$1',
          [localeId],
        );
        const publishedSnapshot: LocaleSnapshot | null = live.rows[0]?.snapshot ?? null;
        if (
          !projectSnapshot(await this.contentAccess(client, actor), checkpoint.snapshot).access
            .publish
        )
          return { ...checkpoint, references: [], publishedSnapshot };
        const { references } = await this.publicationPlan(client, actor, checkpoint);
        let reviewBlocked = false;
        try {
          await reviews.assertReviewsApproved(
            client,
            actor,
            await this.snapshot(client, actor, storyId, localeId),
            checkpoint.snapshot,
          );
        } catch (cause) {
          if (cause instanceof StorypaneError && cause.code === 'invalid') reviewBlocked = true;
          else throw cause;
        }
        return { ...checkpoint, references, publishedSnapshot, reviewBlocked };
      },
      'content:read',
    );
  }

  private async publicationPlan(
    client: PoolClient,
    actor: Actor,
    root: CheckpointDetail,
    choices?: PublicationReferenceChoice[],
  ) {
    const selected = new Map(choices?.map((choice) => [choice.localeId, choice]));
    if (selected.size !== (choices?.length ?? 0))
      throw new StorypaneError('invalid', 'Choose each linked locale once.');
    const used = new Set<string>();
    const checkpoints = new Map([[root.snapshot.locale.id, structuredClone(root)]]);
    const references = new Map<string, PublicationReference>();
    const existing = new Map<string, Json>();
    const access = await this.contentAccess(client, actor);
    await this.requirePublicationAccess(client, actor, root.snapshot);
    // A bounded graph handles shared references and cycles without recursively publishing by implication.
    for (const checkpoint of checkpoints.values()) {
      const snapshot = checkpoint.snapshot;
      for (const block of snapshot.blocks) {
        const definition = snapshot.definitions.find(
          (item) => item.versionId === block.schemaVersionId,
        )!;
        for (const field of definition.fields) {
          const value = block.fields[field.name];
          const ids =
            field.type === 'link' &&
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.type === 'story'
              ? [value.storyId as string]
              : (field.type === 'option' || field.type === 'options') &&
                  field.source.type === 'stories'
                ? ((Array.isArray(value) ? value : value ? [value] : []) as string[])
                : [];
          for (const storyId of new Set(ids)) {
            const locales = (
              await client.query(
                `SELECT l.*,s.name AS story_name,s.folder_id,c.id AS checkpoint_id,p.checkpoint_id AS published_checkpoint_id,p.content AS published_content,(${pendingLocaleSql}) AS pending
               FROM story_locales l JOIN stories s ON s.id=l.story_id
               JOIN checkpoints c ON c.id=l.checkpoint_id
               LEFT JOIN publications p ON p.id=l.published_version_id
               WHERE s.id=$1 AND s.space_id=$2 AND s.deleted_at IS NULL AND l.slug IN ($3,(SELECT slug FROM space_locales WHERE space_id=$2 AND is_default))
               ORDER BY (l.slug=$3) DESC`,
                [storyId, actor.spaceId, snapshot.locale.slug],
              )
            ).rows;
            const target = locales[0];
            if (!target)
              throw new StorypaneError(
                'invalid',
                'A linked story is unavailable. Remove the reference and review again.',
              );
            if (target.id === root.snapshot.locale.id) continue;
            const choice = selected.get(target.id);
            if (!target.pending && !choice) continue;
            if (!access.locales.some((locale) => locale.id === target.id))
              throw new StorypaneError('forbidden', 'A linked locale is outside your read access.');
            used.add(target.id);
            if (choices && !choice)
              throw new StorypaneError(
                'invalid',
                `Choose whether to publish ${target.story_name} too or omit it from this publication.`,
              );
            let reference = references.get(target.id);
            if (!reference) {
              if (references.size >= 100)
                throw new StorypaneError(
                  'invalid',
                  'Publish some linked stories separately before reviewing more than 100 unpublished references.',
                );
              const linked = await this.readCheckpoint(
                client,
                target.id,
                choice?.checkpointId ?? target.checkpoint_id,
              );
              let canPublish = true;
              try {
                this.assertCompleteAccess(
                  access,
                  {
                    ...linked.snapshot,
                    story: { ...linked.snapshot.story, folderId: target.folder_id },
                  },
                  'content:publish',
                );
              } catch (error) {
                if (!(error instanceof StorypaneError) || error.code !== 'forbidden') throw error;
                canPublish = false;
              }
              reference = {
                storyId,
                storyName: target.story_name,
                localeId: target.id,
                localeName: target.name,
                checkpointId: linked.id,
                publicationId: target.published_version_id,
                revision: linked.revision,
                canPublish,
                usages: [],
              };
              references.set(target.id, reference);
              if ((!choices && canPublish) || choice?.action === 'publish') {
                if (!canPublish)
                  throw new StorypaneError(
                    'forbidden',
                    `You cannot publish ${target.story_name}. Omit it or ask a publisher to publish it first.`,
                  );
                if (target.published_checkpoint_id === linked.id) {
                  existing.set(target.id, target.published_content);
                } else if (
                  choices &&
                  (choice?.publicationId ?? null) !== target.published_version_id
                )
                  throw new StorypaneError(
                    'stale_revision',
                    `${target.story_name} has a different publication. Review again.`,
                  );
                checkpoints.set(target.id, structuredClone(linked));
              }
            }
            const current = block.fields[field.name];
            const omitted = Array.isArray(current) ? current.filter((id) => id !== storyId) : null;
            const canOmit = !validateFields(
              definition,
              { ...block.fields, [field.name]: omitted },
              true,
            ).some((issue) => issue.path === field.name);
            reference.usages.push({
              localeId: snapshot.locale.id,
              storyName: snapshot.story.name,
              field: field.label,
              canOmit,
            });
            if (choice?.action === 'omit') block.fields[field.name] = omitted;
          }
        }
      }
      checkpoint.content = assembleContent(snapshot);
    }
    if (choices) {
      if (choices.some((choice) => !used.has(choice.localeId)))
        throw new StorypaneError(
          'stale_revision',
          'The linked stories changed. Review the publication again.',
        );
      const deployed = await this.deployedMigration(client, actor.spaceId);
      for (const checkpoint of checkpoints.values()) {
        if ((checkpoint.snapshot.migrationVersion ?? 0) !== deployed.version)
          throw new StorypaneError(
            'invalid',
            `Restore ${checkpoint.snapshot.story.name} under the current schema before publishing it.`,
          );
        await this.validateSnapshot(client, actor, checkpoint.snapshot, true);
        if (
          existing.has(checkpoint.snapshot.locale.id) &&
          canonical(checkpoint.content) !== canonical(existing.get(checkpoint.snapshot.locale.id))
        )
          throw new StorypaneError(
            'stale_revision',
            `${checkpoint.snapshot.story.name} has a different publication. Review again.`,
          );
      }
    }
    return {
      checkpoints: [...checkpoints.values()].filter(
        (checkpoint) => !existing.has(checkpoint.snapshot.locale.id),
      ),
      references: [...references.values()],
    };
  }

  private async publishCheckpointTx(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    localeId: string,
    checkpointId: string,
    referenceChoices: PublicationReferenceChoice[] = [],
  ): Promise<string> {
    const root = await this.readCheckpoint(client, localeId, checkpointId);
    const { checkpoints } = await this.publicationPlan(client, actor, root, referenceChoices);
    let rootPublicationId = '';
    for (const checkpoint of checkpoints) {
      const target = checkpoint.snapshot;
      await this.lockLocale(client, actor, target.story.id, target.locale.id);
      if (
        target.locale.id !== localeId &&
        (
          await client.query(
            "SELECT 1 FROM publication_schedules WHERE locale_id=$1 AND status='pending'",
            [target.locale.id],
          )
        ).rowCount
      )
        throw new StorypaneError(
          'invalid',
          `${target.story.name} belongs to a release. Publish it from its own page or update that release first.`,
        );
      const publicationId = await this.publishSnapshotTx(client, actor, checkpoint);
      if (target.locale.id === localeId) rootPublicationId = publicationId;
      else {
        await this.cancelPendingSchedules(client, target.locale.id);
        await this.checkpoint(
          client,
          actor,
          target.story.id,
          target.locale.id,
          'Published with linked story',
        );
      }
    }
    return rootPublicationId;
  }

  private async publishSnapshotTx(
    client: PoolClient,
    actor: Actor,
    historical: CheckpointDetail,
    pinned = false,
  ): Promise<string> {
    const storyId = historical.snapshot.story.id,
      localeId = historical.snapshot.locale.id,
      checkpointId = historical.id;
    await this.requirePublicationAccess(client, actor, historical.snapshot);
    const current = await this.snapshot(client, actor, storyId, localeId);
    await reviews.assertReviewsApproved(client, actor, current, historical.snapshot, pinned);
    const deployed = await this.deployedMigration(client, actor.spaceId);
    if ((historical.snapshot.migrationVersion ?? 0) !== deployed.version)
      throw new StorypaneError(
        'invalid',
        'Restore this checkpoint under the current schema before publishing it.',
      );
    const collision = await client.query(
      "SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id JOIN publications p ON p.id=l.published_version_id WHERE s.space_id=$1 AND s.deleted_at IS NULL AND l.space_locale_id=$2 AND l.id<>$3 AND coalesce(p.snapshot->'locale'->>'urlSlug',l.url_slug)=$4",
      [
        actor.spaceId,
        historical.snapshot.locale.spaceLocaleId,
        localeId,
        historical.snapshot.locale.urlSlug,
      ],
    );
    if (collision.rowCount)
      throw new StorypaneError(
        'invalid',
        'Another page still publishes this URL. Republish it at its new URL first.',
      );
    await this.validateSnapshot(client, actor, historical.snapshot, true);
    const publicationId = randomUUID();
    await client.query(
      'INSERT INTO publications(id,locale_id,checkpoint_id,revision,actor_id,content,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        publicationId,
        localeId,
        historical.id,
        historical.revision,
        actor.userId,
        JSON.stringify(historical.content),
        JSON.stringify(historical.snapshot),
      ],
    );
    await client.query('UPDATE story_locales SET published_version_id=$2 WHERE id=$1', [
      localeId,
      publicationId,
    ]);
    await reviews.completePublishedReviews(client, actor, historical.snapshot);
    await recordWebhookEvent(client, {
      spaceId: actor.spaceId,
      actorId: actor.userId,
      type: 'story.published',
      key: `story.published:${publicationId}`,
      data: {
        storyId,
        localeId,
        checkpointId,
        publicationId,
        revision: historical.revision,
        path: historical.snapshot.locale.urlSlug,
        locale: historical.snapshot.locale.slug,
      },
    });
    return publicationId;
  }
  private async unpublishLocaleTx(
    client: PoolClient,
    actor: Actor,
    storyId: string,
    localeId: string,
    publicationId: string | null,
    acknowledgeReferences: boolean,
  ) {
    const locale = (
      await client.query('SELECT published_version_id FROM story_locales WHERE id=$1', [localeId])
    ).rows[0];
    if (publicationId) {
      const published = (
        await client.query('SELECT snapshot FROM publications WHERE id=$1 AND locale_id=$2', [
          publicationId,
          localeId,
        ])
      ).rows[0];
      if (published) await this.requirePublicationAccess(client, actor, published.snapshot);
    }
    if (locale.published_version_id !== publicationId)
      throw new StorypaneError(
        'stale_revision',
        'The publication changed; review it before unpublishing.',
      );
    if (
      publicationId &&
      !acknowledgeReferences &&
      (await this.incomingStoryReferences(client, actor, storyId, true)).length
    )
      throw new StorypaneError(
        'invalid',
        'Other published stories link here. Acknowledge the incoming references before unpublishing.',
      );
    await this.cancelPendingSchedules(client, localeId);
    await client.query('UPDATE story_locales SET published_version_id=NULL WHERE id=$1', [
      localeId,
    ]);
    if (publicationId)
      await recordWebhookEvent(client, {
        spaceId: actor.spaceId,
        actorId: actor.userId,
        type: 'story.unpublished',
        key: `story.unpublished:${publicationId}`,
        data: { storyId, localeId, publicationId },
      });
  }
  async storyAction(actor: Actor, storyId: string, raw: unknown): Promise<StoryActionResult> {
    parseInput(z.uuid(), storyId);
    const input = parseInput(storyActionSchema, raw);
    const permission =
      input.action === 'publish' || input.action === 'unpublish'
        ? 'content:publish'
        : 'content:edit';
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        const source = (
          await client.query('SELECT * FROM stories WHERE id=$1 AND space_id=$2 FOR UPDATE', [
            storyId,
            actor.spaceId,
          ])
        ).rows[0];
        if (!source) throw new StorypaneError('not_found', 'Story not found');
        const locales = (
          await client.query(
            'SELECT * FROM story_locales WHERE story_id=$1 ORDER BY id FOR UPDATE',
            [storyId],
          )
        ).rows;
        const previousRequirement =
          input.action === 'delete'
            ? (
                await client.query(
                  'SELECT result FROM story_action_receipts WHERE space_id=$1 AND actor_id=$2 AND request_id=$3',
                  [actor.spaceId, actor.userId, input.requestId],
                )
              ).rows[0]?.result.requiresPublish
            : false;
        const requiresPublish =
          input.action === 'delete' &&
          (previousRequirement ||
            input.locales.some((locale) => locale.publicationId) ||
            locales.some((locale) => locale.published_version_id) ||
            (
              await client.query(
                "SELECT 1 FROM publication_schedules WHERE story_id=$1 AND status='pending'",
                [storyId],
              )
            ).rowCount);
        if (requiresPublish) await this.authorize(client, actor, 'content:publish');
        const access = await loadContentAccess(client, actor, !!source.deleted_at);
        if (!access.locales.some((locale) => locale.storyId === storyId))
          throw new StorypaneError('not_found', 'Story not found');
        for (const locale of locales) {
          if (
            (input.action === 'publish' || input.action === 'unpublish') &&
            !input.locales.some((target) => target.id === locale.id)
          )
            continue;
          const checkpoint = await this.readCheckpoint(client, locale.id, locale.checkpoint_id);
          const current = { ...checkpoint.snapshot, story: storyRow(source) };
          if (input.action === 'restore') {
            assertLocationAccess(
              access,
              { storyId, folderId: source.folder_id, spaceLocaleId: locale.space_locale_id },
              'content:edit',
            );
          } else if (input.action === 'publish') {
            const target = input.locales.find((target) => target.id === locale.id)!;
            if (!target.checkpointId)
              throw new StorypaneError('invalid', 'Review a saved checkpoint first');
            const pinned = await this.readCheckpoint(client, locale.id, target.checkpointId);
            this.assertCompleteAccess(
              access,
              { ...pinned.snapshot, story: storyRow(source) },
              'content:publish',
            );
          } else {
            this.assertCompleteAccess(
              access,
              current,
              input.action === 'duplicate'
                ? 'content:read'
                : input.action === 'unpublish'
                  ? 'content:publish'
                  : 'content:edit',
            );
            if (requiresPublish) this.assertCompleteAccess(access, current, 'content:publish');
          }
          if (input.action === 'move' || input.action === 'duplicate') {
            const folderId = input.action === 'move' ? input.location.folderId : input.folderId;
            this.assertCompleteAccess(
              access,
              {
                ...current,
                story: {
                  ...current.story,
                  id: input.action === 'duplicate' ? randomUUID() : storyId,
                  folderId,
                },
              },
              'content:edit',
            );
          }
        }
        return this.actionReceipt(
          client,
          actor,
          input.requestId,
          { storyId, ...input },
          async () => {
            if (input.action !== 'restore' && source.deleted_at)
              throw new StorypaneError('not_found', 'Story was deleted');
            if (input.action === 'restore') {
              if (!source.deleted_at)
                return { story: storyRow(source), localeIds: locales.map((locale) => locale.id) };
              await client.query('UPDATE stories SET deleted_at=NULL,deleted_by=NULL WHERE id=$1', [
                storyId,
              ]);
              for (const locale of locales) {
                const historical = await this.readCheckpoint(
                  client,
                  locale.id,
                  locale.checkpoint_id,
                );
                const restored = await this.restoreMigrationSnapshot(
                  client,
                  actor,
                  historical.snapshot,
                );
                this.assertCompleteAccess(
                  access,
                  { ...restored, story: storyRow({ ...source, deleted_at: null }) },
                  'content:edit',
                );
                await this.validateSnapshot(client, actor, restored, false);
                await client.query('DELETE FROM block_drafts WHERE locale_id=$1', [locale.id]);
                for (const block of restored.blocks)
                  await client.query(
                    'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
                    [
                      block.id,
                      locale.id,
                      block.schemaVersionId,
                      block.parentId,
                      block.parentField,
                      block.position,
                      JSON.stringify(block.fields),
                      block.revision + 1,
                    ],
                  );
                await client.query(
                  'UPDATE story_locales SET root_block_id=$2,published_version_id=NULL WHERE id=$1',
                  [locale.id, restored.locale.rootBlockId],
                );
                await this.checkpoint(client, actor, storyId, locale.id, 'Restore deleted story');
              }
              await this.refreshPaths(client, actor, await this.folders(client, actor.spaceId));
            } else if (input.action === 'delete') {
              const actual = locales.map((locale) => ({
                id: locale.id,
                checkpointId: locale.checkpoint_id,
                publicationId: locale.published_version_id,
              }));
              if (
                canonical(actual) !==
                canonical([...input.locales].sort((a, b) => a.id.localeCompare(b.id)))
              )
                throw new StorypaneError(
                  'stale_revision',
                  'The story changed; review every locale before deleting.',
                );
              if ((await this.incomingStoryReferences(client, actor, storyId)).length)
                throw new StorypaneError(
                  'invalid',
                  'Other active stories reference this story. Remove those references before deleting.',
                );
              for (const locale of locales) {
                const blocks = (
                  await client.query('SELECT id FROM block_drafts WHERE locale_id=$1', [locale.id])
                ).rows;
                await this.noCompetingLeases(
                  client,
                  actor,
                  locale.id,
                  blocks.map((block) => block.id),
                );
                await this.unpublishLocaleTx(
                  client,
                  actor,
                  storyId,
                  locale.id,
                  locale.published_version_id,
                  true,
                );
                await this.checkpoint(client, actor, storyId, locale.id, 'Delete story');
              }
              await client.query('DELETE FROM edit_leases WHERE locale_id=ANY($1::uuid[])', [
                locales.map((locale) => locale.id),
              ]);
              await client.query('DELETE FROM preview_sessions WHERE story_id=$1', [storyId]);
              await client.query(
                'UPDATE stories SET deleted_at=clock_timestamp(),deleted_by=$2 WHERE id=$1',
                [storyId, actor.userId],
              );
              await recordWebhookEvent(client, {
                spaceId: actor.spaceId,
                actorId: actor.userId,
                type: 'story.deleted',
                key: `story.deleted:${input.requestId}`,
                data: { storyId, path: source.slug },
              });
            } else if (input.action === 'duplicate') {
              const folders = await this.folders(client, actor.spaceId);
              folderPath(folders, input.folderId);
              const snapshots: LocaleSnapshot[] = [];
              for (const locale of locales)
                snapshots.push(await this.snapshot(client, actor, storyId, locale.id));
              for (const snapshot of snapshots)
                this.checkFolderType(
                  folders,
                  input.folderId,
                  requireBlock(snapshot, snapshot.locale.rootBlockId).definitionId,
                );
              const copyBase = (source.slug_segment ?? source.slug)
                .slice(0, 180)
                .replace(/[^\p{L}\p{N}_-]+$/u, '');
              let slug = input.slug ?? `${copyBase}-copy`,
                suffix = 2;
              if (!input.slug)
                while (
                  (
                    await client.query(
                      'SELECT 1 FROM stories WHERE space_id=$1 AND slug=$2 UNION ALL SELECT 1 FROM story_locales WHERE (space_locale_id::text,url_slug) IN (SELECT * FROM unnest($3::text[],$4::text[]))',
                      [
                        actor.spaceId,
                        joinPath(folderPath(folders, input.folderId), slug),
                        snapshots.map((snapshot) => snapshot.locale.spaceLocaleId),
                        snapshots.map((snapshot) =>
                          joinPath(
                            folderPath(folders, input.folderId, snapshot.locale.spaceLocaleId),
                            slug,
                          ),
                        ),
                      ],
                    )
                  ).rowCount
                )
                  slug = `${copyBase}-copy-${suffix++}`;
              parseInput(pathSlugSchema, slug);
              const id = randomUUID(),
                path = joinPath(folderPath(folders, input.folderId), slug);
              if (path.length > 2048)
                throw new StorypaneError('invalid', 'Page paths cannot exceed 2,048 characters');
              if (
                (
                  await client.query('SELECT 1 FROM stories WHERE space_id=$1 AND slug=$2', [
                    actor.spaceId,
                    path,
                  ])
                ).rowCount
              )
                throw new StorypaneError(
                  'invalid',
                  'This path is already reserved by an active or deleted story.',
                );
              await client.query(
                'INSERT INTO stories(id,space_id,name,slug,slug_segment,folder_id) VALUES($1,$2,$3,$4,$5,$6)',
                [
                  id,
                  actor.spaceId,
                  input.name ?? `${source.name.slice(0, 195)} copy`,
                  path,
                  slug,
                  input.folderId,
                ],
              );
              const newLocales: string[] = [];
              for (const snapshot of snapshots) {
                const localeId = randomUUID(),
                  ids = new Map(snapshot.blocks.map((block) => [block.id, randomUUID()]));
                const localePath = joinPath(
                  folderPath(folders, input.folderId, snapshot.locale.spaceLocaleId),
                  slug,
                );
                if (localePath.length > 2048)
                  throw new StorypaneError('invalid', 'Page paths cannot exceed 2,048 characters');
                if (
                  (
                    await client.query(
                      'SELECT 1 FROM story_locales WHERE space_locale_id=$1 AND url_slug=$2',
                      [snapshot.locale.spaceLocaleId, localePath],
                    )
                  ).rowCount
                )
                  throw new StorypaneError(
                    'invalid',
                    'This translated path is reserved by an active or deleted story.',
                  );
                await client.query(
                  'INSERT INTO story_locales(id,story_id,space_locale_id,slug,name,url_slug,slug_segment,root_block_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
                  [
                    localeId,
                    id,
                    snapshot.locale.spaceLocaleId,
                    snapshot.locale.slug,
                    snapshot.locale.name,
                    localePath,
                    slug,
                    ids.get(snapshot.locale.rootBlockId),
                  ],
                );
                for (const block of snapshot.blocks)
                  await client.query(
                    'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,$5,$6,$7)',
                    [
                      ids.get(block.id),
                      localeId,
                      block.schemaVersionId,
                      block.parentId ? ids.get(block.parentId) : null,
                      block.parentField,
                      block.position,
                      JSON.stringify(block.fields),
                    ],
                  );
                const copied = await this.snapshot(client, actor, id, localeId);
                await this.validateSnapshot(client, actor, copied, false);
                await this.checkpoint(client, actor, id, localeId, 'Duplicate story');
                newLocales.push(localeId);
              }
              return {
                story: storyRow(
                  (await client.query('SELECT * FROM stories WHERE id=$1', [id])).rows[0],
                ),
                localeIds: newLocales,
              };
            } else if (input.action === 'move') {
              const location = input.location,
                folders = await this.folders(client, actor.spaceId);
              folderPath(folders, location.folderId);
              if (
                Object.keys(location.localeSlugs).some(
                  (id) =>
                    !locales.some((locale) => locale.space_locale_id === id && locale.slug !== ''),
                )
              )
                throw new StorypaneError(
                  'invalid',
                  'Choose an existing locale for translated slugs',
                );
              await client.query('UPDATE stories SET folder_id=$2,slug_segment=$3 WHERE id=$1', [
                storyId,
                location.folderId,
                location.slug,
              ]);
              for (const locale of locales)
                await client.query('UPDATE story_locales SET slug_segment=$2 WHERE id=$1', [
                  locale.id,
                  locale.slug === ''
                    ? location.slug
                    : (location.localeSlugs[locale.space_locale_id] ?? locale.slug_segment),
                ]);
              await this.refreshPaths(client, actor, folders, storyId);
            } else {
              if (new Set(input.locales.map((locale) => locale.id)).size !== input.locales.length)
                throw new StorypaneError('invalid', 'Choose each locale once');
              for (const target of input.locales) {
                const locale = locales.find((locale) => locale.id === target.id);
                if (!locale)
                  throw new StorypaneError('invalid', 'Locale does not belong to this story');
                if (input.action === 'publish') {
                  if (
                    (
                      await client.query(
                        "SELECT 1 FROM publication_schedules WHERE locale_id=$1 AND status='pending'",
                        [locale.id],
                      )
                    ).rowCount
                  )
                    throw new StorypaneError(
                      'invalid',
                      'This page belongs to a release. Open its editor to update the release or publish now and remove it.',
                    );
                  if (!target.checkpointId)
                    throw new StorypaneError('invalid', 'Review a saved checkpoint first');
                  await this.publishCheckpointTx(
                    client,
                    actor,
                    storyId,
                    locale.id,
                    target.checkpointId,
                    target.referenceChoices,
                  );
                  await this.cancelPendingSchedules(client, locale.id);
                } else
                  await this.unpublishLocaleTx(
                    client,
                    actor,
                    storyId,
                    locale.id,
                    target.publicationId,
                    input.acknowledgeReferences,
                  );
                await this.checkpoint(
                  client,
                  actor,
                  storyId,
                  locale.id,
                  input.action === 'publish' ? 'publishCheckpoint' : 'unpublishLocale',
                );
              }
            }
            return {
              story: storyRow(
                (await client.query('SELECT * FROM stories WHERE id=$1', [storyId])).rows[0],
              ),
              localeIds: locales.map((locale) => locale.id),
            };
          },
          !!requiresPublish,
        );
      },
      permission,
      true,
    );
  }
  async bulkStoryAction(actor: Actor, raw: unknown): Promise<BulkStoryActionResult[]> {
    const input = parseInput(bulkStoryActionSchema, raw),
      results: BulkStoryActionResult[] = [];
    for (const item of input.items)
      try {
        results.push({
          storyId: item.storyId,
          result: await this.storyAction(actor, item.storyId, item.input),
        });
      } catch (error) {
        results.push({
          storyId: item.storyId,
          error:
            error instanceof StorypaneError
              ? { code: error.code, message: error.message }
              : {
                  code: 'unavailable',
                  message: 'The action could not complete. Retry the same selection.',
                },
        });
      }
    return results;
  }
  private async releaseItems(client: PoolClient, release: Row) {
    return (
      await client.query(
        `SELECT s.*,c.revision AS checkpoint_revision,coalesce(s.approved_snapshot,c.snapshot) AS approved,
        st.name AS story_name,st.folder_id,st.deleted_at,l.name AS locale_name,l.slug AS locale_slug,
        l.revision AS draft_revision,l.url_slug,draft.content AS draft_content,
        r.name AS release_name,r.revision AS release_revision,r.status AS release_status
       FROM publication_schedules s JOIN content_releases r ON r.id=s.release_id
       JOIN checkpoints c ON c.id=s.checkpoint_id JOIN stories st ON st.id=s.story_id
       JOIN story_locales l ON l.id=s.locale_id LEFT JOIN checkpoints draft ON draft.id=l.checkpoint_id
       WHERE s.release_id=$1 AND (s.status<>'cancelled' OR s.cancelled_by_release) ORDER BY st.name,l.name,s.id`,
        [release.id],
      )
    ).rows;
  }
  private async releaseView(
    client: PoolClient,
    actor: Actor,
    release: Row,
  ): Promise<ContentRelease | null> {
    const access = await this.contentAccess(client, actor);
    const items = await this.releaseItems(client, release);
    // Release-wide names and actions are only visible when all member locales are readable.
    if (
      items.some((item) => !access.locales.some((locale) => locale.id === item.locale_id)) ||
      (!items.length && !access.admin && release.creator_id !== actor.userId)
    )
      return null;
    let canManage = access.permissions.includes('content:publish');
    for (const item of items) {
      try {
        this.assertCompleteAccess(
          access,
          {
            ...item.approved,
            story: { ...item.approved.story, folderId: item.folder_id },
          },
          'content:publish',
        );
      } catch (error) {
        if (!(error instanceof StorypaneError) || error.code !== 'forbidden') throw error;
        canManage = false;
      }
    }
    return {
      id: release.id,
      name: release.name,
      dueAt: iso(release.due_at),
      timezone: release.timezone,
      status: release.status,
      revision: release.revision,
      error: release.error,
      canManage,
      items: items.map((item) => ({
        ...scheduleRow(item),
        storyName: item.story_name,
        localeName: item.locale_name,
        localeSlug: item.locale_slug,
        draftRevision: Number(item.draft_revision),
        draftChanged:
          canonical(assembleContent(item.approved)) !== canonical(item.draft_content) ||
          item.approved.locale.urlSlug !== item.url_slug,
      })),
    };
  }
  private async editableRelease(client: PoolClient, actor: Actor, id: string, revision: number) {
    const row = (
      await client.query('SELECT * FROM content_releases WHERE id=$1 AND space_id=$2 FOR UPDATE', [
        id,
        actor.spaceId,
      ])
    ).rows[0];
    if (!row) throw new StorypaneError('not_found', 'Release not found');
    const view = await this.releaseView(client, actor, row);
    if (!view) throw new StorypaneError('not_found', 'Release not found');
    if (!view.canManage)
      throw new StorypaneError(
        'forbidden',
        'Publishing access to every page in this release is required.',
      );
    if (row.revision !== revision || !['scheduled', 'held'].includes(row.status))
      throw new StorypaneError(
        'stale_revision',
        'This release changed. Refresh and review it before continuing.',
      );
    return row;
  }
  async listReleases(actor: Actor): Promise<ContentRelease[]> {
    return this.tx(actor, async (client) => {
      const rows = (
        await client.query(
          `SELECT * FROM content_releases WHERE space_id=$1
        ORDER BY CASE WHEN status IN ('scheduled','held') THEN 0 ELSE 1 END,due_at DESC`,
          [actor.spaceId],
        )
      ).rows;
      const releases: ContentRelease[] = [];
      for (const row of rows) {
        const release = await this.releaseView(client, actor, row);
        if (release) releases.push(release);
      }
      return releases;
    });
  }
  async saveRelease(actor: Actor, raw: unknown, id?: string): Promise<ContentRelease> {
    const input = parseInput(releaseInputSchema, raw);
    if (id) parseInput(z.uuid(), id);
    validateReleaseTime(input);
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        const result = await this.actionReceipt(
          client,
          actor,
          input.requestId,
          { releaseId: id ?? null, ...input },
          async () => {
            if (
              !(
                await client.query('SELECT $1::timestamptz>clock_timestamp() AS future', [
                  input.dueAt,
                ])
              ).rows[0].future
            )
              throw new StorypaneError('invalid', 'Choose a future release time.');
            let release: Row;
            if (id) {
              release = await this.editableRelease(client, actor, id, input.revision ?? 0);
              const items = await this.releaseItems(client, release);
              const deployed = await this.deployedMigration(client, actor.spaceId);
              for (const item of items) {
                if ((item.approved.migrationVersion ?? 0) !== deployed.version)
                  throw new StorypaneError(
                    'invalid',
                    'Update every page to the current schema before resuming this release.',
                  );
                await this.validateSnapshot(client, actor, item.approved, true);
                if (
                  (
                    await client.query(
                      "SELECT 1 FROM publication_schedules WHERE locale_id=$1 AND status='pending' AND release_id<>$2",
                      [item.locale_id, id],
                    )
                  ).rowCount
                )
                  throw new StorypaneError(
                    'stale_revision',
                    'A page has moved to another release. Remove it before resuming this release.',
                  );
              }
              await client.query(
                "UPDATE content_releases SET name=$2,due_at=$3,timezone=$4,status='scheduled',error=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
                [id, input.name, input.dueAt, input.timezone],
              );
              await client.query(
                "UPDATE publication_schedules SET due_at=$2,timezone=$3,next_attempt_at=$2,status='pending',error=NULL,attempt_count=0,revision=revision+1,updated_at=clock_timestamp() WHERE release_id=$1 AND status IN ('pending','failed')",
                [id, input.dueAt, input.timezone],
              );
            } else {
              release = (
                await client.query(
                  'INSERT INTO content_releases(space_id,name,creator_id,due_at,timezone) VALUES($1,$2,$3,$4,$5) RETURNING *',
                  [actor.spaceId, input.name, actor.userId, input.dueAt, input.timezone],
                )
              ).rows[0];
            }
            const current = (
              await client.query('SELECT * FROM content_releases WHERE id=$1', [release.id])
            ).rows[0];
            return (await this.releaseView(client, actor, current))!;
          },
          true,
        );
        const current = (
          await client.query('SELECT * FROM content_releases WHERE id=$1 AND space_id=$2', [
            result.id,
            actor.spaceId,
          ])
        ).rows[0];
        const view = current && (await this.releaseView(client, actor, current));
        if (!view) throw new StorypaneError('not_found', 'Release not found');
        return view;
      },
      'content:publish',
      true,
    );
  }
  async cancelRelease(actor: Actor, id: string, raw: unknown): Promise<ContentRelease> {
    parseInput(z.uuid(), id);
    const input = parseInput(cancelScheduleSchema, raw);
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        const result = await this.actionReceipt(
          client,
          actor,
          input.requestId,
          { releaseId: id, ...input },
          async () => {
            await this.editableRelease(client, actor, id, input.revision);
            await client.query(
              "UPDATE publication_schedules SET status='cancelled',cancelled_by_release=true,revision=revision+1,updated_at=clock_timestamp() WHERE release_id=$1 AND status IN ('pending','failed')",
              [id],
            );
            const release = (
              await client.query(
                "UPDATE content_releases SET status='cancelled',error=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
                [id],
              )
            ).rows[0];
            return (await this.releaseView(client, actor, release))!;
          },
          true,
        );
        const current = (
          await client.query('SELECT * FROM content_releases WHERE id=$1 AND space_id=$2', [
            result.id,
            actor.spaceId,
          ])
        ).rows[0];
        const view = current && (await this.releaseView(client, actor, current));
        if (!view) throw new StorypaneError('not_found', 'Release not found');
        return view;
      },
      'content:publish',
      true,
    );
  }
  async listSchedules(
    actor: Actor,
    storyId: string,
    localeId: string,
  ): Promise<PublicationSchedule[]> {
    return this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      return (
        await client.query(
          'SELECT s.*,c.revision AS checkpoint_revision,r.name AS release_name,r.revision AS release_revision,r.status AS release_status FROM publication_schedules s JOIN checkpoints c ON c.id=s.checkpoint_id JOIN content_releases r ON r.id=s.release_id WHERE s.locale_id=$1 ORDER BY s.created_at DESC LIMIT 20',
          [localeId],
        )
      ).rows.map(scheduleRow);
    });
  }
  async schedulePublication(
    actor: Actor,
    storyId: string,
    localeId: string,
    raw: unknown,
  ): Promise<PublicationSchedule> {
    const input = parseInput(scheduleInputSchema, raw);
    validateReleaseTime(input);
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        await this.lockLocale(client, actor, storyId, localeId);
        const checkpoint = await this.readCheckpoint(client, localeId, input.checkpointId);
        await this.requirePublicationAccess(client, actor, checkpoint.snapshot);
        return this.actionReceipt(
          client,
          actor,
          input.requestId,
          { storyId, localeId, ...input },
          async () => {
            const pending = (
              await client.query(
                "SELECT * FROM publication_schedules WHERE locale_id=$1 AND status='pending' FOR UPDATE",
                [localeId],
              )
            ).rows[0];
            if (
              (pending?.id ?? null) !== input.expectedScheduleId ||
              (pending?.revision ?? null) !== input.expectedRevision
            )
              throw new StorypaneError(
                'stale_revision',
                'The scheduled version changed. Refresh and review it before continuing.',
              );
            let release: Row;
            if (pending && input.expectedReleaseRevision !== undefined) {
              const source = (
                await client.query('SELECT revision FROM content_releases WHERE id=$1', [
                  pending.release_id,
                ])
              ).rows[0];
              if (source.revision !== input.expectedReleaseRevision)
                throw new StorypaneError(
                  'stale_revision',
                  'The release changed. Refresh and review it before moving or updating this page.',
                );
            }
            if (input.release)
              release = await this.editableRelease(
                client,
                actor,
                input.release.id,
                input.release.revision,
              );
            else
              release = (
                await client.query(
                  'INSERT INTO content_releases(space_id,name,creator_id,due_at,timezone) VALUES($1,$2,$3,$4,$5) RETURNING *',
                  [
                    actor.spaceId,
                    input.releaseName ?? `${checkpoint.snapshot.story.name} release`.slice(0, 120),
                    actor.userId,
                    input.dueAt,
                    input.timezone,
                  ],
                )
              ).rows[0];
            if (
              release.status !== 'held' &&
              !(
                await client.query('SELECT $1::timestamptz>clock_timestamp() AS future', [
                  release.due_at,
                ])
              ).rows[0].future
            )
              throw new StorypaneError('invalid', 'Choose a future release time.');
            const deployed = await this.deployedMigration(client, actor.spaceId);
            const plan = await this.publicationPlan(
              client,
              actor,
              checkpoint,
              input.referenceChoices ?? [],
            );
            const existingItems = await this.releaseItems(client, release);
            if (
              new Set([
                ...existingItems.map((item) => item.locale_id),
                ...plan.checkpoints.map((item) => item.snapshot.locale.id),
              ]).size > 100
            )
              throw new StorypaneError('invalid', 'A release can contain up to 100 page locales.');
            let rootId = '';
            for (const approved of plan.checkpoints) {
              const target = approved.snapshot;
              await this.lockLocale(client, actor, target.story.id, target.locale.id);
              await reviews.assertReviewsApproved(
                client,
                actor,
                await this.snapshot(client, actor, target.story.id, target.locale.id),
                target,
              );
              const previous = (
                await client.query(
                  "SELECT * FROM publication_schedules WHERE locale_id=$1 AND status='pending'",
                  [target.locale.id],
                )
              ).rows[0];
              if (target.locale.id !== localeId && previous && previous.release_id !== release.id)
                throw new StorypaneError(
                  'invalid',
                  `${target.story.name} belongs to another release. Move it separately before including it here.`,
                );
              await this.cancelPendingSchedules(client, target.locale.id);
              const row = (
                await client.query(
                  `INSERT INTO publication_schedules
            (space_id,story_id,locale_id,checkpoint_id,schema_version,creator_id,due_at,timezone,next_attempt_at,reference_choices,release_id,approved_snapshot)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$9,$10,$11) RETURNING id`,
                  [
                    actor.spaceId,
                    target.story.id,
                    target.locale.id,
                    approved.id,
                    deployed.version,
                    actor.userId,
                    release.due_at,
                    release.timezone,
                    JSON.stringify(
                      target.locale.id === localeId ? (input.referenceChoices ?? []) : [],
                    ),
                    release.id,
                    JSON.stringify(target),
                  ],
                )
              ).rows[0];
              if (target.locale.id === localeId) rootId = row.id;
            }
            return scheduleRow(
              (
                await client.query(
                  `SELECT s.*,c.revision AS checkpoint_revision,r.name AS release_name,r.revision AS release_revision,r.status AS release_status
          FROM publication_schedules s JOIN checkpoints c ON c.id=s.checkpoint_id JOIN content_releases r ON r.id=s.release_id WHERE s.id=$1`,
                  [rootId],
                )
              ).rows[0],
            );
          },
          true,
        );
      },
      'content:publish',
      true,
    );
  }
  async cancelSchedule(
    actor: Actor,
    storyId: string,
    localeId: string,
    scheduleId: string,
    raw: unknown,
  ): Promise<PublicationSchedule> {
    const input = parseInput(cancelScheduleSchema, raw);
    parseInput(z.uuid(), scheduleId);
    return this.tx(
      actor,
      async (client) => {
        await this.lockPaths(client, actor.spaceId);
        await this.lockLocale(client, actor, storyId, localeId);
        const scheduled = (
          await client.query(
            'SELECT checkpoint_id FROM publication_schedules WHERE id=$1 AND locale_id=$2',
            [scheduleId, localeId],
          )
        ).rows[0];
        if (!scheduled) throw new StorypaneError('not_found', 'Schedule not found');
        await this.requirePublicationAccess(
          client,
          actor,
          (await this.readCheckpoint(client, localeId, scheduled.checkpoint_id)).snapshot,
        );
        return this.actionReceipt(
          client,
          actor,
          input.requestId,
          { storyId, localeId, scheduleId, ...input },
          async () => {
            const row = (
              await client.query(
                'SELECT s.*,c.revision AS checkpoint_revision,r.name AS release_name,r.revision AS release_revision,r.status AS release_status FROM publication_schedules s JOIN checkpoints c ON c.id=s.checkpoint_id JOIN content_releases r ON r.id=s.release_id WHERE s.id=$1 AND s.locale_id=$2 FOR UPDATE OF s',
                [scheduleId, localeId],
              )
            ).rows[0];
            if (!row) throw new StorypaneError('not_found', 'Schedule not found');
            if (
              !['pending', 'failed'].includes(row.status) ||
              row.revision !== input.revision ||
              (input.releaseRevision !== undefined &&
                input.releaseRevision !== row.release_revision)
            )
              throw new StorypaneError(
                'stale_revision',
                'This schedule already changed or completed.',
              );
            await client.query(
              "UPDATE publication_schedules SET status='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
              [scheduleId],
            );
            return scheduleRow({
              ...row,
              status: 'cancelled',
              revision: row.revision + 1,
              release_revision: row.release_revision + 1,
            });
          },
        );
      },
      'content:publish',
      true,
    );
  }
  async runScheduledPublications(
    limit = 25,
  ): Promise<{ spaceId: string; storyId: string; localeId: string }[]> {
    const candidates = (
      await this.pool.query(
        `SELECT r.id,r.space_id,min(s.next_attempt_at) AS next_attempt_at
      FROM content_releases r JOIN publication_schedules s ON s.release_id=r.id
      WHERE r.status='scheduled' AND s.status='pending' AND s.due_at<=clock_timestamp() AND s.next_attempt_at<=clock_timestamp()
      GROUP BY r.id ORDER BY next_attempt_at,r.id LIMIT $1`,
        [parseInput(z.number().int().min(1).max(100), limit)],
      )
    ).rows;
    const changed: { spaceId: string; storyId: string; localeId: string }[] = [];
    for (const candidate of candidates) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,91))', [
          candidate.space_id,
        ]);
        await this.lockPaths(client, candidate.space_id);
        const release = (
          await client.query(
            `SELECT * FROM content_releases r WHERE id=$1 AND status='scheduled'
          AND EXISTS(SELECT 1 FROM publication_schedules s WHERE s.release_id=r.id AND s.status='pending' AND s.due_at<=clock_timestamp() AND s.next_attempt_at<=clock_timestamp())
          FOR UPDATE SKIP LOCKED`,
            [candidate.id],
          )
        ).rows[0];
        if (!release) {
          await client.query('ROLLBACK');
          continue;
        }
        const items = (await this.releaseItems(client, release)).filter(
          (item) => item.status === 'pending',
        );
        const released: typeof changed = [];
        await client.query('SAVEPOINT release_attempt');
        try {
          const approved = new Map<string, { checkpoint: CheckpointDetail; actor: Actor }>();
          for (const item of items) {
            await this.options.authorizeIdentity?.(item.creator_id);
            const membership = (
              await client.query(
                `SELECT m.role,r.permissions FROM memberships m JOIN "user" u ON u.id=m.user_id
              JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role WHERE m.space_id=$1 AND m.user_id=$2`,
                [item.space_id, item.creator_id],
              )
            ).rows[0];
            if (!membership?.permissions.includes('content:publish'))
              throw new StorypaneError(
                'forbidden',
                'A contributor no longer has publishing permission. Review and approve their pages again.',
              );
            if (item.deleted_at)
              throw new StorypaneError('not_found', 'A page in the release was deleted.');
            const actor: Actor = {
              spaceId: item.space_id,
              userId: item.creator_id,
              sessionId: '',
              role: membership.role,
            };
            for (const choice of item.reference_choices as PublicationReferenceChoice[]) {
              if (choice.action !== 'publish') continue;
              const current = (
                await client.query(
                  'SELECT l.published_version_id,p.checkpoint_id FROM story_locales l LEFT JOIN publications p ON p.id=l.published_version_id WHERE l.id=$1',
                  [choice.localeId],
                )
              ).rows[0];
              if (
                !current ||
                (current.published_version_id !== (choice.publicationId ?? null) &&
                  current.checkpoint_id !== choice.checkpointId)
              )
                throw new StorypaneError(
                  'stale_revision',
                  'A linked page has a newer publication. Review and approve the release again.',
                );
              const member = items.find((target) => target.locale_id === choice.localeId);
              if (
                item.approved_snapshot &&
                (member
                  ? member.checkpoint_id !== choice.checkpointId
                  : current.checkpoint_id !== choice.checkpointId)
              )
                throw new StorypaneError(
                  'stale_revision',
                  'An approved linked page was changed or removed from this release. Review its references again.',
                );
            }
            const original = await this.readCheckpoint(client, item.locale_id, item.checkpoint_id);
            const checkpoints = item.approved_snapshot
              ? [
                  {
                    ...original,
                    snapshot: item.approved_snapshot,
                    content: assembleContent(item.approved_snapshot),
                  },
                ]
              : (await this.publicationPlan(client, actor, original, item.reference_choices))
                  .checkpoints;
            for (const checkpoint of checkpoints) {
              const target = checkpoint.snapshot;
              await this.lockLocale(client, actor, target.story.id, target.locale.id);
              if (
                (
                  await client.query(
                    "SELECT 1 FROM publication_schedules WHERE locale_id=$1 AND status='pending' AND release_id<>$2",
                    [target.locale.id, release.id],
                  )
                ).rowCount
              )
                throw new StorypaneError(
                  'stale_revision',
                  'A linked page belongs to another release. Review the release contents.',
                );
              const previous = approved.get(target.locale.id);
              if (
                previous &&
                canonical(previous.checkpoint.content) !== canonical(checkpoint.content)
              )
                throw new StorypaneError(
                  'stale_revision',
                  'This release contains conflicting versions of a linked page. Review the release contents.',
                );
              await this.requirePublicationAccess(client, actor, target);
              const deployed = await this.deployedMigration(client, actor.spaceId);
              if ((target.migrationVersion ?? 0) !== deployed.version)
                throw new StorypaneError(
                  'invalid',
                  'The schema changed. Update the approved pages before resuming this release.',
                );
              await this.validateSnapshot(client, actor, target, true);
              approved.set(target.locale.id, { checkpoint, actor });
            }
          }
          for (const { checkpoint, actor } of approved.values()) {
            const target = checkpoint.snapshot;
            const publicationId = await this.publishSnapshotTx(client, actor, checkpoint, true);
            await this.checkpoint(
              client,
              actor,
              target.story.id,
              target.locale.id,
              `Released: ${release.name}`,
            );
            await client.query(
              "UPDATE publication_schedules SET status='published',publication_id=$2,attempt_count=attempt_count+1,revision=revision+1,updated_at=clock_timestamp(),error=NULL WHERE release_id=$1 AND locale_id=$3 AND status='pending'",
              [release.id, publicationId, target.locale.id],
            );
            released.push({
              spaceId: actor.spaceId,
              storyId: target.story.id,
              localeId: target.locale.id,
            });
          }
          await client.query(
            "UPDATE content_releases SET status='published',error=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
            [release.id],
          );
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT release_attempt');
          released.length = 0;
          const attempts = Math.max(...items.map((item) => item.attempt_count), 0) + 1;
          const held =
            (error instanceof StorypaneError && error.code !== 'unavailable') || attempts >= 5;
          const message =
            error instanceof StorypaneError
              ? error.message
              : 'Publication infrastructure is unavailable; retrying the whole release.';
          await client.query(
            "UPDATE publication_schedules SET error=$2,attempt_count=$3,revision=revision+1,next_attempt_at=clock_timestamp()+($4::integer*interval '1 minute'),updated_at=clock_timestamp() WHERE release_id=$1 AND status='pending'",
            [release.id, message, attempts, [1, 5, 15, 60][Math.min(attempts - 1, 3)]],
          );
          await client.query(
            'UPDATE content_releases SET status=$2,error=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',
            [release.id, held ? 'held' : 'scheduled', message],
          );
        }
        await client.query('COMMIT');
        changed.push(
          ...released,
          ...items
            .filter((item) => !released.some((page) => page.localeId === item.locale_id))
            .map((item) => ({
              spaceId: item.space_id,
              storyId: item.story_id,
              localeId: item.locale_id,
            })),
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return changed;
  }

  async getPublication(
    actor: Actor,
    storyId: string,
    localeId: string,
  ): Promise<Publication | null> {
    return this.tx(actor, async (client) => {
      await this.lockLocale(client, actor, storyId, localeId);
      const result = await client.query(
        'SELECT p.* FROM publications p JOIN story_locales l ON l.published_version_id=p.id WHERE l.id=$1',
        [localeId],
      );
      if (!result.rowCount) return null;
      const r = result.rows[0];
      return {
        id: r.id,
        checkpointId: r.checkpoint_id,
        revision: Number(r.revision),
        createdAt: iso(r.created_at),
        content: projectedContent(
          projectSnapshot(await this.contentAccess(client, actor), r.snapshot),
        ),
      };
    });
  }
  async getPublished(actor: Actor, storyId: string, localeId: string): Promise<Publication | null> {
    return this.getPublication(actor, storyId, localeId);
  }
  async listDatasources(actor: Actor): Promise<Datasource[]> {
    return this.tx(
      actor,
      async (client) =>
        (
          await client.query(
            'SELECT id,name,slug,items FROM datasources WHERE space_id=$1 ORDER BY name',
            [actor.spaceId],
          )
        ).rows as Datasource[],
    );
  }
  async saveDatasource(actor: Actor, value: unknown, datasourceId?: string): Promise<Datasource> {
    const input = parseInput(datasourceInputSchema, value);
    return this.tx(
      actor,
      async (client) => {
        const result = datasourceId
          ? await client.query(
              'UPDATE datasources SET name=$3,slug=$4,items=$5 WHERE id=$1 AND space_id=$2 RETURNING id,name,slug,items',
              [datasourceId, actor.spaceId, input.name, input.slug, JSON.stringify(input.items)],
            )
          : await client.query(
              'INSERT INTO datasources(space_id,name,slug,items) VALUES($1,$2,$3,$4) RETURNING id,name,slug,items',
              [actor.spaceId, input.name, input.slug, JSON.stringify(input.items)],
            );
        if (!result.rowCount) throw new StorypaneError('not_found', 'Datasource not found');
        return result.rows[0];
      },
      'datasources:write',
    );
  }
  async resolveOptions(actor: Actor, value: unknown): Promise<OptionPage> {
    const input = parseInput(
      z
        .object({
          source: optionSourceSchema,
          context: optionRequestContextSchema.optional(),
          locale: z.string().max(100).optional(),
          query: z.string().trim().max(200).optional(),
          values: z.array(z.string().max(500)).max(200).optional(),
          cursor: z
            .string()
            .regex(/^\d{1,6}$/)
            .optional(),
        })
        .strict(),
      value,
    );
    const start = input.values ? 0 : Number(input.cursor ?? 0);
    const limit = input.values ? 200 : 50;
    const search = input.query?.toLocaleLowerCase() ?? '';
    if (input.source.type === 'external') {
      let source = input.source;
      const headers: Record<string, string> = { 'X-Storypane-Space-Id': actor.spaceId };
      const context = input.context;
      if (context) {
        const resolved = await this.tx(actor, async (client) => {
          await this.lockLocale(client, actor, context.storyId, context.localeId);
          const snapshot = await this.snapshot(client, actor, context.storyId, context.localeId);
          const block = requireBlock(snapshot, context.blockId);
          const access = projectSnapshot(await this.contentAccess(client, actor), snapshot).access;
          if (!access.blocks[block.id]?.fields[context.fieldName]?.read)
            throw new StorypaneError('forbidden', 'Your role cannot read this field');
          const definition = snapshot.definitions.find(
            (item) => item.versionId === block.schemaVersionId,
          )!;
          const field = definition.fields.find((item) => item.name === context.fieldName);
          if (
            !field ||
            !['option', 'options'].includes(field.type) ||
            !('source' in field) ||
            field.source.type !== 'external'
          )
            throw new StorypaneError('invalid', 'Choose an External JSON field');
          return {
            source: field.source,
            headers: {
              'X-Storypane-Story-Id': snapshot.story.id,
              'X-Storypane-Story-Slug': encodeURIComponent(snapshot.locale.urlSlug),
              'X-Storypane-Locale-Id': snapshot.locale.id,
              'X-Storypane-Locale': encodeURIComponent(snapshot.locale.slug),
              'X-Storypane-Block-Id': block.id,
              'X-Storypane-Block-Type': definition.name,
              'X-Storypane-Field': field.name,
            },
          };
        });
        source = resolved.source;
        Object.assign(headers, resolved.headers);
      } else await this.assertActor(actor);
      const items = await fetchExternalOptions(source.url, this.options.externalOptionHosts ?? [], {
        ...Object.fromEntries((source.headers ?? []).map(({ name, value }) => [name, value])),
        ...headers,
      });
      const filtered = items.filter((i) =>
        input.values
          ? input.values.includes(i.value)
          : i.label.toLocaleLowerCase().includes(search) ||
            i.value.toLocaleLowerCase().includes(search),
      );
      return {
        items: filtered.slice(start, start + limit),
        ...(filtered.length > start + limit ? { nextCursor: String(start + limit) } : {}),
      };
    }
    return this.tx(actor, async (client) => {
      if (input.source.type === 'stories') {
        const access = await this.contentAccess(client, actor);
        const result = await client.query(
          `SELECT s.id AS value,s.name AS label,'/' || s.slug AS description FROM stories s WHERE s.space_id=$1 AND s.deleted_at IS NULL AND ($7::uuid[] IS NULL OR s.id=ANY($7)) AND ($2='' OR s.name ILIKE '%' || $2 || '%' OR ('/' || s.slug) ILIKE '%' || $2 || '%' OR s.id::text=$2) AND ($5::text[] IS NULL OR s.id::text=ANY($5)) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM story_locales l JOIN block_drafts b ON b.id=l.root_block_id AND b.locale_id=l.id JOIN definition_versions v ON v.id=b.schema_version_id WHERE l.story_id=s.id AND v.definition_id=$3)) ORDER BY s.name,s.id LIMIT $6 OFFSET $4`,
          [
            actor.spaceId,
            search,
            input.source.contentTypeId ?? null,
            start,
            input.values ?? null,
            limit + 1,
            unrestrictedRead(access)
              ? null
              : [...new Set(access.locales.map((locale) => locale.storyId))],
          ],
        );
        const items = result.rows.slice(0, limit);
        const publications = await client.query(
          `SELECT DISTINCT ON (l.story_id) l.story_id,
            CASE WHEN l.id=ANY($3::uuid[]) THEN jsonb_build_object(
              'status',CASE WHEN p.id IS NULL THEN 'draft' WHEN ${pendingLocaleSql} THEN 'changed' ELSE 'published' END,
              'localeName',l.name,'localeSlug',l.slug) END AS publication
           FROM story_locales l LEFT JOIN checkpoints c ON c.id=l.checkpoint_id
           LEFT JOIN publications p ON p.id=l.published_version_id
           WHERE l.story_id=ANY($1::uuid[]) AND l.slug IN (coalesce($2,(SELECT slug FROM space_locales WHERE space_id=$4 AND is_default)),(SELECT slug FROM space_locales WHERE space_id=$4 AND is_default))
           ORDER BY l.story_id,(p.id IS NOT NULL) DESC,(l.slug=coalesce($2,(SELECT slug FROM space_locales WHERE space_id=$4 AND is_default))) DESC`,
          [
            items.map((item) => item.value),
            input.locale ?? null,
            access.locales.map((locale) => locale.id),
            actor.spaceId,
          ],
        );
        return {
          items: items.map((item) => {
            const publication = publications.rows.find(
              (row) => row.story_id === item.value,
            )?.publication;
            return publication ? { ...item, publication } : item;
          }),
          ...(result.rows.length > limit ? { nextCursor: String(start + limit) } : {}),
        };
      }
      let items = input.source.type === 'inline' ? input.source.items : [];
      if (input.source.type === 'datasource') {
        const source = await client.query(
          'SELECT items FROM datasources WHERE id=$1 AND space_id=$2',
          [input.source.datasourceId, actor.spaceId],
        );
        if (!source.rowCount) throw new StorypaneError('not_found', 'Datasource not found');
        items = source.rows[0].items;
      }
      const filtered = items.filter((i) =>
        input.values
          ? input.values.includes(i.value)
          : i.label.toLocaleLowerCase().includes(search) ||
            i.value.toLocaleLowerCase().includes(search),
      );
      return {
        items: filtered.slice(start, start + limit),
        ...(filtered.length > start + limit ? { nextCursor: String(start + limit) } : {}),
      };
    });
  }

  // Seed is only used by the explicit local setup script; it is never exposed by an HTTP route.
  async seed(actor: Actor): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,91))', [
        actor.spaceId,
      ]);
      await client.query('INSERT INTO spaces(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [
        actor.spaceId,
        'My space',
      ]);
      await client.query(
        "INSERT INTO space_locales(space_id,name,slug,is_default) SELECT $1,'Default','',true WHERE NOT EXISTS(SELECT 1 FROM space_locales WHERE space_id=$1)",
        [actor.spaceId],
      );
      await client.query(
        "INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT(space_id,user_id) DO NOTHING",
        [actor.spaceId, actor.userId],
      );
      const definitions: DefinitionInput[] = [
        {
          name: 'hero',
          displayName: 'Hero',
          kind: 'nestable',
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'text',
              format: 'singleline',
              required: true,
              defaultValue: 'Build something worth sharing.',
            },
            {
              name: 'description',
              label: 'Description',
              type: 'text',
              format: 'textarea',
              defaultValue: 'Your next story starts here.',
            },
            { name: 'image', label: 'Image', type: 'asset' },
          ],
        },
        {
          name: 'footer',
          displayName: 'Footer',
          kind: 'nestable',
          fields: [
            {
              name: 'text',
              label: 'Footer text',
              type: 'text',
              format: 'singleline',
              defaultValue: 'Made with Storypane.',
            },
            { name: 'link', label: 'Link', type: 'link' },
          ],
        },
        {
          name: 'page',
          displayName: 'Page',
          kind: 'content-type',
          fields: [
            {
              name: 'title',
              label: 'Page title',
              type: 'text',
              format: 'singleline',
              required: true,
              defaultValue: 'Home',
            },
            { name: 'body', label: 'Body', type: 'blocks' },
          ],
        },
      ];
      for (const definition of definitions)
        for (const field of definition.fields) field.id = randomUUID();
      const versions = new Map<string, string>();
      for (const definition of definitions) {
        const result = await client.query(
          'INSERT INTO definitions(space_id,name) VALUES($1,$2) ON CONFLICT(space_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id,current_version',
          [actor.spaceId, definition.name],
        );
        const version = await client.query(
          'INSERT INTO definition_versions(definition_id,version,schema) VALUES($1,1,$2) ON CONFLICT(definition_id,version) DO UPDATE SET definition_id=EXCLUDED.definition_id RETURNING id',
          [result.rows[0].id, JSON.stringify(definition)],
        );
        versions.set(definition.name, version.rows[0].id);
      }
      if (
        !(
          await client.query('SELECT 1 FROM schema_migrations WHERE space_id=$1 AND version>0', [
            actor.spaceId,
          ])
        ).rowCount
      ) {
        await client.query(
          "INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions,deployed_at,deployed_by,contributors) VALUES($1,1,0,'Starter schemas','deployed',$2,now(),$3,ARRAY[$3]::text[])",
          [
            actor.spaceId,
            JSON.stringify(await this.definitionHeads(client, actor.spaceId)),
            actor.userId,
          ],
        );
        await client.query('UPDATE spaces SET schema_version=1 WHERE id=$1', [actor.spaceId]);
      }
      if (
        !(await client.query('SELECT id FROM stories WHERE space_id=$1 LIMIT 1', [actor.spaceId]))
          .rowCount
      ) {
        const story = await client.query(
          "INSERT INTO stories(space_id,name,slug) VALUES($1,'Home','home') RETURNING id",
          [actor.spaceId],
        );
        const root = randomUUID();
        const locale = await client.query(
          "INSERT INTO story_locales(story_id,slug,name,url_slug,root_block_id,space_locale_id) SELECT $1,c.slug,c.name,'home',$2,c.id FROM space_locales c WHERE c.space_id=$3 AND c.is_default RETURNING id",
          [story.rows[0].id, root, actor.spaceId],
        );
        await client.query(
          'INSERT INTO block_drafts(id,locale_id,schema_version_id,fields) VALUES($1,$2,$3,$4)',
          [
            root,
            locale.rows[0].id,
            versions.get('page'),
            JSON.stringify(defaultFields(definitions[2])),
          ],
        );
        for (const [position, name] of ['hero', 'footer'].entries())
          await client.query(
            "INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields) VALUES($1,$2,$3,$4,'body',$5,$6)",
            [
              randomUUID(),
              locale.rows[0].id,
              versions.get(name),
              root,
              position,
              JSON.stringify(defaultFields(definitions.find((d) => d.name === name)!)),
            ],
          );
        await this.checkpoint(client, actor, story.rows[0].id, locale.rows[0].id, 'Starter page');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
