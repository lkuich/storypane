import { Pool } from 'pg'
import { migrate } from '@storypane/db/migrate'

const connectionString = process.env.DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok'
const target = new URL(connectionString)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/blok') throw new Error('Local setup only runs against the local blok database.')
const db = new Pool({ connectionString })
try {
  await migrate(db)
  console.log('Database ready. Sign in with Clerk and create a space. Existing content and memberships are preserved.')
} finally { await db.end() }
