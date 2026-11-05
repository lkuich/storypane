import { env } from '#platform';
import { Pool } from 'pg';
import { StorypaneError, type Actor, type Space } from '@storypane/core';
import { StorypaneStore } from '@storypane/db';
import { createClerkClient } from '@clerk/backend';
import { clerkSession } from './clerk-auth';

let auth: ReturnType<typeof createClerkClient> | undefined;

export function createServices() {
  const db = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 3 });
  db.on('error', (error) => {
    // pg-cloudflare can reject its pending read when pool.end() closes the socket.
    if (db.ending && error.message === 'This socket has been closed.') return;
    console.error('Database connection error', error.message);
  });
  return {
    db,
    store: new StorypaneStore(db, {
      externalOptionHosts: env.EXTERNAL_OPTION_HOSTS.split(',')
        .map((host) => host.trim())
        .filter(Boolean),
      webhookHosts: (env.WEBHOOK_HOSTS ?? '')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
      webhookEncryptionKey: env.WEBHOOK_ENCRYPTION_KEY,
    }),
    auth: (auth ??= createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.VITE_CLERK_PUBLISHABLE_KEY,
    })),
  };
}

export async function authenticateSession(
  request: Request,
  services: ReturnType<typeof createServices>,
) {
  const session = await clerkSession(request, services.db, services.auth, env.APP_URL);
  if (!session) throw new StorypaneError('unauthenticated', 'Sign in to continue.');
  return session;
}

export async function authenticate(request: Request, services: ReturnType<typeof createServices>) {
  const session = await authenticateSession(request, services);
  const requestedSpace =
    request.headers.get('x-storypane-space-id') ?? new URL(request.url).searchParams.get('space');
  if (
    requestedSpace !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedSpace)
  )
    throw new StorypaneError('invalid', 'Invalid space ID');
  const { rows } = await services.db.query<
    Pick<Space, 'id' | 'name' | 'role' | 'roleName' | 'permissions' | 'contentScopes'>
  >(
    'SELECT s.id,s.name,m.role,r.name AS "roleName",r.permissions,r.content_scopes AS "contentScopes" FROM spaces s JOIN memberships m ON m.space_id=s.id JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role WHERE m.user_id=$1 AND ($2::uuid IS NULL OR s.id=$2::uuid) ORDER BY s.created_at LIMIT 1',
    [session.user.id, requestedSpace],
  );
  const space = rows[0];
  if (!space) throw new StorypaneError('forbidden', 'You do not have access to this space.');
  const actor: Actor = {
    userId: session.user.id,
    sessionId: session.session.id,
    spaceId: space.id,
    role: space.role,
  };
  return { actor, session, space };
}
