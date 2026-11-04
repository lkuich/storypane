import { env } from 'cloudflare:workers'
import { Pool } from 'pg'
import { StorypaneError, type Actor } from '@storypane/core'
import { StorypaneStore } from '@storypane/db'
import { createAuth } from './auth'

export function createServices() {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error('Run pnpm db:setup to create the local auth secret, or configure AUTH_SECRET for deployment.')
  const db = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 3 })
  db.on('error', error => {
    // pg-cloudflare can reject its pending read when pool.end() closes the socket.
    if (db.ending && error.message === 'This socket has been closed.') return
    console.error('Database connection error', error.message)
  })
  return { db, store: new StorypaneStore(db, { externalOptionHosts: env.EXTERNAL_OPTION_HOSTS.split(',').map(host => host.trim()).filter(Boolean) }), auth: createAuth(db, env.AUTH_SECRET, env.APP_URL) }
}

export async function authenticateSession(request: Request, services: ReturnType<typeof createServices>) {
  const session = await services.auth.api.getSession({ headers: request.headers })
  if (!session) throw new StorypaneError('unauthenticated', 'Sign in to continue.')
  return session
}

export async function authenticate(request: Request, services: ReturnType<typeof createServices>) {
  const session = await authenticateSession(request, services)
  const requestedSpace = request.headers.get('x-blok-space-id') ?? new URL(request.url).searchParams.get('space')
  if (requestedSpace !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedSpace)) throw new StorypaneError('invalid', 'Invalid space ID')
  const { rows } = await services.db.query<{ id: string; name: string; role: Actor['role'] }>(
    'SELECT s.id,s.name,m.role FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE m.user_id=$1 AND ($2::uuid IS NULL OR s.id=$2::uuid) ORDER BY s.created_at LIMIT 1',
    [session.user.id, requestedSpace],
  )
  const space = rows[0]
  if (!space) throw new StorypaneError('forbidden', 'You do not have access to this space.')
  const actor: Actor = { userId: session.user.id, sessionId: session.session.id, spaceId: space.id, role: space.role }
  return { actor, session, space }
}
