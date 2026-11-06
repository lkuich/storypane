import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  StorypaneError,
  canonicalJson,
  defaultFields,
  richTextAssetIds,
  withoutExternalCredentials,
  portableDefinitions,
  type Actor,
  type FieldDefinition,
  type Json,
  type LocaleSnapshot,
  type PortableDefinition,
} from '@storypane/core';
import { StorypaneStore, assembleContent } from './store.js';

export const schemaDigest = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export function schemaIdentity(value: unknown) {
  const hash = schemaDigest(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export type SchemaDependencies = {
  locales: QueryResultRow[];
  datasources: QueryResultRow[];
  folders: QueryResultRow[];
  stories: { row: QueryResultRow; snapshots: LocaleSnapshot[] }[];
  assets: QueryResultRow[];
};
export type CopySchemaAsset = (
  asset: { object_key: string; id: string; byte_size: string; mime_type: string },
  destinationKey: string,
) => Promise<void>;
export function dependencySummary(deps: SchemaDependencies) {
  return {
    stories: deps.stories.map(({ row }) => ({ id: row.id as string, name: row.name as string })),
    assets: deps.assets.map((a) => ({
      id: a.id as string,
      filename: a.filename as string,
      byteSize: Number(a.byte_size),
    })),
    datasources: deps.datasources.map((d) => ({ id: d.id as string, name: d.name as string })),
  };
}
export async function collectSchemaDependencies(
  store: StorypaneStore,
  actor: Actor,
  definitions: PortableDefinition[],
): Promise<SchemaDependencies> {
  return store.readSchema(actor, async (client, scoped) => {
    const storyIds = new Set<string>(),
      assetIds = new Set<string>(),
      datasourceIds = new Set<string>();
    function references(fields: FieldDefinition[], values: Record<string, Json>) {
      for (const field of fields) {
        if (
          (field.type === 'option' || field.type === 'options') &&
          field.source.type === 'datasource'
        )
          datasourceIds.add(field.source.datasourceId);
        const value = values[field.name];
        if (!value) continue;
        if (field.type === 'text' && field.format === 'richtext')
          for (const id of richTextAssetIds(value)) assetIds.add(id);
        if (typeof value === 'object' && !Array.isArray(value)) {
          if (
            (field.type === 'asset' || (field.type === 'link' && value.type === 'asset')) &&
            typeof value.assetId === 'string'
          )
            assetIds.add(value.assetId);
          if (field.type === 'link' && value.type === 'story' && typeof value.storyId === 'string')
            storyIds.add(value.storyId);
        }
        if (
          (field.type === 'option' || field.type === 'options') &&
          field.source.type === 'stories'
        )
          for (const id of Array.isArray(value) ? value : [value])
            if (typeof id === 'string') storyIds.add(id);
      }
    }
    for (const definition of definitions)
      references(definition.schema.fields, defaultFields(definition.schema));
    const dependencies: SchemaDependencies = {
      locales: [],
      datasources: [],
      folders: [],
      stories: [],
      assets: [],
    };
    for (const id of storyIds) {
      if (storyIds.size > 100)
        throw new StorypaneError(
          'invalid',
          'Schema dependencies exceed 100 stories. Reduce linked defaults before transferring.',
        );
      const row = (
        await client.query(
          'SELECT * FROM stories WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL',
          [id, actor.spaceId],
        )
      ).rows[0];
      if (!row) throw new StorypaneError('invalid', 'A required story is unavailable');
      const locales = (
        await client.query(
          'SELECT l.id,p.snapshot FROM story_locales l LEFT JOIN publications p ON p.id=l.published_version_id WHERE l.story_id=$1 ORDER BY l.id',
          [id],
        )
      ).rows;
      const snapshots: LocaleSnapshot[] = [];
      for (const locale of locales) {
        const snapshot: LocaleSnapshot =
          locale.snapshot ?? (await scoped.getSnapshot(actor, id, locale.id));
        snapshot.leases = [];
        for (const block of snapshot.blocks) {
          const definition = snapshot.definitions.find(
            (d) => d.versionId === block.schemaVersionId,
          );
          if (!definition)
            throw new StorypaneError('invalid', 'A required story has a missing schema version');
          references(definition.fields, block.fields);
        }
        snapshots.push(snapshot);
      }
      dependencies.stories.push({ row, snapshots });
    }
    dependencies.locales = (
      await client.query(
        'SELECT id,name,slug,is_default FROM space_locales WHERE space_id=$1 ORDER BY is_default DESC,slug',
        [actor.spaceId],
      )
    ).rows;
    const folders = (
      await client.query('SELECT * FROM content_folders WHERE space_id=$1', [actor.spaceId])
    ).rows;
    const wanted = new Set(dependencies.stories.map(({ row }) => row.folder_id).filter(Boolean));
    for (const id of wanted) {
      const parent = folders.find((f) => f.id === id)?.parent_id;
      if (parent) wanted.add(parent);
    }
    const visiting = new Set<string>();
    function addFolder(id: string) {
      if (dependencies.folders.some((f) => f.id === id)) return;
      if (visiting.has(id)) throw new StorypaneError('invalid', 'Required folders contain a cycle');
      visiting.add(id);
      const folder = folders.find((f) => f.id === id);
      if (!folder) throw new StorypaneError('invalid', 'A required folder is unavailable');
      if (folder.parent_id) addFolder(folder.parent_id);
      dependencies.folders.push(folder);
      visiting.delete(id);
    }
    for (const id of wanted) addFolder(id);
    dependencies.datasources = (
      await client.query(
        'SELECT id,name,slug,items FROM datasources WHERE space_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
        [actor.spaceId, [...datasourceIds]],
      )
    ).rows;
    dependencies.assets = (
      await client.query(
        'SELECT * FROM assets WHERE space_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
        [actor.spaceId, [...assetIds]],
      )
    ).rows;
    if (
      dependencies.datasources.length !== datasourceIds.size ||
      dependencies.assets.length !== assetIds.size
    )
      throw new StorypaneError('invalid', 'A required datasource or media original is unavailable');
    return dependencies;
  });
}
export async function missingSchemaDependencies(
  client: PoolClient,
  spaceId: string,
  deps: SchemaDependencies,
): Promise<SchemaDependencies> {
  const stories = new Set(
    (await client.query('SELECT id FROM stories WHERE space_id=$1', [spaceId])).rows.map(
      (r) => r.id,
    ),
  );
  const assets = new Set(
    (await client.query('SELECT id FROM assets WHERE space_id=$1', [spaceId])).rows.map(
      (r) => r.id,
    ),
  );
  return {
    ...deps,
    stories: deps.stories.filter((s) => !stories.has(s.row.id)),
    assets: deps.assets.filter((a) => !assets.has(a.id)),
  };
}

export async function installSchemaConfiguration(
  client: PoolClient,
  spaceId: string,
  deps: SchemaDependencies,
) {
  const localeIds = new Map<string, string>();
  for (const locale of deps.locales) {
    const existing = (
      await client.query(
        'SELECT id FROM space_locales WHERE space_id=$1 AND (slug=$2 OR ($3 AND is_default))',
        [spaceId, locale.slug, locale.is_default],
      )
    ).rows[0];
    if (existing) localeIds.set(locale.id, existing.id);
    else {
      await client.query(
        'INSERT INTO space_locales(id,space_id,name,slug,is_default) VALUES($1,$2,$3,$4,$5)',
        [locale.id, spaceId, locale.name, locale.slug, locale.is_default],
      );
      localeIds.set(locale.id, locale.id);
    }
  }
  for (const d of deps.datasources) {
    const current = (
      await client.query('SELECT id,name,slug,items FROM datasources WHERE id=$1 AND space_id=$2', [
        d.id,
        spaceId,
      ])
    ).rows[0];
    if (current && schemaDigest(current) !== schemaDigest(d))
      throw new StorypaneError(
        'invalid',
        `Datasource “${d.name}” differs. Reconcile its option values in the target before applying.`,
      );
    if (!current)
      await client.query(
        'INSERT INTO datasources(id,space_id,name,slug,items) VALUES($1,$2,$3,$4,$5)',
        [d.id, spaceId, d.name, d.slug, JSON.stringify(d.items)],
      );
  }
  return localeIds;
}
export async function installSchemaContent(
  client: PoolClient,
  actor: Actor,
  deps: SchemaDependencies,
  localeIds: Map<string, string>,
  definitions: PortableDefinition[],
) {
  for (const d of definitions)
    await client.query(
      'INSERT INTO definitions(id,space_id,name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
      [d.id, actor.spaceId, d.schema.name],
    );
  for (const a of deps.assets)
    await client.query(
      'INSERT INTO assets(id,space_id,object_key,filename,mime_type,byte_size,title,alt,notes,tags,focal_x,focal_y) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO NOTHING',
      [
        a.id,
        actor.spaceId,
        `${actor.spaceId}/schema/${a.id}`,
        a.filename,
        a.mime_type,
        a.byte_size,
        a.title,
        a.alt,
        a.notes,
        JSON.stringify(a.tags),
        a.focal_x,
        a.focal_y,
      ],
    );
  for (const f of deps.folders)
    await client.query(
      'INSERT INTO content_folders(id,space_id,parent_id,name,slug,locale_slugs,allowed_definition_ids,default_definition_id,form_only) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',
      [
        f.id,
        actor.spaceId,
        f.parent_id,
        f.name,
        f.slug,
        JSON.stringify(f.locale_slugs),
        f.allowed_definition_ids,
        f.default_definition_id,
        f.form_only,
      ],
    );
  // Insert identities before snapshots so cycles and forward references remain local.
  for (const { row } of deps.stories)
    await client.query(
      'INSERT INTO stories(id,space_id,name,slug,folder_id,slug_segment) VALUES($1,$2,$3,$4,$5,$6)',
      [row.id, actor.spaceId, row.name, row.slug, row.folder_id, row.slug_segment],
    );
  for (const { row, snapshots } of deps.stories)
    for (const original of snapshots) {
      const snapshot = structuredClone(original);
      snapshot.story = {
        ...snapshot.story,
        name: row.name,
        slug: row.slug,
        slugSegment: row.slug_segment,
        folderId: row.folder_id,
      };
      const locale = (
        await client.query('SELECT id,slug,name FROM space_locales WHERE id=$1 AND space_id=$2', [
          localeIds.get(snapshot.locale.spaceLocaleId),
          actor.spaceId,
        ])
      ).rows[0];
      if (!locale) throw new StorypaneError('invalid', 'A required locale is unavailable');
      const id = snapshot.locale.id;
      const checkpointId = schemaIdentity([actor.spaceId, id, 'schema dependency']);
      for (const definition of snapshot.definitions) {
        Object.assign(
          definition,
          withoutExternalCredentials(portableDefinitions([definition]))[0].schema,
        );
        if (!definitions.some((d) => d.id === definition.id))
          throw new StorypaneError(
            'invalid',
            'A required story uses a block missing from this migration',
          );
        const versionId = schemaIdentity([
          actor.spaceId,
          definition.versionId,
          'dependency schema',
        ]);
        const existing = (
          await client.query('SELECT id,version FROM definition_versions WHERE id=$1', [versionId])
        ).rows[0];
        const version =
          existing?.version ??
          Number(
            (
              await client.query(
                'SELECT coalesce(max(version),0)+1 AS version FROM definition_versions WHERE definition_id=$1',
                [definition.id],
              )
            ).rows[0].version,
          );
        if (!existing)
          await client.query(
            'INSERT INTO definition_versions(id,definition_id,version,schema) VALUES($1,$2,$3,$4)',
            [
              versionId,
              definition.id,
              version,
              JSON.stringify(
                withoutExternalCredentials(portableDefinitions([definition]))[0].schema,
              ),
            ],
          );
        definition.versionId = versionId;
        definition.version = version;
      }
      snapshot.migrationVersion = Number(
        (await client.query('SELECT schema_version FROM spaces WHERE id=$1', [actor.spaceId]))
          .rows[0].schema_version,
      );
      snapshot.leases = [];
      snapshot.locale = {
        ...snapshot.locale,
        spaceLocaleId: locale.id,
        slug: locale.slug,
        name: locale.name,
        revision: 1,
        publishedVersionId: null,
        checkpointId,
      };
      snapshot.revision = 1;
      snapshot.checkpointId = checkpointId;
      await client.query(
        'INSERT INTO story_locales(id,story_id,slug,name,url_slug,slug_segment,root_block_id,space_locale_id,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)',
        [
          id,
          row.id,
          locale.slug,
          locale.name,
          snapshot.locale.urlSlug,
          snapshot.locale.slugSegment,
          snapshot.locale.rootBlockId,
          locale.id,
        ],
      );
      for (const block of snapshot.blocks) {
        const definition = snapshot.definitions.find((d) => d.id === block.definitionId);
        if (!definition)
          throw new StorypaneError(
            'invalid',
            'A required story uses a block missing from the target schema',
          );
        block.schemaVersionId = definition.versionId;
        block.revision = 1;
        await client.query(
          'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields,revision) VALUES($1,$2,$3,$4,$5,$6,$7,1)',
          [
            block.id,
            id,
            block.schemaVersionId,
            block.parentId,
            block.parentField,
            block.position,
            JSON.stringify(block.fields),
          ],
        );
      }
      await client.query(
        'INSERT INTO checkpoints(id,locale_id,revision,actor_id,reason,snapshot,content) VALUES($1,$2,1,$3,$4,$5,$6)',
        [
          checkpointId,
          id,
          actor.userId,
          'Copied schema dependency (unpublished)',
          JSON.stringify(snapshot),
          JSON.stringify(assembleContent(snapshot)),
        ],
      );
      await client.query('UPDATE story_locales SET checkpoint_id=$2 WHERE id=$1', [
        id,
        checkpointId,
      ]);
    }
}
export async function copySchemaAssets(
  deps: SchemaDependencies,
  spaceId: string,
  copy?: CopySchemaAsset,
) {
  if (deps.assets.length && !copy)
    throw new StorypaneError('unavailable', 'Media copying is unavailable');
  for (const asset of deps.assets)
    await copy!(
      {
        id: asset.id,
        object_key: asset.object_key,
        byte_size: String(asset.byte_size),
        mime_type: asset.mime_type,
      },
      `${spaceId}/schema/${asset.id}`,
    );
}
