import { Pool, type PoolClient } from 'pg';
import { migrate } from './migrate.js';
import {
  migrateSpace,
  assertDedicatedRole,
  connectionURL,
  sealConnection,
  hashToken,
  type Installation,
} from './installation.js';

const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
const scoped: Record<string, string> = {
  spaces: 'id=$1',
  definition_versions: 'definition_id IN (SELECT id FROM definitions WHERE space_id=$1)',
  story_locales: 'story_id IN (SELECT id FROM stories WHERE space_id=$1)',
  block_drafts:
    'locale_id IN (SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)',
  edit_leases:
    'locale_id IN (SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)',
  checkpoints:
    'locale_id IN (SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)',
  publications:
    'locale_id IN (SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)',
  mutation_receipts:
    'locale_id IN (SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)',
  page_connections:
    'locale_id IN (SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)',
  story_pins: 'story_id IN (SELECT id FROM stories WHERE space_id=$1)',
  asset_folder_placements: 'asset_id IN (SELECT id FROM assets WHERE space_id=$1)',
  webhook_attempts: 'delivery_id IN (SELECT id FROM webhook_deliveries WHERE space_id=$1)',
  discussion_messages: 'discussion_id IN (SELECT id FROM discussions WHERE space_id=$1)',
  review_decisions: 'discussion_id IN (SELECT id FROM discussions WHERE space_id=$1)',
  // Clone receipts use the destination space ID; other transfers record it in their result.
  schema_transfers: "coalesce(result->>'targetSpaceId',id::text)=$1",
};
async function insertRows(client: PoolClient, table: string, rows: Record<string, unknown>[]) {
  // JSON recordsets preserve bigint, arrays, timestamps and jsonb without per-field conversions.
  if (rows.length) {
    const columns = Object.keys(rows[0]).map(q).join(',');
    for (let i = 0; i < rows.length; i += 250)
      await client.query(
        `INSERT INTO ${q(table)}(${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::${q(table)},$1::jsonb)`,
        [JSON.stringify(rows.slice(i, i + 250))],
      );
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const canonicalRows = (rows: unknown[]) => rows.map((row) => JSON.stringify(canonical(row))).sort();

// Run with the old application and jobs stopped. The source transaction is strictly read-only.
export async function splitLegacy(
  installation: Installation,
  source: Pool,
  targets: Record<string, string>,
  adminId: string,
) {
  const legacy = await source.connect(),
    control = await installation.pool.connect();
  const destinations: Array<{ id: string; db: Pool }> = [];
  try {
    await legacy.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await control.query('BEGIN');
    await control.query('SELECT pg_advisory_xact_lock(723198453)');
    const spaces = (await legacy.query('SELECT * FROM spaces ORDER BY id')).rows;
    if (spaces.length !== Object.keys(targets).length || spaces.some((s) => !targets[s.id]))
      throw new Error('Supply exactly one empty destination for every legacy space');
    if (
      !(await legacy.query("SELECT 1 FROM storypane_migrations WHERE name='024_management_api'"))
        .rowCount
    )
      throw new Error('Upgrade the source to migration 024 before splitting');
    if ((await installation.pool.query('SELECT 1 FROM space_connections LIMIT 1')).rowCount)
      throw new Error('Legacy split requires an empty connection registry');
    const users = (
      await legacy.query(
        'SELECT id,name,email,"emailVerified","createdAt","updatedAt",clerk_user_id,avatar_url FROM "user"',
      )
    ).rows;
    if (!users.some((user) => user.id === adminId))
      throw new Error('Installation administrator ID is not in the source');
    if (installation.options.provider !== 'clerk')
      throw new Error(
        'Legacy Clerk identities must be imported with AUTH_PROVIDER=clerk; migrate accounts explicitly afterward',
      );
    if ((await control.query('SELECT 1 FROM "user" LIMIT 1')).rowCount)
      throw new Error('Legacy split requires an empty identity directory');
    await insertRows(
      control,
      'user',
      users.map((user) => ({ ...user, installation_admin: user.id === adminId })),
    );
    const tables = (
      await legacy.query(
        'SELECT table_name, array_agg(column_name::text) AS columns FROM information_schema.columns WHERE table_schema=current_schema() GROUP BY table_name ORDER BY table_name',
      )
    ).rows as Array<{ table_name: string; columns: string[] }>;
    const ignored = new Set([
      'user',
      'session',
      'account',
      'verification',
      'cms_sessions',
      'rateLimit',
      'storypane_migrations',
    ]);
    const content = tables.filter((t) => !ignored.has(t.table_name));
    for (const table of content)
      if (!scoped[table.table_name] && !table.columns.includes('space_id'))
        throw new Error(
          `No space filter for table ${table.table_name}; source has unsupported data`,
        );
    const history = (
      await legacy.query('SELECT to_jsonb(t) AS row FROM storypane_migrations t')
    ).rows.map((r) => r.row);
    const included = new Set<string>(history.map((row) => row.name));
    for (const space of spaces) {
      const url = connectionURL(targets[space.id]);
      const db = new Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000 });
      destinations.push({ id: space.id, db });
      if (
        (
          await db.query(
            "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1",
          )
        ).rowCount
      )
        throw new Error(
          'Legacy split destinations must be empty; retain or restore failed destinations for inspection',
        );
      await assertDedicatedRole(db);
      // shortcut: copy one space in memory; stream rows when histories outgrow operator memory.
      const rows = new Map<string, Record<string, unknown>[]>();
      for (const table of content)
        rows.set(
          table.table_name,
          (
            await legacy.query(
              `SELECT to_jsonb(t) AS row FROM ${q(table.table_name)} t WHERE ${scoped[table.table_name] ?? 'space_id=$1'}`,
              [space.id],
            )
          ).rows.map((r) => r.row),
        );
      const serialized = JSON.stringify([...rows.values()]);
      const profiles = users
        .filter((u) => serialized.includes(JSON.stringify(u.id)))
        .map((u) => ({ id: u.id, name: u.name, email: u.email, avatar_url: u.avatar_url }));
      await migrate(
        db,
        async (client) => {
          const constraints = (
            await client.query(
              "SELECT conrelid::regclass::text AS table_name,conname,condeferrable,condeferred FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace",
            )
          ).rows;
          for (const constraint of constraints)
            await client.query(
              `ALTER TABLE ${constraint.table_name} ALTER CONSTRAINT ${q(constraint.conname)} DEFERRABLE INITIALLY DEFERRED`,
            );
          await client.query('SET CONSTRAINTS ALL DEFERRED');
          await client.query('ALTER TABLE spaces DISABLE TRIGGER space_roles_defaults');
          // Copy historical release revisions without counting imported members as new edits.
          if (included.has('027_content_releases'))
            await client.query(
              'ALTER TABLE publication_schedules DISABLE TRIGGER content_release_members_changed',
            );
          if (included.has('028_page_connections'))
            await client.query(
              'ALTER TABLE story_locales DISABLE TRIGGER page_connections_changed',
            );
          await insertRows(client, 'user', profiles);
          for (const [table, data] of rows) await insertRows(client, table, data);
          await client.query('ALTER TABLE spaces ENABLE TRIGGER space_roles_defaults');
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          if (included.has('027_content_releases'))
            await client.query(
              'ALTER TABLE publication_schedules ENABLE TRIGGER content_release_members_changed',
            );
          for (const constraint of constraints)
            await client.query(
              `ALTER TABLE ${constraint.table_name} ALTER CONSTRAINT ${q(constraint.conname)} ${constraint.condeferrable ? `DEFERRABLE INITIALLY ${constraint.condeferred ? 'DEFERRED' : 'IMMEDIATE'}` : 'NOT DEFERRABLE'}`,
            );
          for (const [table, data] of rows) {
            const copied = (
              await client.query(`SELECT to_jsonb(t) AS row FROM ${q(table)} t`)
            ).rows.map((r) => r.row);
            if (JSON.stringify(canonicalRows(copied)) !== JSON.stringify(canonicalRows(data)))
              throw new Error(`Split validation failed for ${table}`);
          }
          if (included.has('028_page_connections'))
            await client.query('ALTER TABLE story_locales ENABLE TRIGGER page_connections_changed');
          await client.query('DELETE FROM storypane_migrations');
          await insertRows(client, 'storypane_migrations', history);
          await client.query(
            'CREATE TABLE space_database(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),space_id uuid NOT NULL UNIQUE)',
          );
          await client.query('INSERT INTO space_database(space_id) VALUES($1)', [space.id]);
        },
        included,
      );
      // Validate an exact source copy before upgrading the destination.
      await migrateSpace(db);
      await control.query(
        "INSERT INTO space_connections(id,name,description,status,connection_secret,connection_fingerprint,mode,owner_id) VALUES($1,$2,$3,'ready',$4,$5,'import',$6)",
        [
          space.id,
          space.name,
          space.description,
          sealConnection(url.href, installation.options.encryptionKey, space.id),
          hashToken(`${url.hostname}:${url.port || '5432'}${url.pathname}`),
          adminId,
        ],
      );
      const previews = rows.get('preview_sessions') ?? [];
      for (const preview of previews)
        await control.query(
          'INSERT INTO preview_routes(token_hash,space_id,expires_at) VALUES($1,$2,$3)',
          [preview.token_hash, space.id, preview.expires_at],
        );
    }
    // Preserve short-lived Clerk grants; subsequent requests still check Clerk revocation.
    const sessions = (await legacy.query('SELECT to_jsonb(t) AS row FROM cms_sessions t')).rows.map(
      (r) => r.row,
    );
    await insertRows(control, 'cms_sessions', sessions);
    await control.query('COMMIT');
    await legacy.query('COMMIT');
    return { spaces: spaces.length, identities: users.length };
  } catch (error) {
    await control.query('ROLLBACK');
    await legacy.query('ROLLBACK');
    throw error;
  } finally {
    control.release();
    legacy.release();
    await Promise.all(destinations.map(({ db }) => db.end()));
  }
}
