import { Pool } from 'pg';
import { migrate } from '@storypane/db/migrate';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; no local fallback');
const db = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(db);
  console.log('Database migrations applied.');
} finally {
  await db.end();
}
