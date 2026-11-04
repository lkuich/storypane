import {
  StorypaneError,
  isBlockAllowed,
  validateFields,
  type BlockDefinition,
  type DefinitionInput,
  type FieldDefinition,
  type LocaleSnapshot,
} from './index.js';

export type SchemaMigration = {
  id: string;
  spaceId: string;
  version: number;
  baseVersion: number;
  name: string;
  status: 'active' | 'deployed';
  revision: number;
  definitions: BlockDefinition[];
  contributors: string[];
  createdAt: string;
  deployedAt: string | null;
  deployedBy: string | null;
  destructive?: boolean;
};
export type MigrationFile = {
  formatVersion: 1;
  id: string;
  spaceId: string;
  version: number;
  baseVersion: number;
  name: string;
  definitions: { id: string; schema: DefinitionInput }[];
  remoteRevision: number | null;
  sourceHash: string | null;
  status: 'active' | 'deployed';
};
export type MigrationChange = {
  definition: string;
  field?: string;
  kind: 'added' | 'removed' | 'renamed' | 'reset' | 'changed';
  before?: unknown;
  after?: unknown;
};
export type MigrationImpact = {
  storyId: string;
  localeId: string;
  name: string;
  locale: string;
  localeSlug: string;
  target: 'draft' | 'published';
  deletedValues: number;
  resetValues: number;
  deletedBlocks: number;
};
export type MigrationBlocker = {
  path: string;
  message: string;
  storyId?: string;
  storyName?: string;
  localeSlug?: string;
  localeName?: string;
  target?: 'draft' | 'published';
  blockId?: string;
  blockName?: string;
  field?: string;
};
export type MigrationReview = {
  migration: SchemaMigration;
  token: string;
  destructive: boolean;
  confirmation: string | null;
  changes: MigrationChange[];
  impacts: MigrationImpact[];
  blockers: MigrationBlocker[];
};
export type ManagementToken = {
  id: string;
  name: string;
  capability: 'read' | 'stage' | 'deploy';
  createdAt: string;
};

export function definitionInput(definition: BlockDefinition): DefinitionInput {
  const {
    id: _id,
    versionId: _versionId,
    version: _version,
    createdAt: _createdAt,
    ...input
  } = definition;
  return input;
}
export function compatibleFields(before: FieldDefinition, after: FieldDefinition): boolean {
  return (
    before.type === after.type &&
    !(
      before.type === 'text' &&
      after.type === 'text' &&
      (before.format === 'richtext') !== (after.format === 'richtext')
    ) &&
    !(before.type === 'datetime' && after.type === 'datetime' && before.mode !== after.mode)
  );
}
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
export function migrationChanges(
  before: BlockDefinition[],
  after: BlockDefinition[],
): MigrationChange[] {
  const changes: MigrationChange[] = [];
  for (const target of after) {
    const source = before.find((item) => item.id === target.id);
    if (!source) {
      changes.push({ definition: target.name, kind: 'added', after: definitionInput(target) });
      continue;
    }
    for (const old of source.fields) {
      const field = target.fields.find((item) => item.id === old.id);
      if (!field)
        changes.push({ definition: target.name, field: old.name, kind: 'removed', before: old });
      else if (canonicalJson(old) !== canonicalJson(field))
        changes.push({
          definition: target.name,
          field: old.name,
          kind: !compatibleFields(old, field)
            ? 'reset'
            : old.name !== field.name
              ? 'renamed'
              : 'changed',
          before: old,
          after: field,
        });
    }
    for (const field of target.fields)
      if (!source.fields.some((old) => old.id === field.id))
        changes.push({ definition: target.name, field: field.name, kind: 'added', after: field });
    const { fields: _oldFields, ...oldConfig } = definitionInput(source),
      { fields: _fields, ...config } = definitionInput(target);
    // Added and removed fields have their own entries; compare only the order of retained fields.
    const oldOrder = source.fields.filter((field) =>
      target.fields.some((next) => next.id === field.id),
    );
    const newOrder = target.fields.filter((field) =>
      source.fields.some((old) => old.id === field.id),
    );
    const reordered = oldOrder.some((field, index) => field.id !== newOrder[index]?.id);
    if (canonicalJson(oldConfig) !== canonicalJson(config) || reordered)
      changes.push({
        definition: target.name,
        kind: 'changed',
        before: reordered
          ? { ...oldConfig, fieldOrder: source.fields.map((field) => field.name) }
          : oldConfig,
        after: reordered
          ? { ...config, fieldOrder: target.fields.map((field) => field.name) }
          : config,
      });
  }
  return changes;
}

/** Work from original names, so swaps and nested-field renames never overwrite values. */
export function migrateSnapshot(
  source: LocaleSnapshot,
  definitions: BlockDefinition[],
  migrationVersion: number,
  destructive = false,
) {
  const snapshot = structuredClone(source);
  let deletedValues = 0,
    resetValues = 0;
  const valueLosses = new Map<string, { deleted: number; reset: number }>();
  const removed = new Set<string>(),
    original = new Map(source.blocks.map((block) => [block.id, block]));
  function remove(id: string) {
    if (removed.has(id)) return;
    removed.add(id);
    for (const child of source.blocks) if (child.parentId === id) remove(child.id);
  }
  for (const block of source.blocks) {
    const old = source.definitions.find(
        (definition) => definition.versionId === block.schemaVersionId,
      ),
      target = definitions.find((definition) => definition.id === block.definitionId);
    for (const field of old?.fields ?? [])
      if (field.type === 'blocks') {
        const next = target?.fields.find((item) => item.id === field.id);
        if (!next || !compatibleFields(field, next))
          for (const child of source.blocks)
            if (child.parentId === block.id && child.parentField === field.name) remove(child.id);
      }
  }
  for (const block of snapshot.blocks) {
    if (removed.has(block.id)) continue;
    const old = source.definitions.find(
      (definition) => definition.versionId === block.schemaVersionId,
    );
    const target = definitions.find((definition) => definition.id === block.definitionId);
    if (!old || !target)
      throw new StorypaneError('invalid', 'Migration is missing a block definition');
    const previousDeleted = deletedValues,
      previousReset = resetValues;
    const fields: typeof block.fields = {};
    for (const field of old.fields) {
      const next = target.fields.find((item) => item.id === field.id);
      if (!next || !compatibleFields(field, next)) {
        if (field.type === 'blocks') {
          for (const child of source.blocks)
            if (child.parentId === block.id && child.parentField === field.name) remove(child.id);
        } else if (Object.hasOwn(block.fields, field.name)) {
          if (next) resetValues++;
          else deletedValues++;
        }
      }
    }
    for (const field of target.fields) {
      const previous = old.fields.find((item) => item.id === field.id);
      if (previous && compatibleFields(previous, field)) {
        if (field.type === 'blocks') {
          for (const child of snapshot.blocks)
            if (
              original.get(child.id)?.parentId === block.id &&
              original.get(child.id)?.parentField === previous.name
            )
              child.parentField = field.name;
        } else if (Object.hasOwn(block.fields, previous.name))
          fields[field.name] = block.fields[previous.name]!;
      } else if (field.type !== 'blocks' && field.defaultValue !== undefined)
        fields[field.name] = structuredClone(field.defaultValue);
    }
    block.fields = fields;
    block.schemaVersionId = target.versionId;
    valueLosses.set(block.id, {
      deleted: deletedValues - previousDeleted,
      reset: resetValues - previousReset,
    });
    block.revision++;
  }
  snapshot.blocks = snapshot.blocks.filter((block) => !removed.has(block.id));
  if (destructive) {
    // Keep the earliest allowed siblings; removing a parent always removes its entire subtree.
    for (const block of snapshot.blocks) {
      const definition = definitions.find((item) => item.id === block.definitionId)!;
      for (const field of definition.fields)
        if (field.type === 'blocks') {
          let kept = 0;
          const children = snapshot.blocks
            .filter((child) => child.parentId === block.id && child.parentField === field.name)
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
          for (const child of children) {
            if (
              !isBlockAllowed(
                field,
                definitions.find((item) => item.id === child.definitionId)!,
              ) ||
              (field.maxItems !== undefined && kept >= field.maxItems)
            )
              remove(child.id);
            else kept++;
          }
        }
    }
    snapshot.blocks = snapshot.blocks.filter((block) => !removed.has(block.id));
    for (const id of removed) {
      const loss = valueLosses.get(id);
      if (loss) {
        deletedValues -= loss.deleted;
        resetValues -= loss.reset;
      }
    }
    for (const block of snapshot.blocks) {
      const definition = definitions.find((item) => item.id === block.definitionId)!;
      for (const name of new Set(
        validateFields(definition, block.fields).map((issue) => issue.path),
      )) {
        const field = definition.fields.find((item) => item.name === name);
        delete block.fields[name];
        if (field?.defaultValue !== undefined)
          block.fields[name] = structuredClone(field.defaultValue);
        resetValues++;
      }
    }
  }
  snapshot.definitions = definitions.filter((definition) =>
    snapshot.blocks.some((block) => block.definitionId === definition.id),
  );
  snapshot.leases = [];
  snapshot.migrationVersion = migrationVersion;
  return { snapshot, deletedValues, resetValues, deletedBlocks: removed.size };
}
