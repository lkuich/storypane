import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';

export async function migrate(
  pool: Pool,
  initialize?: (client: PoolClient) => Promise<void>,
  included?: ReadonlySet<string>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(723198451)');
    await client.query(
      await readFile(new URL('../migrations/000_migration_history.sql', import.meta.url), 'utf8'),
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS storypane_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of [
      '001_initial',
      '002_space_settings',
      '003_delivery_preview',
      '004_space_locales',
      '005_preview_urls',
      '006_clerk_auth',
      '007_space_invitations',
      '008_space_roles',
      '009_editor_avatars',
      '010_story_modified_by',
      '011_story_pins',
      '012_content_folders',
      '013_schema_migrations',
      '014_destructive_migrations',
      '015_story_lifecycle',
      '016_webhooks',
      '017_publication_schedules',
      '018_production_media',
      '019_content_scopes',
      '020_storypane_preview',
      '021_publication_references',
      '022_definition_parents',
      '023_default_locale',
      '024_management_api',
      '026_space_environments',
      '027_content_releases',
    ]) {
      if (included && !included.has(name)) continue;
      if (
        (await client.query('SELECT name FROM storypane_migrations WHERE name=$1', [name])).rowCount
      ) {
        continue;
      }
      await client.query(
        await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'),
      );
      await client.query('INSERT INTO storypane_migrations(name) VALUES($1)', [name]);
    }
    await initialize?.(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
