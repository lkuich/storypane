import type { PoolClient } from 'pg';
import {
  StorypaneError,
  contentScopesSchema,
  fieldAllowed,
  blockAllowed,
  locationAllowed,
  snapshotAllowed,
  snapshotTarget,
  unrestrictedRead,
  type Actor,
  type ContentAccess,
  type ContentPermission,
  type ContentTarget,
  type EditorSnapshot,
  type Json,
  type LocaleSnapshot,
} from '@storypane/core';

export type StoreContentAccess = ContentAccess & {
  locales: {
    id: string;
    storyId: string;
    folderId: string | null;
    spaceLocaleId: string;
    name: string;
    slug: string;
    urlSlug: string;
  }[];
};

export async function loadContentAccess(
  client: PoolClient,
  actor: Pick<Actor, 'spaceId' | 'userId'>,
  includeDeleted = false,
): Promise<StoreContentAccess> {
  const role = (
    await client.query(
      'SELECT m.role,r.permissions,r.content_scopes FROM memberships m JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role WHERE m.space_id=$1 AND m.user_id=$2',
      [actor.spaceId, actor.userId],
    )
  ).rows[0];
  if (!role) throw new StorypaneError('forbidden', 'You do not have access to this space');
  const access: StoreContentAccess = {
    admin: role.role === 'admin',
    permissions: role.permissions,
    scopes: contentScopesSchema.parse(role.content_scopes),
    folders: (
      await client.query(
        'SELECT id,parent_id AS "parentId" FROM content_folders WHERE space_id=$1',
        [actor.spaceId],
      )
    ).rows,
    locales: [],
  };
  const scope = access.scopes.read;
  const locales = (
    await client.query(
      `SELECT l.id,l.story_id AS "storyId",s.folder_id AS "folderId",l.space_locale_id AS "spaceLocaleId",l.name,l.slug,l.url_slug AS "urlSlug"
    FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 AND ($5 OR s.deleted_at IS NULL) AND ($4 OR ($2::uuid[] IS NULL AND $3::text[] IS NULL) OR EXISTS(
      SELECT 1 FROM block_drafts b JOIN definition_versions v ON v.id=b.schema_version_id WHERE b.locale_id=l.id
      AND ($2::uuid[] IS NULL OR v.definition_id=ANY($2))
      AND ($3::text[] IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.schema->'fields') f WHERE f->>'id'=ANY($3)))))`,
      [actor.spaceId, scope.definitionIds, scope.fieldIds, access.admin, includeDeleted],
    )
  ).rows;
  access.locales = locales.filter((locale) => locationAllowed(access, locale, 'content:read'));
  return access;
}

export function assertLocationAccess(
  access: ContentAccess,
  target: ContentTarget,
  permission: ContentPermission,
) {
  if (!locationAllowed(access, target, permission))
    throw new StorypaneError(
      permission === 'content:read' ? 'not_found' : 'forbidden',
      permission === 'content:read'
        ? 'Content not found'
        : 'Your role does not allow this content action',
    );
}
export function assertSnapshotAccess(
  access: ContentAccess,
  snapshot: LocaleSnapshot,
  permission: ContentPermission,
) {
  if (!snapshotAllowed(access, snapshot, permission))
    throw new StorypaneError(
      'forbidden',
      'Your role does not allow this action on all affected content',
    );
}
export function assertUnrestrictedRead(access: ContentAccess) {
  if (!unrestrictedRead(access))
    throw new StorypaneError('forbidden', 'This action requires unrestricted content read access');
}

export function projectSnapshot(
  access: StoreContentAccess,
  source: LocaleSnapshot,
): EditorSnapshot {
  const current = access.locales.find((locale) => locale.id === source.locale.id);
  if (current) source = { ...source, story: { ...source.story, folderId: current.folderId } };
  assertLocationAccess(access, snapshotTarget(source), 'content:read');
  const snapshot = structuredClone(source) as EditorSnapshot;
  const complete = snapshotAllowed(access, source, 'content:read');
  snapshot.access = {
    complete,
    edit: snapshotAllowed(access, source, 'content:edit'),
    publish: snapshotAllowed(access, source, 'content:publish'),
    preview: complete,
    blocks: {},
  };
  const visibleStories = new Set(access.locales.map((locale) => locale.storyId));
  for (const block of snapshot.blocks) {
    const definition = source.definitions.find((item) => item.versionId === block.schemaVersionId)!;
    const readable = blockAllowed(access, source, block, 'content:read', false);
    const blockAccess = {
      read: readable,
      edit: blockAllowed(access, source, block, 'content:edit', false),
      complete: blockAllowed(access, source, block, 'content:read'),
      fields: {} as Record<string, { read: boolean; edit: boolean }>,
    };
    for (const field of definition.fields) {
      let read = fieldAllowed(access, source, block, field, 'content:read');
      const value = block.fields[field.name];
      const referenceIds =
        field.type === 'link' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        value.type === 'story'
          ? [value.storyId]
          : (field.type === 'option' || field.type === 'options') && field.source.type === 'stories'
            ? Array.isArray(value)
              ? value
              : value
                ? [value]
                : []
            : [];
      if (
        !unrestrictedRead(access) &&
        referenceIds.some((id) => typeof id === 'string' && !visibleStories.has(id))
      )
        read = false;
      blockAccess.fields[field.name] = {
        read,
        edit: read && fieldAllowed(access, source, block, field, 'content:edit'),
      };
      if (!read) {
        delete block.fields[field.name];
        snapshot.access.complete = false;
        snapshot.access.preview = false;
        blockAccess.complete = false;
      }
    }
    if (definition.fields.length) {
      blockAccess.edit = Object.values(blockAccess.fields).some((field) => field.edit);
      blockAccess.read = Object.values(blockAccess.fields).some((field) => field.read);
    }
    if (!blockAccess.read) block.fields = {};
    snapshot.access.blocks[block.id] = blockAccess;
  }
  snapshot.definitions = snapshot.definitions.map((definition) => {
    const block = snapshot.blocks.find((item) => item.schemaVersionId === definition.versionId)!;
    const readable = blockAllowed(access, source, block, 'content:read', false);
    return {
      ...definition,
      name: readable ? definition.name : 'restricted',
      displayName: readable ? definition.displayName : 'Restricted block',
      fields: definition.fields.map((field) => {
        const { defaultValue: _defaultValue, ...safe } = field;
        return fieldAllowed(access, source, block, field, 'content:read')
          ? unrestrictedRead(access)
            ? field
            : safe
          : {
              id: field.id,
              name: field.name,
              label: 'Restricted field',
              type: 'text' as const,
              format: 'singleline' as const,
            };
      }),
    };
  });
  snapshot.access.edit &&= snapshot.access.complete;
  snapshot.access.publish &&= snapshot.access.complete;
  snapshot.leases = snapshot.leases.filter((lease) => snapshot.access.blocks[lease.blockId]?.read);
  return snapshot;
}

export function projectedContent(snapshot: LocaleSnapshot): Json {
  const walk = (id: string): Json => {
    const block = snapshot.blocks.find((item) => item.id === id);
    if (!block || snapshot.access?.blocks[id]?.read === false)
      return { _uid: id, component: 'restricted' };
    const definition = snapshot.definitions.find(
      (item) => item.versionId === block.schemaVersionId,
    )!;
    const result: Record<string, Json> = { _uid: id, component: definition.name, ...block.fields };
    for (const field of definition.fields)
      if (field.type === 'blocks')
        result[field.name] = snapshot.blocks
          .filter((item) => item.parentId === id && item.parentField === field.name)
          .sort((a, b) => a.position - b.position)
          .map((item) => walk(item.id));
    return result;
  };
  return walk(snapshot.locale.rootBlockId);
}

export function hasContentResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasContentResult);
  return (
    isSnapshot(value) ||
    ('snapshot' in value &&
      !!value.snapshot &&
      typeof value.snapshot === 'object' &&
      isSnapshot(value.snapshot))
  );
}

function isSnapshot(value: object): value is LocaleSnapshot {
  return (
    'blocks' in value &&
    Array.isArray(value.blocks) &&
    'story' in value &&
    'locale' in value &&
    'definitions' in value &&
    Array.isArray(value.definitions) &&
    'leases' in value &&
    'revision' in value &&
    'checkpointId' in value
  );
}
export function projectResult<T>(access: StoreContentAccess, value: T): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => projectResult(access, item)) as T;
  if (isSnapshot(value)) return projectSnapshot(access, value) as T;
  if (
    'snapshot' in value &&
    value.snapshot &&
    typeof value.snapshot === 'object' &&
    'blocks' in value.snapshot
  ) {
    const snapshot = projectSnapshot(access, value.snapshot as LocaleSnapshot);
    return {
      ...value,
      snapshot,
      ...('actorId' in value && !snapshot.access.complete ? { actorId: '' } : {}),
      ...('content' in value ? { content: projectedContent(snapshot) } : {}),
      ...('changedBlockIds' in value && Array.isArray(value.changedBlockIds)
        ? {
            changedBlockIds: value.changedBlockIds.filter((id) => snapshot.access.blocks[id]?.read),
          }
        : {}),
    };
  }
  return value;
}

export function assertContentChanges(
  access: ContentAccess,
  before: LocaleSnapshot,
  after: LocaleSnapshot,
) {
  assertLocationAccess(access, snapshotTarget(after), 'content:edit');
  for (const id of new Set([...before.blocks.map((b) => b.id), ...after.blocks.map((b) => b.id)])) {
    const previous = before.blocks.find((b) => b.id === id),
      next = after.blocks.find((b) => b.id === id);
    if (
      !previous ||
      !next ||
      previous.parentId !== next.parentId ||
      previous.parentField !== next.parentField ||
      previous.position !== next.position ||
      previous.schemaVersionId !== next.schemaVersionId
    ) {
      for (const [state, block] of [
        [before, previous],
        [after, next],
      ] as const)
        if (block) {
          const pending = [block],
            seen = new Set<string>();
          while (pending.length) {
            const child = pending.pop()!;
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            if (!blockAllowed(access, state, child, 'content:edit'))
              throw new StorypaneError('forbidden', 'Your role cannot change this block subtree');
            pending.push(...state.blocks.filter((item) => item.parentId === child.id));
          }
          if (!blockAllowed(access, state, block, 'content:edit'))
            throw new StorypaneError('forbidden', 'Your role cannot change this block structure');
          if (block.parentId) {
            const parent = state.blocks.find((item) => item.id === block.parentId)!;
            const field = state.definitions
              .find((item) => item.versionId === parent.schemaVersionId)
              ?.fields.find((item) => item.name === block.parentField);
            if (!fieldAllowed(access, state, parent, field, 'content:edit'))
              throw new StorypaneError('forbidden', 'Your role cannot change this block list');
          }
        }
    }
    if (previous && next)
      for (const name of new Set([...Object.keys(previous.fields), ...Object.keys(next.fields)])) {
        if (JSON.stringify(previous.fields[name]) === JSON.stringify(next.fields[name])) continue;
        const field = after.definitions
          .find((item) => item.versionId === next.schemaVersionId)
          ?.fields.find((item) => item.name === name);
        if (!fieldAllowed(access, after, next, field, 'content:edit'))
          throw new StorypaneError('forbidden', 'Your role cannot change this field');
      }
  }
}
