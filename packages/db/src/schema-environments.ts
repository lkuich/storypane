import { z } from 'zod';
import {
  StorypaneError,
  parseInput,
  portableDefinitions,
  withoutExternalCredentials,
  reconcileSchemas,
  schemaInputWithTargetCredentials,
  schemaResolutionsSchema,
  validatePortableDefinitions,
  type Actor,
  type SchemaMigration,
  type SchemaStep,
  type PortableDefinition,
  type SchemaStatus,
  type SchemaTransferReview,
  type SchemaResolutions,
  type SchemaConflict,
} from '@storypane/core';
import { StorypaneStore } from './store.js';
import {
  collectSchemaDependencies,
  missingSchemaDependencies,
  installSchemaConfiguration,
  installSchemaContent,
  copySchemaAssets,
  dependencySummary,
  schemaDigest,
  schemaIdentity,
  type CopySchemaAsset,
  type SchemaDependencies,
} from './schema-dependencies.js';

export async function captureSchema(store: StorypaneStore, actor: Actor) {
  return store.readSchema(actor, async (client, scoped) => {
    const space = (await client.query('SELECT * FROM spaces WHERE id=$1', [actor.spaceId])).rows[0];
    const history = await scoped.listMigrations(actor);
    const head = history.find((m) => m.version === space.schema_version)!;
    const parents = (
      await client.query('SELECT id,parent_definition_id FROM definitions WHERE space_id=$1', [
        actor.spaceId,
      ])
    ).rows;
    const portable = (m: SchemaMigration) =>
      withoutExternalCredentials(
        portableDefinitions(
          m.definitions.map((d) => ({
            ...d,
            parentDefinitionId:
              d.parentDefinitionId === undefined
                ? Object.hasOwn(space.schema_hierarchy_baseline, d.id)
                  ? space.schema_hierarchy_baseline[d.id]
                  : (parents.find((p) => p.id === d.id)?.parent_definition_id ?? null)
                : d.parentDefinitionId,
          })),
        ),
      );
    const branch = (
      await client.query('SELECT * FROM schema_branches WHERE space_id=$1', [actor.spaceId])
    ).rows[0];
    const pending: SchemaStep[] = branch ? [...branch.pending] : [];
    for (const m of history.filter(
      (m) => m.status === 'deployed' && m.version > (branch?.local_version ?? head.version),
    ))
      pending.push({
        id: m.id,
        name: m.name,
        definitions: portable(m),
        destructive: m.destructive,
      });
    const active = history.find((m) => m.status === 'active');
    const receipts = (
      await client.query(
        "SELECT id,result->'steps' AS steps FROM schema_transfers WHERE result->>'action'='promote'",
      )
    ).rows;
    const appliedSteps = Object.fromEntries(
      receipts.flatMap((r) =>
        r.steps.map((step: { id: string }, i: number) => [schemaIdentity([r.id, i]), step.id]),
      ),
    );
    return {
      space,
      head,
      appliedSteps,
      deployed: history
        .filter((m) => m.status === 'deployed')
        .map((m) => ({
          id: m.id,
          name: m.name,
          definitions: portable(m),
          destructive: m.destructive,
        })),
      definitions: portable(head),
      branch,
      pending,
      active: active ? { migration: active, definitions: portable(active) } : null,
    };
  });
}
export async function schemaStatus(
  devStore: StorypaneStore,
  dev: Actor,
  prodStore?: StorypaneStore,
  prod?: Actor,
): Promise<SchemaStatus> {
  const source = await devStore.readSchema(dev, async (client) => {
    const space = (
      await client.query(
        'SELECT environment,schema_read_only,schema_version FROM spaces WHERE id=$1',
        [dev.spaceId],
      )
    ).rows[0];
    const branch = (
      await client.query(
        'SELECT production_head,local_version,pending FROM schema_branches WHERE space_id=$1',
        [dev.spaceId],
      )
    ).rows[0];
    const local = (
      await client.query(
        "SELECT id,name FROM schema_migrations WHERE space_id=$1 AND status='deployed' AND version>$2 ORDER BY version",
        [dev.spaceId, branch?.local_version ?? space.schema_version],
      )
    ).rows;
    return {
      space,
      branch,
      pending: [
        ...(branch?.pending ?? []).map((step: SchemaStep) => ({ id: step.id, name: step.name })),
        ...local,
      ],
    };
  });
  const production =
    prodStore && prod
      ? await prodStore.readSchema(
          prod,
          async (client) =>
            (
              await client.query(
                'SELECT s.id,s.name,m.id AS head,m.version FROM spaces s JOIN schema_migrations m ON m.space_id=s.id AND m.version=s.schema_version WHERE s.id=$1',
                [prod.spaceId],
              )
            ).rows[0],
        )
      : null;
  return {
    environment: source.space.environment,
    schemaReadOnly: source.space.schema_read_only,
    production: production
      ? {
          id: production.id,
          name: production.name,
          head: production.head,
          version: production.version,
        }
      : null,
    baseline: source.branch?.production_head ?? null,
    behind: !!production && source.branch?.production_head !== production.head,
    pending: source.pending,
  };
}
const transferInput = z
  .object({
    id: z.uuid(),
    action: z.enum(['sync', 'promote']),
    resolutions: schemaResolutionsSchema.default({}),
    reviewToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    confirmation: z.string().optional(),
  })
  .strict();

export async function transferSchema(
  devStore: StorypaneStore,
  dev: Actor,
  prodStore: StorypaneStore,
  prod: Actor,
  raw: unknown,
  copyAsset?: CopySchemaAsset,
): Promise<SchemaTransferReview> {
  const input = parseInput(transferInput, raw);
  const applying = !!input.reviewToken;
  await devStore.schemaTransaction(dev, async () => undefined, true);
  const source = await captureSchema(devStore, dev),
    production = await captureSchema(prodStore, prod);
  if (
    source.space.environment !== 'dev' ||
    source.space.production_space_id !== prod.spaceId ||
    production.space.environment !== 'prod' ||
    !source.branch
  )
    throw new StorypaneError('invalid', 'Choose a dev space linked to this production space');
  const targetStore = input.action === 'promote' ? prodStore : devStore;
  const target = input.action === 'promote' ? prod : dev;
  if (applying) {
    const receipt = await targetStore.readSchema(
      target,
      async (client) =>
        (await client.query('SELECT * FROM schema_transfers WHERE id=$1', [input.id])).rows[0],
    );
    if (receipt) {
      if (
        receipt.review_token !== input.reviewToken ||
        receipt.source_space_id !== (input.action === 'promote' ? dev.spaceId : prod.spaceId)
      )
        throw new StorypaneError(
          'stale_revision',
          'This transfer ID was already used for another review',
        );
      await acknowledgePromotion(devStore, dev, prodStore, prod, receipt.result);
      return receipt.result;
    }
  }
  let candidates = source.pending;
  const conflicts: SchemaConflict[] = [];
  let merged = production.definitions;
  const resolutions: SchemaResolutions = input.resolutions;
  if (input.action === 'promote') {
    if (source.branch.production_head !== production.head.id)
      throw new StorypaneError(
        'stale_revision',
        'Production advanced. Sync this dev space before promoting.',
      );
    if (!candidates.length)
      throw new StorypaneError('invalid', 'Deploy a migration in dev before promoting');
    if (
      production.active &&
      schemaDigest(production.active.definitions) !== schemaDigest(production.definitions)
    )
      throw new StorypaneError(
        'stale_revision',
        'Production has local schema work. Resolve it before promoting.',
      );
  } else {
    if (source.branch.production_head === production.head.id)
      throw new StorypaneError('invalid', 'This dev space is already in sync');
    let previous: PortableDefinition[] = source.branch.baseline;
    candidates = [];
    const alreadyApplied = new Set(Object.values(production.appliedSteps));
    for (const step of source.pending) {
      if (alreadyApplied.has(step.id)) {
        previous = step.definitions;
        continue;
      }
      const prefix = step.id + ':';
      const choices = Object.fromEntries(
        Object.entries(resolutions)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      );
      const reconciled = reconcileSchemas(previous, step.definitions, merged, choices);
      conflicts.push(...reconciled.conflicts.map((c) => ({ ...c, path: prefix + c.path })));
      previous = step.definitions;
      merged = reconciled.definitions;
      candidates.push({
        ...step,
        id: schemaIdentity([step.id, production.head.id, merged]),
        definitions: merged,
      });
    }
    if (source.active) {
      const prefix = 'active:';
      const choices = Object.fromEntries(
        Object.entries(resolutions)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      );
      const reconciled = reconcileSchemas(
        source.definitions,
        source.active.definitions,
        merged,
        choices,
      );
      conflicts.push(...reconciled.conflicts.map((c) => ({ ...c, path: prefix + c.path })));
      source.active.definitions = reconciled.definitions;
    }
  }
  const steps: SchemaStep[] = [];
  if (input.action === 'promote') steps.push(...candidates);
  else {
    const baselineIndex = production.deployed.findIndex(
      (step) => step.id === source.branch.production_head,
    );
    if (baselineIndex < 0)
      throw new StorypaneError(
        'stale_revision',
        'The production baseline is missing from its immutable history',
      );
    let priorProduction: PortableDefinition[] = source.branch.baseline;
    let working = source.definitions;
    const executedLocally = new Set(source.pending.map((step) => step.id));
    for (const incoming of production.deployed.slice(baselineIndex + 1)) {
      if (executedLocally.has(production.appliedSteps[incoming.id])) {
        priorProduction = incoming.definitions;
        continue;
      }
      const prefix = `incoming:${incoming.id}:`;
      const choices = Object.fromEntries(
        Object.entries(resolutions)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      );
      const reconciled = reconcileSchemas(priorProduction, working, incoming.definitions, choices);
      conflicts.push(...reconciled.conflicts.map((c) => ({ ...c, path: prefix + c.path })));
      working = reconciled.definitions;
      priorProduction = incoming.definitions;
      steps.push({
        id: incoming.id,
        name: `Sync: ${incoming.name}`.slice(0, 120),
        definitions: working,
        destructive: incoming.destructive,
      });
    }
    if (schemaDigest(working) !== schemaDigest(merged))
      steps.push({
        id: schemaIdentity([input.id, 'reconciliation']),
        name: 'Reconcile developer changes',
        definitions: merged,
      });
  }
  const dependencyStore = input.action === 'promote' ? devStore : prodStore;
  const dependencyActor = input.action === 'promote' ? dev : prod;
  const review: SchemaTransferReview = {
    id: input.id,
    token: '',
    action: input.action,
    sourceSpaceId: dependencyActor.spaceId,
    targetSpaceId: target.spaceId,
    conflicts,
    resolutions,
    dependencies: { stories: [], assets: [], datasources: [] },
    steps: [],
    confirmation: null,
  };
  if (conflicts.length) return review;
  for (const step of steps) {
    try {
      validatePortableDefinitions(step.definitions);
    } catch (error) {
      throw new StorypaneError(
        'invalid',
        error instanceof Error ? error.message : 'Invalid reconciled schema',
      );
    }
  }
  const targetStoryIds: string[] = await targetStore.readSchema(target, async (client) =>
    (
      await client.query('SELECT id FROM stories WHERE space_id=$1 ORDER BY id', [target.spaceId])
    ).rows.map((row) => row.id),
  );
  // Dev-only dependencies already live in dev; collect incoming production requirements on sync.
  const dependencies = await dependencyStore.readSchema(dependencyActor, async (_, scoped) => {
    const collected: SchemaDependencies[] = [];
    for (const step of steps)
      collected.push(
        await collectSchemaDependencies(
          scoped,
          dependencyActor,
          input.action === 'sync'
            ? (production.deployed.find((d) => d.id === step.id)?.definitions ??
                production.definitions)
            : step.definitions,
          targetStoryIds,
        ),
      );
    return collected;
  });
  const simulate = async (preview: boolean) =>
    targetStore.schemaTransaction(
      target,
      async (scoped, client) => {
        const current = await captureSchema(scoped, target);
        const currentStoryIds = (
          await client.query('SELECT id FROM stories WHERE space_id=$1 ORDER BY id', [
            target.spaceId,
          ])
        ).rows.map((row) => row.id);
        if (
          schemaDigest(currentStoryIds) !== schemaDigest(targetStoryIds) ||
          current.head.id !== (input.action === 'promote' ? production.head.id : source.head.id) ||
          current.active?.migration.revision !==
            (input.action === 'promote'
              ? production.active?.migration.revision
              : source.active?.migration.revision)
        )
          throw new StorypaneError('stale_revision', 'The target schema changed. Review again.');
        if (current.active)
          await client.query('DELETE FROM schema_migrations WHERE id=$1', [
            current.active.migration.id,
          ]);
        const contentHeads = (
          await client.query(
            'SELECT l.id,l.revision,l.checkpoint_id,l.published_version_id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1 ORDER BY l.id',
            [target.spaceId],
          )
        ).rows;
        const summaries: SchemaTransferReview['steps'] = [];
        const missing: SchemaDependencies[] = [];
        for (const [index, step] of steps.entries()) {
          const deps = await missingSchemaDependencies(client, target.spaceId, dependencies[index]);
          missing.push(deps);
          const localeIds = await installSchemaConfiguration(client, target.spaceId, deps);
          await installSchemaContent(client, target, deps, localeIds, step.definitions);
          const history = await scoped.listMigrations(target);
          const base = history.filter((m) => m.status === 'deployed').at(-1)!;
          const definitions = step.definitions.map((d) => ({
            ...d,
            schema: schemaInputWithTargetCredentials(
              d.schema,
              base.definitions.find((old) => old.id === d.id),
            ),
          }));
          const migration = await scoped.pushMigration(target, {
            formatVersion: 2,
            id: schemaIdentity([input.id, index]),
            spaceId: target.spaceId,
            version: base.version + 1,
            baseVersion: base.version,
            name: step.name,
            definitions,
            remoteRevision: null,
            sourceHash: null,
            status: 'active',
          });
          const inspected = await scoped.reviewMigration(target, migration.id, step.destructive);
          summaries.push({
            id: step.id,
            name: step.name,
            changes: inspected.changes,
            impacts: inspected.impacts,
            blockers: inspected.blockers,
          });
          if (inspected.blockers.length) break;
          await scoped.deployMigration(target, migration.id, inspected.token, {
            destructive: step.destructive ?? false,
            confirmation: inspected.confirmation ?? undefined,
          });
        }
        const summary = { stories: new Map(), assets: new Map(), datasources: new Map() };
        for (const deps of missing) {
          const d = dependencySummary(deps);
          for (const kind of ['stories', 'assets', 'datasources'] as const)
            for (const item of d[kind]) summary[kind].set(item.id, item);
        }
        const result: SchemaTransferReview = {
          ...review,
          steps: summaries,
          dependencies: {
            stories: [...summary.stories.values()],
            assets: [...summary.assets.values()],
            datasources: [...summary.datasources.values()],
          },
          confirmation:
            summaries.some((s) =>
              s.impacts.some((i) => i.deletedValues + i.resetValues + i.deletedBlocks > 0),
            ) || steps.some((s) => 'destructive' in s && s.destructive)
              ? `APPLY ${target.spaceId}`
              : null,
        };
        result.token = schemaDigest({
          action: input.action,
          id: input.id,
          sourceHead: source.head.id,
          sourceActive: source.active,
          productionHead: production.head.id,
          branch: source.branch,
          candidates,
          resolutions,
          dependencies,
          targetStoryIds,
          contentHeads,
          summaries,
          settings: current.space,
        });
        if (applying && result.token !== input.reviewToken)
          throw new StorypaneError(
            'stale_revision',
            'The schema, dependencies, or content changed. Review again.',
          );
        if (!preview) {
          if (summaries.some((s) => s.blockers.length))
            throw new StorypaneError('invalid', 'Resolve migration blockers before applying');
          if (result.confirmation && result.confirmation !== input.confirmation)
            throw new StorypaneError('invalid', `Type ${result.confirmation} to confirm data loss`);
          for (const deps of missing) await copySchemaAssets(deps, target.spaceId, copyAsset);
          const deployed = (await scoped.listMigrations(target))
            .filter((m) => m.status === 'deployed')
            .at(-1)!;
          if (input.action === 'sync') {
            await client.query(
              'UPDATE schema_branches SET production_head=$2,baseline=$3,local_version=$4,pending=$5 WHERE space_id=$1',
              [
                dev.spaceId,
                production.head.id,
                JSON.stringify(production.definitions),
                deployed.version,
                JSON.stringify(candidates),
              ],
            );
            if (source.active)
              await scoped.pushMigration(dev, {
                formatVersion: 2,
                id: source.active.migration.id,
                spaceId: dev.spaceId,
                version: deployed.version + 1,
                baseVersion: deployed.version,
                name: source.active.migration.name,
                definitions: source.active.definitions,
                remoteRevision: null,
                sourceHash: null,
                status: 'active',
              });
          }
          await client.query(
            'INSERT INTO schema_transfers(id,source_space_id,source_head,review_token,result) VALUES($1,$2,$3,$4,$5)',
            [
              input.id,
              dependencyActor.spaceId,
              dependencyActor.spaceId === dev.spaceId ? source.head.id : production.head.id,
              result.token,
              JSON.stringify(result),
            ],
          );
        }
        return result;
      },
      preview,
    );
  const result = await simulate(!applying);
  if (applying && input.action === 'promote')
    await acknowledgePromotion(devStore, dev, prodStore, prod, result);
  return result;
}
async function acknowledgePromotion(
  devStore: StorypaneStore,
  dev: Actor,
  prodStore: StorypaneStore,
  prod: Actor,
  receipt: SchemaTransferReview,
) {
  if (receipt.action !== 'promote') return;
  await devStore.schemaTransaction(dev, async (scoped, client) => {
    const source = await captureSchema(scoped, dev);
    const promoted = new Set(receipt.steps.map((s) => s.id));
    if (!source.pending.some((s) => promoted.has(s.id))) return;
    const remaining = source.pending.filter((s) => !promoted.has(s.id));
    // Bind to the exact deployed batch, even if another developer has since advanced production.
    const last = (await prodStore.listMigrations(prod)).find(
      (m) => m.id === schemaIdentity([receipt.id, receipt.steps.length - 1]),
    );
    if (!last)
      throw new StorypaneError(
        'unavailable',
        'Promotion receipt is missing its deployed migration',
      );
    await client.query(
      'UPDATE schema_branches SET production_head=$2,baseline=$3,local_version=$4,pending=$5 WHERE space_id=$1',
      [
        dev.spaceId,
        last.id,
        JSON.stringify(withoutExternalCredentials(portableDefinitions(last.definitions))),
        source.head.version,
        JSON.stringify(remaining),
      ],
    );
  });
}
