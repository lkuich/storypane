import { z } from 'zod';
import {
  contentScopesSchema,
  type ContentScopes,
  type EditorAccess,
} from './content-permissions.js';
export * from './content-permissions.js';
export * from './management.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Actor = {
  userId: string;
  sessionId: string;
  spaceId: string;
  role: string;
  managementTokenId?: string;
};
export const spaceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(''),
  })
  .strict();
export type Space = {
  environment?: 'prod' | 'dev';
  schemaReadOnly?: boolean;
  productionSpaceId?: string | null;
  provisioningStatus?: 'provisioning' | 'ready' | 'failed';
  provisioningMode?: 'create' | 'attach' | 'import';
  cloneSourceSpaceId?: string | null;
  id: string;
  name: string;
  description: string;
  role: Actor['role'];
  roleName: string;
  permissions: Permission[];
  contentScopes?: ContentScopes;
  createdAt: string;
  storyCount: number;
  memberCount: number;
};
export type SpaceConnection = {
  status: 'provisioning' | 'ready' | 'failed';
  url: string | null;
};
export type SpaceDetails = Space & {
  members: { id: string; name: string; email: string; role: Actor['role'] }[];
};
export type SpaceInvitation = {
  id: string;
  email: string;
  role: Actor['role'];
  createdAt: string;
  expiresAt: string;
};
export const memberRoleSchema = z.object({ role: z.string().min(1).max(80) }).strict();
export const spaceInvitationSchema = z
  .object({
    email: z.string().trim().max(254).toLowerCase().pipe(z.email()),
    role: z.string().min(1).max(80),
  })
  .strict();
export const permissions = [
  'content:read',
  'content:edit',
  'content:publish',
  'assets:write',
  'schemas:write',
  'datasources:write',
  'settings:write',
] as const;
export type Permission = (typeof permissions)[number];
export type SpaceRole = {
  id: string;
  name: string;
  permissions: Permission[];
  contentScopes: ContentScopes;
  system: boolean;
  memberCount: number;
  invitationCount: number;
};
export const roleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    permissions: z
      .array(z.enum(permissions))
      .max(permissions.length)
      .refine((items) => new Set(items).size === items.length, 'Duplicate permission'),
    contentScopes: contentScopesSchema.optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    // Legacy role clients predate explicit read permissions.
    permissions:
      value.contentScopes === undefined
        ? [...new Set<Permission>(['content:read', ...value.permissions])]
        : value.permissions,
    contentScopes: value.contentScopes ?? contentScopesSchema.parse({}),
  }));
export function can(
  space: {
    permissions: readonly Permission[];
    contentScopes?: ContentScopes;
    schemaReadOnly?: boolean;
  },
  permission: Permission,
) {
  if (permission === 'schemas:write' && space.schemaReadOnly) return false;
  if (
    space.contentScopes &&
    ['content:edit', 'content:publish', 'schemas:write', 'settings:write'].includes(permission) &&
    !space.permissions.includes('content:read')
  )
    return false;
  if (
    ['schemas:write', 'settings:write'].includes(permission) &&
    space.contentScopes &&
    Object.values(space.contentScopes.read).some((value) => value !== null)
  )
    return false;
  return space.permissions.includes(permission);
}
export type SpaceLocale = {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  storyCount: number;
};
export type SpaceLocaleDeletionReview = {
  locale: SpaceLocale;
  token: string;
  stories: {
    id: string;
    name: string;
    localeId: string;
    urlSlug: string;
    deleted: boolean;
    published: boolean;
    scheduled: boolean;
    lastLocale: boolean;
  }[];
};
export const deleteSpaceLocaleSchema = z
  .object({
    deleteContent: z.boolean().default(false),
    reviewToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const spaceLocaleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9-]*)?$/)
      .max(30),
  })
  .strict();
export type DeliveredStory = {
  migrationVersion?: number;
  id: string;
  name: string;
  slug: string;
  locale: string;
  localeId: string;
  revision: number;
  content: Json;
  publishedAt: string | null;
  references?: DeliveredStory[];
  referencesRevision?: string;
};
export type PreviewSession = {
  token: string;
  expiresAt: string;
  spaceId: string;
  storyId: string;
  localeId: string;
  slug: string;
  locale: string;
};
export type DeliveryToken = {
  id: string;
  name: string;
  scope: 'published' | 'preview';
  createdAt: string;
};
const previewUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value.replaceAll('{slug}', 'home').replaceAll('{locale}', 'en'));
      return (
        url.origin === new URL(value).origin &&
        !url.username &&
        !url.password &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }, 'Use HTTPS, or HTTP on localhost, without credentials or a fragment. Placeholders belong in the path or query.');
export const deliverySettingsSchema = z
  .object({
    previewUrls: z
      .array(
        z
          .object({ id: z.uuid(), name: z.string().trim().min(1).max(80), url: previewUrlSchema })
          .strict(),
      )
      .max(20),
    defaultPreviewId: z.uuid().nullable(),
    previewParameter: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
      .default('storypane_preview'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.previewUrls.map((item) => item.id)).size !== value.previewUrls.length)
      ctx.addIssue({
        code: 'custom',
        path: ['previewUrls'],
        message: 'Preview IDs must be unique',
      });
    if (
      new Set(value.previewUrls.map((item) => item.name.toLowerCase())).size !==
      value.previewUrls.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['previewUrls'],
        message: 'Preview names must be unique',
      });
    if (
      value.previewUrls.length
        ? !value.previewUrls.some((item) => item.id === value.defaultPreviewId)
        : value.defaultPreviewId !== null
    )
      ctx.addIssue({
        code: 'custom',
        path: ['defaultPreviewId'],
        message: 'Choose a default from the configured preview URLs',
      });
  });
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'locked'
  | 'stale_revision'
  | 'invalid'
  | 'unavailable';
export type FieldIssue = { path: string; message: string };
export class StorypaneError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: FieldIssue[],
  ) {
    super(message);
    this.name = 'StorypaneError';
  }
}
export const jsonSchema = z.custom<Json>((value) => {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { value: current, depth } = pending.pop()!;
    if (++visited > 20_000 || depth > 40) return false;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current === 'string') {
      if (current.length > 1_000_000) return false;
      continue;
    }
    if (typeof current !== 'object') return false;
    if (
      !Array.isArray(current) &&
      Object.getPrototypeOf(current) !== Object.prototype &&
      Object.getPrototypeOf(current) !== null
    )
      return false;
    const children = Object.values(current);
    if (children.length > 10_000) return false;
    pending.push(...children.map((value) => ({ value, depth: depth + 1 })));
  }
  return true;
}, 'Expected bounded JSON content');
export const optionItemSchema = z
  .object({ value: z.string().max(500), label: z.string().max(500) })
  .strict();
export type OptionItem = z.infer<typeof optionItemSchema> & {
  description?: string;
  publication?: { status: PublicationStatus; localeName: string; localeSlug: string };
};
export type OptionPage = { items: OptionItem[]; nextCursor?: string };
const externalOptionHeadersSchema = z
  .array(
    z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'Use a valid HTTP header name')
          .refine((name) => {
            const key = name.toLowerCase();
            return (
              !key.startsWith('x-storypane-') &&
              ![
                'host',
                'content-length',
                'connection',
                'transfer-encoding',
                'upgrade',
                'proxy-authorization',
                'proxy-connection',
                'te',
                'trailer',
                'keep-alive',
              ].includes(key)
            );
          }, 'This header is managed by the server'),
        value: z
          .string()
          .max(2000)
          .regex(/^[\x20-\x7E]*$/, 'Use printable ASCII without line breaks'),
      })
      .strict(),
  )
  .max(20)
  .superRefine((headers, ctx) => {
    const names = new Set<string>();
    for (const [index, header] of headers.entries()) {
      const name = header.name.toLowerCase();
      if (names.has(name))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'name'],
          message: 'Header names must be unique',
        });
      names.add(name);
    }
    if (headers.reduce((size, header) => size + header.name.length + header.value.length, 0) > 8192)
      ctx.addIssue({ code: 'custom', message: 'Request headers must fit within 8 KB' });
  });
export const optionRequestContextSchema = z
  .object({
    storyId: z.uuid(),
    localeId: z.uuid(),
    blockId: z.uuid(),
    fieldName: z.string().min(1).max(100),
  })
  .strict();
export type OptionRequestContext = z.infer<typeof optionRequestContextSchema>;
export const optionSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inline'), items: z.array(optionItemSchema).max(1000) }).strict(),
  z.object({ type: z.literal('datasource'), datasourceId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('external'),
      url: z.url().max(2000),
      headers: externalOptionHeadersSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('stories'), contentTypeId: z.uuid().optional() }).strict(),
]);
export type OptionSource = z.infer<typeof optionSourceSchema>;
const base = {
  id: z.uuid().optional(),
  name: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Use only lowercase letters, numbers and underscores, starting with a letter (e.g. hero_image).',
    )
    .max(80)
    .refine(
      (v) => !['_uid', 'component', '__proto__', 'constructor', 'prototype'].includes(v),
      'Reserved field name',
    ),
  label: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  required: z.boolean().optional(),
  defaultValue: jsonSchema.optional(),
};
const tagsSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(50)
  .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique');
export const fieldDefinitionSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('text'),
      format: z.enum(['singleline', 'textarea', 'richtext', 'markdown']).default('singleline'),
      maxLength: z.number().int().positive().max(1_000_000).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('number'),
      min: z.number().optional(),
      max: z.number().optional(),
      decimals: z.number().int().min(0).max(15).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('datetime'),
      mode: z.enum(['date', 'datetime']).default('datetime'),
    })
    .strict(),
  z.object({ ...base, type: z.literal('boolean') }).strict(),
  z.object({ ...base, type: z.literal('option'), source: optionSourceSchema }).strict(),
  z
    .object({
      ...base,
      type: z.literal('options'),
      source: optionSourceSchema,
      minItems: z.number().int().nonnegative().optional(),
      maxItems: z.number().int().positive().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('asset'),
      mimeTypes: z.array(z.string().max(100)).max(30).optional(),
    })
    .strict(),
  z.object({ ...base, type: z.literal('link') }).strict(),
  z
    .object({
      ...base,
      type: z.literal('blocks'),
      allowedDefinitionIds: z.array(z.uuid()).max(500).optional(),
      allowedTags: tagsSchema.optional(),
      minItems: z.number().int().nonnegative().optional(),
      maxItems: z.number().int().positive().max(1000).optional(),
    })
    .strict()
    .refine(
      (field) => !(field.allowedTags?.length && field.allowedDefinitionIds?.length),
      'Restrict by blocks or tags, not both',
    ),
]);
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export const definitionInputSchema = z
  .object({
    name: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'Use only lowercase letters, numbers and underscores, starting with a letter (e.g. hero_image).',
      )
      .max(80),
    displayName: z.string().min(1).max(120),
    kind: z.enum(['nestable', 'content-type', 'universal']),
    tags: tagsSchema.optional(),
    fields: z.array(fieldDefinitionSchema).max(200),
  })
  .strict()
  .superRefine((schema, ctx) => {
    const names = new Set<string>(),
      ids = new Set<string>();
    schema.fields.forEach((field, i) => {
      if (names.has(field.name))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'name'],
          message: 'Field names must be unique',
        });
      names.add(field.name);
      if (field.id && ids.has(field.id))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'id'],
          message: 'Field IDs must be unique',
        });
      if (field.id) ids.add(field.id);
      if (
        field.type === 'number' &&
        field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max
      )
        ctx.addIssue({ code: 'custom', path: ['fields', i], message: 'Minimum exceeds maximum' });
      if (
        (field.type === 'blocks' || field.type === 'options') &&
        field.minItems !== undefined &&
        field.maxItems !== undefined &&
        field.minItems > field.maxItems
      )
        ctx.addIssue({ code: 'custom', path: ['fields', i], message: 'Minimum exceeds maximum' });
    });
  });
export const definitionSaveSchema = z
  .object({
    schema: definitionInputSchema,
    baseVersion: z.number().int().nonnegative(),
    expectedVersionId: z.uuid().optional(),
    parentDefinitionId: z.uuid().nullable().optional(),
  })
  .strict();
export type DefinitionInput = z.infer<typeof definitionInputSchema>;
export type BlockDefinition = DefinitionInput & {
  id: string;
  versionId: string;
  version: number;
  createdAt: string;
  parentDefinitionId?: string | null;
};
export type DefinitionReference = {
  storyId: string;
  storyName: string;
  locales: {
    localeId: string;
    localeName: string;
    localeSlug: string;
    path: string;
    blockId: string | null;
    draft: boolean;
    published: boolean;
  }[];
};
export type DefinitionReferencesPage = {
  total: number;
  items: DefinitionReference[];
  nextCursor: string | null;
};
export const definitionParentSchema = z
  .object({
    parentDefinitionId: z.uuid().nullable(),
    expectedParentDefinitionId: z.uuid().nullable(),
  })
  .strict();
export function validateDefinitionHierarchy(
  definitions: Pick<BlockDefinition, 'id' | 'parentDefinitionId'>[],
): void {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const visited = new Set<string>();
  for (const definition of definitions) {
    const path = new Set<string>();
    let current: string | null | undefined = definition.id;
    while (current && !visited.has(current)) {
      if (path.has(current))
        throw new StorypaneError('invalid', 'Block parents cannot form a cycle');
      const ancestor = byId.get(current);
      if (!ancestor)
        throw new StorypaneError('invalid', 'Parent block must belong to this schema workspace');
      path.add(current);
      current = ancestor.parentDefinitionId;
    }
    for (const id of path) visited.add(id);
  }
}
export function isBlockAllowed(
  field: Extract<FieldDefinition, { type: 'blocks' }>,
  definition: Pick<BlockDefinition, 'id' | 'kind' | 'tags'>,
): boolean {
  return (
    definition.kind !== 'content-type' &&
    (!field.allowedDefinitionIds?.length || field.allowedDefinitionIds.includes(definition.id)) &&
    (!field.allowedTags?.length || field.allowedTags.some((tag) => definition.tags?.includes(tag)))
  );
}
export type AssetReference = { assetId: string; alt?: string };
export const assetReferenceSchema = z
  .object({ assetId: z.uuid(), alt: z.string().max(2000).optional() })
  .strict();
export const linkValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('story'), storyId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('external'),
      url: z
        .url()
        .refine((v) => /^(https?:|tel:)/i.test(v), 'Use an HTTP, HTTPS, or telephone URL'),
    })
    .strict(),
  z.object({ type: z.literal('email'), email: z.email() }).strict(),
  z.object({ type: z.literal('asset'), assetId: z.uuid() }).strict(),
]);
export type LinkValue = z.infer<typeof linkValueSchema>;
export type PageEditor = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  locales: string[];
};
export type PageEditors = Record<string, PageEditor[]>;
export type PublicationStatus = 'draft' | 'changed' | 'published';
export type StorySummary = Story & {
  /** URL path in the default locale, falling back to an accessible existing locale. */
  path?: string;
  pinned: boolean;
  publicationStatus: PublicationStatus;
  localeCount: number;
  pendingLocaleCount: number;
  pendingLocales?: Pick<StoryLocale, 'id' | 'name' | 'slug'>[];
  schedules?: PublicationSchedule[];
  modifiedBy: { id: string; name: string } | null;
  contentType: { id: string; name: string } | null;
};
export type Story = {
  id: string;
  name: string;
  slug: string;
  folderId?: string | null;
  slugSegment?: string;
  formOnly?: boolean;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type StoryLocale = {
  id: string;
  storyId: string;
  spaceLocaleId: string;
  slug: string;
  name: string;
  urlSlug: string;
  slugSegment?: string;
  rootBlockId: string;
  revision: number;
  checkpointId: string | null;
  publishedVersionId: string | null;
};
export type BlockDraft = {
  id: string;
  definitionId: string;
  schemaVersionId: string;
  parentId: string | null;
  parentField: string | null;
  position: number;
  fields: Record<string, Json>;
  revision: number;
};
export type Lease = {
  blockId: string;
  userId: string;
  sessionId: string;
  expiresAt: string;
  token?: string;
};
export type LocaleSnapshot = {
  access?: EditorAccess;
  migrationVersion?: number;
  publicationStatus?: PublicationStatus;
  story: Story;
  locale: StoryLocale;
  blocks: BlockDraft[];
  definitions: BlockDefinition[];
  leases: Lease[];
  revision: number;
  checkpointId: string | null;
};
export type Checkpoint = {
  id: string;
  revision: number;
  reason: string;
  actorId: string;
  createdAt: string;
};
export type CheckpointDetail = Checkpoint & { snapshot: LocaleSnapshot; content: Json };
export const publicationReferenceChoiceSchema = z
  .object({
    localeId: z.uuid(),
    checkpointId: z.uuid(),
    publicationId: z.uuid().nullable().optional(),
    action: z.enum(['publish', 'omit']),
  })
  .strict();
export const publicationReferenceChoicesSchema = z.array(publicationReferenceChoiceSchema).max(100);
export type PublicationReferenceChoice = z.infer<typeof publicationReferenceChoiceSchema>;
export type PublicationReference = {
  storyId: string;
  storyName: string;
  localeId: string;
  localeName: string;
  checkpointId: string;
  publicationId: string | null;
  revision: number;
  canPublish: boolean;
  usages: { localeId: string; storyName: string; field: string; canOmit: boolean }[];
};
export type PublicationReview = CheckpointDetail & {
  references: PublicationReference[];
  publishedSnapshot: LocaleSnapshot | null;
};
export type Publication = {
  id: string;
  checkpointId: string;
  revision: number;
  createdAt: string;
  content: Json;
};
export type Datasource = { id: string; name: string; slug: string; items: OptionItem[] };
export type CommitResult = {
  mutationId: string;
  localeRevision: number;
  changedBlockIds: string[];
  checkpointId: string;
  snapshot: LocaleSnapshot;
  publicationId?: string;
};

const id = z.uuid();
const mutationBase = {
  migrationVersion: z.number().int().nonnegative().optional(),
  mutationId: id,
  expectedRevisions: z.record(z.string(), z.number().int().nonnegative()).default({}),
  leaseTokens: z.record(z.string(), z.string().min(1)).default({}),
};
export const blockClipboardSchema = z
  .object({
    type: z.literal('storypane/block'),
    version: z.literal(1),
    spaceId: id,
    migrationVersion: z.number().int().nonnegative(),
    blocks: z
      .array(
        z
          .object({
            definitionId: id,
            parentIndex: z.number().int().nonnegative().nullable(),
            parentField: z
              .string()
              .regex(/^[a-z][a-z0-9_]{0,79}$/)
              .nullable(),
            position: z.number().int().nonnegative(),
            fields: z.record(z.string(), jsonSchema),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const depths: number[] = [];
    value.blocks.forEach((block, index) => {
      if (
        index === 0
          ? block.parentIndex !== null || block.parentField !== null
          : block.parentIndex === null || block.parentIndex >= index || block.parentField === null
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', index],
          message: 'Copied blocks must form one tree, with parents before children',
        });
        return;
      }
      depths[index] = block.parentIndex === null ? 0 : (depths[block.parentIndex] ?? 31) + 1;
      if (depths[index]! > 30)
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', index],
          message: 'Block nesting exceeds the supported depth',
        });
    });
  });
export type BlockClipboard = z.infer<typeof blockClipboardSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...mutationBase,
      type: z.literal('saveBlock'),
      payload: z.object({ blockId: id, fields: z.record(z.string(), jsonSchema) }).strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('insertBlock'),
      payload: z
        .object({
          parentId: id,
          parentField: z.string(),
          definitionId: id,
          position: z.number().int().nonnegative().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('moveBlock'),
      payload: z
        .object({
          blockId: id,
          parentId: id,
          parentField: z.string(),
          position: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('deleteBlock'),
      payload: z.object({ blockId: id }).strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('importBlocks'),
      payload: z
        .object({
          sourceLocaleId: id,
          blockIds: z.array(id).min(1).max(100),
          parentId: id,
          parentField: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('pasteBlock'),
      payload: z
        .object({
          clipboard: blockClipboardSchema,
          parentId: id,
          parentField: z.string(),
          position: z.number().int().nonnegative().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('restoreBlock'),
      payload: z.object({ blockId: id, checkpointId: id }).strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('restorePage'),
      payload: z.object({ checkpointId: id }).strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('publishCheckpoint'),
      payload: z
        .object({
          checkpointId: id,
          referenceChoices: publicationReferenceChoicesSchema.optional(),
          expectedScheduleId: z.uuid().nullable().optional(),
          expectedScheduleRevision: z.number().int().positive().nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      type: z.literal('unpublishLocale'),
      payload: z
        .object({ publicationId: id.nullable(), acknowledgeReferences: z.boolean().default(false) })
        .strict(),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const pathSlugSchema = z
  .string()
  .trim()
  .normalize()
  .min(1)
  .max(200)
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}][\p{L}\p{N}_-]*)*$/u,
    'Use letters, numbers, hyphens, and underscores in each path segment',
  );
export const folderSlugSchema = pathSlugSchema.refine(
  (value) => !value.includes('/'),
  'A folder slug is one path segment; use a parent folder for nesting',
);
export const folderInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: folderSlugSchema,
    parentId: id.nullable().default(null),
    localeSlugs: z.record(id, folderSlugSchema).default({}),
    allowedDefinitionIds: z.array(id).max(500).default([]),
    defaultDefinitionId: id.nullable().default(null),
    formOnly: z.boolean().default(false),
  })
  .strict();
export type ContentFolder = z.infer<typeof folderInputSchema> & { id: string };
export function folderPath(folders: ContentFolder[], id: string | null, localeId?: string): string {
  const parts: string[] = [],
    seen = new Set<string>();
  while (id) {
    if (seen.has(id) || seen.size >= 20)
      throw new StorypaneError(
        'invalid',
        'Folders cannot contain themselves and support at most 20 levels',
      );
    seen.add(id);
    const folder = folders.find((item) => item.id === id);
    if (!folder) throw new StorypaneError('not_found', 'Parent folder not found');
    parts.unshift((localeId && folder.localeSlugs[localeId]) || folder.slug);
    id = folder.parentId;
  }
  return parts.join('/');
}
export const storyLocationSchema = z
  .object({
    folderId: id.nullable(),
    slug: pathSlugSchema,
    localeSlugs: z.record(id, pathSlugSchema).default({}),
  })
  .strict();
export const storyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: pathSlugSchema,
    definitionId: id,
    folderId: id.nullable().default(null),
  })
  .strict();
export const localeInputSchema = z
  .object({ spaceLocaleId: z.uuid(), urlSlug: pathSlugSchema.optional() })
  .strict();
export const datasourceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .max(80),
    items: z.array(optionItemSchema).max(1000),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.value)).size === v.items.length,
    'Datasource values must be unique',
  );
export const LEASE_SECONDS = 45;
export const LEASE_RENEW_MS = 15_000;

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new StorypaneError(
      'invalid',
      'Invalid request',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return parsed.data;
}
export function defaultFields(schema: DefinitionInput): Record<string, Json> {
  return Object.fromEntries(
    schema.fields
      .filter((f) => f.type !== 'blocks' && f.defaultValue !== undefined)
      .map((f) => [f.name, structuredClone(f.defaultValue!)]),
  );
}

const richNodes = new Set([
  'image',
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
]);
const richMarks = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'link', 'textStyle']);
export function isRichTextColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 80 &&
    /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl|lab|lch|oklab|oklch)a?\([\d.,% /+-]+\))$/i.test(
      value,
    )
  );
}
function validRichText(value: Json, depth = 0): boolean {
  if (depth > 30 || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.type !== 'string' || !richNodes.has(value.type)) return false;
  if (value.type === 'image') {
    const attrs = value.attrs;
    if (
      !attrs ||
      typeof attrs !== 'object' ||
      Array.isArray(attrs) ||
      !z.uuid().safeParse(attrs.assetId).success ||
      typeof attrs.src !== 'string' ||
      !z.url().safeParse(attrs.src).success ||
      !/^https?:/i.test(attrs.src)
    )
      return false;
  }
  if (value.text !== undefined && typeof value.text !== 'string') return false;
  if (
    value.marks !== undefined &&
    (!Array.isArray(value.marks) ||
      !value.marks.every((mark) => {
        if (
          !mark ||
          typeof mark !== 'object' ||
          Array.isArray(mark) ||
          typeof mark.type !== 'string' ||
          !richMarks.has(mark.type)
        )
          return false;
        if (mark.type === 'textStyle') {
          const attrs = mark.attrs;
          if (
            !attrs ||
            typeof attrs !== 'object' ||
            Array.isArray(attrs) ||
            !isRichTextColor(attrs.color)
          )
            return false;
        }
        if (mark.type === 'link') {
          const attrs = mark.attrs;
          if (
            !attrs ||
            typeof attrs !== 'object' ||
            Array.isArray(attrs) ||
            typeof attrs.href !== 'string' ||
            !/^(https?:|mailto:|tel:)/i.test(attrs.href)
          )
            return false;
        }
        return true;
      }))
  )
    return false;
  return (
    value.content === undefined ||
    (Array.isArray(value.content) &&
      value.content.length <= 10000 &&
      value.content.every((child) => validRichText(child, depth + 1)))
  );
}
export function richTextAssetIds(value: Json): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const attrs = value.attrs;
  const own =
    value.type === 'image' &&
    attrs &&
    typeof attrs === 'object' &&
    !Array.isArray(attrs) &&
    typeof attrs.assetId === 'string'
      ? [attrs.assetId]
      : [];
  return [...own, ...(Array.isArray(value.content) ? value.content.flatMap(richTextAssetIds) : [])];
}
export function validateFields(
  schema: DefinitionInput,
  fields: Record<string, Json>,
  publish = false,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const known = new Map(schema.fields.map((f) => [f.name, f]));
  for (const name of Object.keys(fields))
    if (!known.has(name) || known.get(name)?.type === 'blocks')
      issues.push({
        path: name,
        message: 'Unknown field or nested content must be edited structurally',
      });
  for (const field of schema.fields) {
    if (field.type === 'blocks') continue;
    const value = fields[field.name];
    const fail = (message: string) => issues.push({ path: field.name, message });
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (publish && field.required) fail('Required');
      else if (publish && field.type === 'options' && field.minItems)
        fail(`Choose at least ${field.minItems}`);
      continue;
    }
    switch (field.type) {
      case 'text':
        if (field.format === 'richtext') {
          if (
            !validRichText(value) ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            value.type !== 'doc'
          )
            fail('Expected a rich text document');
          else {
            const text = (node: Json): string =>
              node && typeof node === 'object' && !Array.isArray(node)
                ? (typeof node.text === 'string' ? node.text : '') +
                  (Array.isArray(node.content) ? node.content.map(text).join('') : '')
                : '';
            const content = text(value);
            if (publish && field.required && !content.trim()) fail('Required');
            if (field.maxLength && content.length > field.maxLength)
              fail(`Maximum ${field.maxLength} characters`);
          }
        } else if (typeof value !== 'string') fail('Expected text');
        else if (field.maxLength && value.length > field.maxLength)
          fail(`Maximum ${field.maxLength} characters`);
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('Expected a finite number');
        else {
          if (field.min !== undefined && value < field.min) fail(`Minimum ${field.min}`);
          if (field.max !== undefined && value > field.max) fail(`Maximum ${field.max}`);
          if (
            field.decimals !== undefined &&
            Math.abs(value * 10 ** field.decimals - Math.round(value * 10 ** field.decimals)) > 1e-7
          )
            fail(`Maximum ${field.decimals} decimals`);
        }
        break;
      case 'datetime': {
        const pattern =
          field.mode === 'date'
            ? /^\d{4}-\d{2}-\d{2}$/
            : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
        if (
          typeof value !== 'string' ||
          !pattern.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)
        )
          fail(field.mode === 'date' ? 'Expected YYYY-MM-DD date' : 'Expected a UTC ISO timestamp');
        break;
      }
      case 'boolean':
        if (typeof value !== 'boolean') fail('Expected true or false');
        break;
      case 'option':
        if (typeof value !== 'string') fail('Expected one option value');
        else if (
          field.source.type === 'inline' &&
          !field.source.items.some((item) => item.value === value)
        )
          fail('Choose an available option');
        break;
      case 'options':
        if (
          !Array.isArray(value) ||
          !value.every((v) => typeof v === 'string') ||
          new Set(value).size !== value.length
        )
          fail('Expected distinct option values');
        else {
          if (publish && field.minItems !== undefined && value.length < field.minItems)
            fail(`Choose at least ${field.minItems}`);
          if (field.maxItems !== undefined && value.length > field.maxItems)
            fail(`Choose at most ${field.maxItems}`);
        }
        if (
          Array.isArray(value) &&
          value.every((item) => typeof item === 'string') &&
          new Set(value).size === value.length &&
          field.source.type === 'inline'
        ) {
          const items = field.source.items;
          if (value.some((item) => !items.some((option) => option.value === item)))
            fail('Choose available options');
        }
        break;
      case 'asset':
        if (!assetReferenceSchema.safeParse(value).success) fail('Expected an asset reference');
        break;
      case 'link':
        if (!linkValueSchema.safeParse(value).success) fail('Expected a valid link');
        break;
    }
  }
  return issues;
}

export * from './migrations.js';
export * from './environments.js';
export * from './block-clipboard.js';
export * from './webhooks.js';

export * from './scheduling-time.js';

export const lifecycleReviewLocaleSchema = z
  .object({
    id: z.uuid(),
    checkpointId: z.uuid().nullable(),
    publicationId: z.uuid().nullable(),
    referenceChoices: publicationReferenceChoicesSchema.optional(),
  })
  .strict();
export type LifecycleReview = {
  story: Story;
  locales: (z.infer<typeof lifecycleReviewLocaleSchema> & {
    name: string;
    slug: string;
    urlSlug: string;
    revision: number;
    spaceLocaleId: string;
    slugSegment: string;
    publishedUrlSlug: string | null;
  })[];
  incomingReferences: {
    storyId: string;
    storyName: string;
    localeId: string;
    published: boolean;
  }[];
};
export const storyActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('delete'),
      requestId: z.uuid(),
      locales: z.array(lifecycleReviewLocaleSchema).min(1).max(100),
    })
    .strict(),
  z.object({ action: z.literal('restore'), requestId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('duplicate'),
      requestId: z.uuid(),
      folderId: z.uuid().nullable(),
      slug: pathSlugSchema.optional(),
      name: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({ action: z.literal('move'), requestId: z.uuid(), location: storyLocationSchema })
    .strict(),
  z
    .object({
      action: z.enum(['publish', 'unpublish']),
      requestId: z.uuid(),
      locales: z.array(lifecycleReviewLocaleSchema).min(1).max(100),
      acknowledgeReferences: z.boolean().default(false),
    })
    .strict(),
]);
export type StoryAction = z.infer<typeof storyActionSchema>;
export type StoryActionResult = { story: Story; localeIds: string[] };
export const bulkStoryActionSchema = z
  .object({
    items: z
      .array(z.object({ storyId: z.uuid(), input: storyActionSchema }).strict())
      .min(1)
      .max(50),
  })
  .strict();
export type BulkStoryActionResult = {
  storyId: string;
  result?: StoryActionResult;
  error?: { code: ErrorCode; message: string };
};
export type PublicationSchedule = {
  active: boolean;
  id: string;
  releaseId: string;
  releaseName: string;
  releaseRevision: number;
  releaseStatus: import('./releases.js').ContentRelease['status'];
  storyId: string;
  localeId: string;
  checkpointId: string;
  checkpointRevision: number;
  creatorId: string;
  dueAt: string;
  timezone: string;
  status: 'pending' | 'published' | 'cancelled' | 'failed';
  revision: number;
  attemptCount: number;
  publicationId: string | null;
  error: string | null;
};
export const scheduleInputSchema = z
  .object({
    requestId: z.uuid(),
    checkpointId: z.uuid(),
    dueAt: z.iso.datetime(),
    referenceChoices: publicationReferenceChoicesSchema.optional(),
    timezone: z.string().min(1).max(100),
    localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    expectedScheduleId: z.uuid().nullable(),
    expectedRevision: z.number().int().positive().nullable(),
    expectedReleaseRevision: z.number().int().positive().optional(),
    release: z.object({ id: z.uuid(), revision: z.number().int().positive() }).strict().optional(),
    releaseName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const cancelScheduleSchema = z
  .object({
    requestId: z.uuid(),
    revision: z.number().int().positive(),
    releaseRevision: z.number().int().positive().optional(),
  })
  .strict();
export * from './media.js';
export * from './releases.js';
export * from './seo.js';
