import { createClerkClient } from '@clerk/backend';
import { StorypaneError } from '@storypane/core';
import type { Pool } from 'pg';
import { acceptVerifiedEmailInvitations } from '@storypane/db';

type Clerk = ReturnType<typeof createClerkClient>;
type Identity = Awaited<ReturnType<Clerk['users']['getUser']>> | null;
const pendingIdentities = new WeakMap<Clerk, Map<string, Promise<Identity>>>();

function clerkIdentity(clerk: Clerk, userId: string, sessionId: string) {
  let pending = pendingIdentities.get(clerk);
  if (!pending) pendingIdentities.set(clerk, (pending = new Map()));
  const key = JSON.stringify([userId, sessionId]);
  let identity = pending.get(key);
  if (!identity) {
    // Share only concurrent lookups; the next request still checks revocation and account status.
    identity = (async () => {
      const session = await clerk.sessions.getSession(sessionId);
      const user =
        session.status === 'active' && session.userId === userId
          ? await clerk.users.getUser(userId)
          : null;
      return user;
    })().finally(() => pending.delete(key));
    pending.set(key, identity);
  }
  return identity;
}

export async function clerkSession(
  request: Request,
  db: Pool,
  clerk: ReturnType<typeof createClerkClient>,
  appURL: string,
) {
  const state = await clerk.authenticateRequest(request, {
    authorizedParties: [new URL(appURL).origin],
    acceptsToken: 'session_token',
  });
  if (!state.isAuthenticated) throw new StorypaneError('unauthenticated', 'Sign in to continue.');
  const auth = state.toAuth();
  if (!auth?.userId || !auth.sessionId)
    throw new StorypaneError('unauthenticated', 'Sign in to continue.');
  const user = await clerkIdentity(clerk, auth.userId, auth.sessionId);
  if (!user) {
    await db.query('DELETE FROM cms_sessions WHERE id=$1', [auth.sessionId]);
    throw new StorypaneError('unauthenticated', 'Your session has expired.');
  }
  const email = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
  if (!email || email.verification?.status !== 'verified' || user.banned || user.locked)
    throw new StorypaneError('forbidden', 'A verified email address is required.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Only administrator-managed external IDs may link existing accounts; never link by email.
    const localId = user.externalId || user.id;
    const existing = await client.query(
      'SELECT id,clerk_user_id FROM "user" WHERE id=$1 FOR UPDATE',
      [localId],
    );
    if (existing.rows[0]?.clerk_user_id && existing.rows[0].clerk_user_id !== user.id)
      throw new StorypaneError('forbidden', 'This account is linked to a different identity.');
    if (user.externalId && !existing.rowCount)
      throw new StorypaneError('forbidden', 'The imported account has no local identity.');
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || email.emailAddress;
    const avatarUrl = user.imageUrl?.startsWith('https://') ? user.imageUrl : null;
    await client.query(
      `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt",clerk_user_id,avatar_url)
      VALUES ($1,$2,$3,true,now(),now(),$4,$5) ON CONFLICT (id) DO UPDATE SET name=$2,email=$3,"emailVerified"=true,"updatedAt"=now(),clerk_user_id=$4,avatar_url=$5`,
      [localId, name, email.emailAddress, user.id, avatarUrl],
    );
    const expiresAt = new Date(
      Math.min(Number(auth.sessionClaims.exp) * 1000, Date.now() + 60_000),
    );
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
      throw new StorypaneError('unauthenticated', 'Your session has expired.');
    await client.query(
      `INSERT INTO cms_sessions(id,user_id,expires_at) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET expires_at=EXCLUDED.expires_at WHERE cms_sessions.user_id=EXCLUDED.user_id`,
      [auth.sessionId, localId, expiresAt],
    );
    await acceptVerifiedEmailInvitations(client, localId, email.emailAddress);
    await client.query('COMMIT');
    return {
      user: { id: localId, name, email: email.emailAddress },
      session: { id: auth.sessionId },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
