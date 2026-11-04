import { Pool } from 'pg';

const connectionString =
  process.env.TEST_DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok_test';
const target = new URL(connectionString);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/blok_test')
  throw new Error('Tests require the dedicated local blok_test database.');
target.pathname = '/postgres';
const pool = new Pool({ connectionString: target.href });
try {
  if (!(await pool.query("SELECT 1 FROM pg_database WHERE datname='blok_test'")).rowCount)
    await pool.query('CREATE DATABASE blok_test');
  console.log('Dedicated local test database is ready.');
} finally {
  await pool.end();
}
