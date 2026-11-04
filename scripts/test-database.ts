import { Pool } from 'pg';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
const target = new URL(connectionString);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
) {
  throw new Error('Tests require the dedicated local test database.');
}
const databaseName = target.pathname.slice(1);
target.pathname = '/postgres';
const pool = new Pool({ connectionString: target.href });
try {
  if (!(await pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])).rowCount) {
    await pool.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  }
  console.log('Dedicated local test database is ready.');
} finally {
  await pool.end();
}
