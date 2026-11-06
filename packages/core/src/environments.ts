import { z } from 'zod';
import {
  canonicalJson,
  definitionInput,
  definitionInputSchema,
  validateDefinitionHierarchy,
  type BlockDefinition,
  type DefinitionInput,
  type MigrationChange,
  type MigrationImpact,
  type MigrationBlocker,
} from './index.js';

export const portableDefinitionSchema = z
  .object({
    id: z.uuid(),
    parentDefinitionId: z.uuid().nullable(),
    schema: z.lazy(() => definitionInputSchema),
  })
  .strict();
export type PortableDefinition = z.infer<typeof portableDefinitionSchema>;
export type SchemaStep = {
  id: string;
  name: string;
  definitions: PortableDefinition[];
  destructive?: boolean;
};
export const schemaResolutionsSchema = z.record(z.string().max(500), z.enum(['dev', 'prod']));
export type SchemaResolutions = z.infer<typeof schemaResolutionsSchema>;
export type SchemaConflict = { path: string; base: unknown; dev: unknown; prod: unknown };
export type SchemaStatus = {
  environment: 'prod' | 'dev';
  schemaReadOnly: boolean;
  production: { id: string; name: string; head: string; version: number } | null;
  baseline: string | null;
  behind: boolean;
  pending: { id: string; name: string }[];
};
export type SchemaTransferReview = {
  id: string;
  token: string;
  action: 'sync' | 'promote' | 'clone';
  sourceSpaceId: string;
  targetSpaceId: string;
  conflicts: SchemaConflict[];
  resolutions: SchemaResolutions;
  dependencies: {
    stories: { id: string; name: string }[];
    assets: { id: string; filename: string; byteSize: number }[];
    datasources: { id: string; name: string }[];
  };
  steps: {
    id: string;
    name: string;
    changes: MigrationChange[];
    impacts: MigrationImpact[];
    blockers: MigrationBlocker[];
  }[];
  confirmation: string | null;
};
export function portableDefinitions(definitions: BlockDefinition[]): PortableDefinition[] {
  return definitions
    .map((definition) => ({
      id: definition.id,
      parentDefinitionId: definition.parentDefinitionId ?? null,
      schema: definitionInput(definition),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function validatePortableDefinitions(definitions: PortableDefinition[]) {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const definition of definitions) {
    portableDefinitionSchema.parse(definition);
    if (ids.has(definition.id) || names.has(definition.schema.name))
      throw new Error('Duplicate block identity or API name');
    ids.add(definition.id);
    names.add(definition.schema.name);
  }
  validateDefinitionHierarchy(
    definitions.map((d) => ({
      ...d.schema,
      id: d.id,
      parentDefinitionId: d.parentDefinitionId,
      versionId: d.id,
      version: 1,
      createdAt: '',
    })),
  );
  for (const { schema } of definitions)
    for (const field of schema.fields) {
      const references =
        field.type === 'blocks'
          ? (field.allowedDefinitionIds ?? [])
          : (field.type === 'option' || field.type === 'options') &&
              field.source.type === 'stories' &&
              field.source.contentTypeId
            ? [field.source.contentTypeId]
            : [];
      if (references.some((id) => !ids.has(id)))
        throw new Error(`Missing block reference in ${schema.name}.${field.name}`);
    }
}

/** Identity arrays merge by ID; order and scalar arrays need an explicit choice if both changed. */
export function reconcileSchemas(
  base: PortableDefinition[],
  dev: PortableDefinition[],
  prod: PortableDefinition[],
  resolutions: SchemaResolutions = {},
) {
  const conflicts: SchemaConflict[] = [];
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  function merge(b: unknown, d: unknown, p: unknown, path: string): unknown {
    if (same(d, p) || same(b, p)) return d;
    if (same(b, d)) return p;
    if (
      Array.isArray(b) &&
      Array.isArray(d) &&
      Array.isArray(p) &&
      (path === 'blocks' || path.endsWith('.fields'))
    ) {
      const lookup = (items: Array<{ id: string }>) =>
        new Map(items.map((item) => [item.id, item]));
      const bm = lookup(b),
        dm = lookup(d),
        pm = lookup(p);
      const ids = [...new Set([...bm.keys(), ...dm.keys(), ...pm.keys()])];
      const merged = new Map(
        ids.map((id) => [id, merge(bm.get(id), dm.get(id), pm.get(id), `${path}.${id}`)]),
      );
      const retained = b
        .filter((item) => dm.has(item.id) && pm.has(item.id))
        .map((item) => item.id);
      const order = (items: Array<{ id: string }>) =>
        items.map((item) => item.id).filter((id) => retained.includes(id));
      const selected =
        path === 'blocks'
          ? ids
          : (merge(retained, order(d), order(p), `${path}.order`) as string[]);
      const ordered = [...selected];
      for (const items of [p, d])
        for (let i = 0; i < items.length; i++) {
          const id = items[i].id;
          if (ordered.includes(id)) continue;
          const previous = items
            .slice(0, i)
            .reverse()
            .find((item) => ordered.includes(item.id));
          ordered.splice(previous ? ordered.indexOf(previous.id) + 1 : 0, 0, id);
        }
      return ordered.filter((id) => merged.get(id) !== undefined).map((id) => merged.get(id));
    }
    const object = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === 'object' && !Array.isArray(v);
    if (object(b) && object(d) && object(p)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(d), ...Object.keys(p)])) {
        const value = merge(b[key], d[key], p[key], `${path}.${key}`);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (!resolutions[path])
      conflicts.push({ path, base: b ?? null, dev: d ?? null, prod: p ?? null });
    return resolutions[path] === 'prod' ? p : d;
  }
  let definitions = merge(base, dev, prod, 'blocks') as PortableDefinition[];
  if (!conflicts.length) {
    // Independent parent moves or deletions can make an otherwise conflict-free merge invalid.
    const path = 'blocks.structure';
    if (resolutions[path]) definitions = resolutions[path] === 'prod' ? prod : dev;
    else {
      try {
        validatePortableDefinitions(definitions);
      } catch {
        conflicts.push({ path, base, dev, prod });
      }
    }
  }
  return { definitions, conflicts };
}
export function withoutExternalCredentials(definitions: PortableDefinition[]) {
  return definitions.map((d) => ({
    ...d,
    schema: {
      ...d.schema,
      fields: d.schema.fields.map((field) =>
        (field.type === 'option' || field.type === 'options') && field.source.type === 'external'
          ? { ...field, source: { type: 'external' as const, url: field.source.url } }
          : field,
      ),
    },
  }));
}
export function schemaInputWithTargetCredentials(
  schema: DefinitionInput,
  target?: DefinitionInput,
): DefinitionInput {
  return {
    ...schema,
    fields: schema.fields.map((field) => {
      const existing = target?.fields.find((old) => old.id === field.id);
      if (
        (field.type === 'option' || field.type === 'options') &&
        field.source.type === 'external'
      ) {
        const source =
          existing &&
          (existing.type === 'option' || existing.type === 'options') &&
          existing.source.type === 'external' &&
          existing.source.url === field.source.url
            ? existing.source
            : field.source;
        return { ...field, source };
      }
      return field;
    }),
  };
}
