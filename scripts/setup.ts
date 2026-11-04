import { Pool } from 'pg';
import { migrate } from '@storypane/db/migrate';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://storypane:storypane@127.0.0.1:55432/storypane';
const target = new URL(connectionString);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}`
) {
  throw new Error('Local setup only runs against the local CMS database.');
}
const db = new Pool({ connectionString });
try {
  await migrate(db);
  console.log(
    'Database ready. Sign in with Clerk and create a space. Existing content and memberships are preserved.',
  );
} finally {
  await db.end();
}
