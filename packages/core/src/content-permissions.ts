import { z } from 'zod';
import type {
  BlockDraft,
  ContentFolder,
  FieldDefinition,
  LocaleSnapshot,
  Permission,
} from './index.js';

const ids = z.array(z.uuid()).max(1000);
export const contentScopeSchema = z
  .object({
    locations: z
      .object({ folderIds: z.array(z.uuid().nullable()).max(1000), storyIds: ids })
      .strict()
      .nullable()
      .default(null),
    localeIds: ids.nullable().default(null),
    definitionIds: ids.nullable().default(null),
    fieldIds: ids.nullable().default(null),
  })
  .strict();
export const contentScopesSchema = z
  .object({
    read: contentScopeSchema.default(() => ({
      locations: null,
      localeIds: null,
      definitionIds: null,
      fieldIds: null,
    })),
    edit: contentScopeSchema.default(() => ({
      locations: null,
      localeIds: null,
      definitionIds: null,
      fieldIds: null,
    })),
    publish: contentScopeSchema.default(() => ({
      locations: null,
      localeIds: null,
      definitionIds: null,
      fieldIds: null,
    })),
  })
  .strict();
export type ContentScope = z.infer<typeof contentScopeSchema>;
export type ContentScopes = z.infer<typeof contentScopesSchema>;
export type ContentPermission = 'content:read' | 'content:edit' | 'content:publish';
export type ContentAccess = {
  admin: boolean;
  permissions: readonly Permission[];
  scopes: ContentScopes;
  folders: Pick<ContentFolder, 'id' | 'parentId'>[];
};
export type ContentTarget = { storyId: string; folderId: string | null; spaceLocaleId?: string };
export type FieldAccess = { read: boolean; edit: boolean };
export type BlockAccess = {
  read: boolean;
  edit: boolean;
  complete: boolean;
  fields: Record<string, FieldAccess>;
};
export type EditorAccess = {
  complete: boolean;
  edit: boolean;
  publish: boolean;
  preview: boolean;
  blocks: Record<string, BlockAccess>;
};
export type EditorSnapshot = LocaleSnapshot & { access: EditorAccess };

export function unrestrictedScope(scope: ContentScope): boolean {
  return Object.values(scope).every((value) => value === null);
}
export function unrestrictedRead(access: ContentAccess): boolean {
  return (
    access.admin ||
    (access.permissions.includes('content:read') && unrestrictedScope(access.scopes.read))
  );
}
function matchesLocation(
  access: ContentAccess,
  target: ContentTarget,
  scope: ContentScope,
): boolean {
  if (scope.localeIds && (!target.spaceLocaleId || !scope.localeIds.includes(target.spaceLocaleId)))
    return false;
  if (scope.definitionIds?.length === 0 || scope.fieldIds?.length === 0) return false;
  if (!scope.locations) return true;
  if (scope.locations.storyIds.includes(target.storyId)) return true;
  const seen = new Set<string>();
  let folder = target.folderId;
  while (folder !== null) {
    if (seen.has(folder)) return false;
    seen.add(folder);
    const record = access.folders.find((item) => item.id === folder);
    if (!record) return false;
    if (scope.locations.folderIds.includes(folder)) return true;
    folder = record.parentId;
  }
  return scope.locations.folderIds.includes(null);
}
export function locationAllowed(
  access: ContentAccess,
  target: ContentTarget,
  permission: ContentPermission,
): boolean {
  if (access.admin) return true;
  if (
    !access.permissions.includes('content:read') ||
    !matchesLocation(access, target, access.scopes.read)
  )
    return false;
  return (
    access.permissions.includes(permission) &&
    matchesLocation(access, target, access.scopes[permission.slice(8) as keyof ContentScopes])
  );
}
export function snapshotTarget(snapshot: LocaleSnapshot): ContentTarget {
  return {
    storyId: snapshot.story.id,
    folderId: snapshot.story.folderId ?? null,
    spaceLocaleId: snapshot.locale.spaceLocaleId,
  };
}
export function fieldAllowed(
  access: ContentAccess,
  snapshot: LocaleSnapshot,
  block: BlockDraft,
  field: FieldDefinition | undefined,
  permission: ContentPermission,
): boolean {
  if (access.admin) return true;
  if (!locationAllowed(access, snapshotTarget(snapshot), permission)) return false;
  const matches = (scope: ContentScope) =>
    (!scope.definitionIds || scope.definitionIds.includes(block.definitionId)) &&
    (!scope.fieldIds || (!!field?.id && scope.fieldIds.includes(field.id)));
  return (
    matches(access.scopes.read) &&
    matches(access.scopes[permission.slice(8) as keyof ContentScopes])
  );
}
export function blockAllowed(
  access: ContentAccess,
  snapshot: LocaleSnapshot,
  block: BlockDraft,
  permission: ContentPermission,
  complete = true,
): boolean {
  const definition = snapshot.definitions.find((item) => item.versionId === block.schemaVersionId);
  if (!definition) return false;
  const fields = definition.fields;
  if (!fields.length) return fieldAllowed(access, snapshot, block, undefined, permission);
  return complete
    ? fields.every((field) => fieldAllowed(access, snapshot, block, field, permission))
    : fields.some((field) => fieldAllowed(access, snapshot, block, field, permission));
}
export function snapshotAllowed(
  access: ContentAccess,
  snapshot: LocaleSnapshot,
  permission: ContentPermission,
): boolean {
  return (
    locationAllowed(access, snapshotTarget(snapshot), permission) &&
    snapshot.blocks.every((block) => blockAllowed(access, snapshot, block, permission))
  );
}
