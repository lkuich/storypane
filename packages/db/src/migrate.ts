import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(723198451)')
    await client.query('CREATE TABLE IF NOT EXISTS blok_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const name of ['001_initial', '002_space_settings', '003_delivery_preview', '004_space_locales']) {
      if ((await client.query('SELECT name FROM blok_migrations WHERE name=$1', [name])).rowCount) continue
      await client.query(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'))
      await client.query('INSERT INTO blok_migrations(name) VALUES($1)', [name])
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
