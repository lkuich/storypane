import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Pool } from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { migrate } from '@storypane/db/migrate'
import { StorypaneStore } from '@storypane/db'
import { createAuth } from '../apps/web/src/lib/auth'

if (existsSync('.env')) process.loadEnvFile('.env')
const connectionString = process.env.DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok'
const target = new URL(connectionString)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/blok') throw new Error('Local setup only runs against the local blok database. Use reviewed migrations and account provisioning for a deployment.')
const secretsPath = 'apps/web/.dev.vars'
mkdirSync('apps/web', { recursive: true })
if (!existsSync(secretsPath)) writeFileSync(secretsPath, `AUTH_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 })
const secret = readFileSync(secretsPath, 'utf8').match(/^AUTH_SECRET=(.+)$/m)?.[1]
if (!secret) throw new Error('Missing AUTH_SECRET in apps/web/.dev.vars')
const db = new Pool({ connectionString })
try {
  const auth = createAuth(db, secret, 'http://127.0.0.1:3130', true)
  const authMigrations = await getMigrations(auth.options)
  await authMigrations.runMigrations()
  await migrate(db)
  const users = [
    { email: 'admin@blok.local', name: 'Local Admin', password: (process.env.STORYPANE_ADMIN_PASSWORD ?? process.env.BLOK_ADMIN_PASSWORD) ?? 'blok-local-admin', role: 'admin' as const },
    { email: 'editor@blok.local', name: 'Local Editor', password: (process.env.STORYPANE_EDITOR_PASSWORD ?? process.env.BLOK_EDITOR_PASSWORD) ?? 'blok-local-editor', role: 'editor' as const },
  ]
  const spaceId = '11111111-1111-4111-8111-111111111111'
  for (const user of users) {
    const existing = await db.query('SELECT id FROM "user" WHERE email=$1', [user.email])
    const userId = existing.rows[0]?.id ?? (await auth.api.signUpEmail({ body: { email: user.email, password: user.password, name: user.name } })).user.id
    if (user.role === 'admin') await new StorypaneStore(db).seed({ userId, sessionId: 'local-setup', spaceId, role: 'admin' })
    await db.query('INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(space_id,user_id) DO NOTHING', [spaceId, userId, user.role])
  }
  console.log('Local database, authentication, and sample content are ready. Sign-in details are in README.md.')
} finally { await db.end() }
