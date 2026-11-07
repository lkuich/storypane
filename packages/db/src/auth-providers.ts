import { createClerkClient } from '@clerk/backend';
import { StorypaneError } from '@storypane/core';
import type { Pool } from 'pg';
import { localAuth } from './local-auth.js';
import { clerkSession } from './clerk-auth.js';
import { createClerkChecks } from './clerk-checks.js';
import type { Authentication, AuthenticationFactory, AuthRouteTools } from './authentication.js';

const locals = new WeakMap<Pool, ReturnType<typeof localAuth>>();
const clerks = new WeakMap<Pool, ReturnType<typeof createClerkClient>>();
const expired = () => new StorypaneError('unauthenticated', 'Your session has expired');

async function editorPost(request: Request, tools: AuthRouteTools) {
  tools.assertOrigin(request);
  const body = (await tools.readJson(request.clone())) as { email?: unknown; token?: unknown };
  await tools.rateLimit(
    `${new URL(request.url).pathname}:${typeof body.email === 'string' ? body.email.trim().toLowerCase() : typeof body.token === 'string' ? body.token : 'anonymous'}`,
  );
}

export function clerkAuthentication(
  pool: Pool,
  clerk: ReturnType<typeof createClerkClient>,
  appURL: string,
  publishableKey: string,
): Authentication {
  const checks = createClerkChecks(clerk);
  return {
    config: () => ({ provider: 'clerk', publishableKey }),
    getSession: (request) => clerkSession(request, pool, clerk, appURL, true, checks),
    async assertSession(actor) {
      const result = await pool.query(
        'SELECT u.clerk_user_id FROM cms_sessions s JOIN "user" u ON u.id=s.user_id WHERE s.id=$1 AND u.id=$2 AND NOT u.disabled AND s.expires_at>clock_timestamp()',
        [actor.sessionId, actor.userId],
      );
      if (!result.rowCount) throw expired();
      const session = await checks.getSession(actor.sessionId);
      const user = await checks.getUser(result.rows[0].clerk_user_id);
      if (session.status !== 'active' || session.userId !== user.id || user.banned || user.locked)
        throw expired();
    },
    async assertIdentity(userId) {
      const result = await pool.query('SELECT clerk_user_id FROM "user" WHERE id=$1', [userId]);
      if (!result.rows[0]?.clerk_user_id)
        throw new StorypaneError('unauthenticated', 'Account has no Clerk mapping');
      const user = await checks.getUser(result.rows[0].clerk_user_id);
      if (user.banned || user.locked)
        throw new StorypaneError('unauthenticated', 'Account is disabled');
    },
    async handle(request, tools) {
      if (new URL(request.url).pathname !== '/api/auth/sign-out' || request.method !== 'POST')
        return new Response('Not found', { status: 404 });
      await editorPost(request, tools);
      const { session } = await clerkSession(request, pool, clerk, appURL, true, checks);
      await clerk.sessions.revokeSession(session.id);
      await pool.query('DELETE FROM cms_sessions WHERE id=$1', [session.id]);
      return Response.json({ ok: true });
    },
  };
}

// Add a direct provider here; HTTP, rooms and background authorization use the same factory.
export const createAuthentication: AuthenticationFactory = (options) => {
  const { pool, provider, appURL } = options;
  if (provider === 'clerk') {
    let clerk = clerks.get(pool);
    if (!clerk) {
      clerk = createClerkClient({
        secretKey: options.clerkSecretKey,
        publishableKey: options.clerkPublishableKey,
      });
      clerks.set(pool, clerk);
    }
    return clerkAuthentication(pool, clerk, appURL, options.clerkPublishableKey ?? '');
  }
  if (provider !== 'local') throw new Error(`No authentication implementation for ${provider}`);
  const auth = () => {
    let value = locals.get(pool);
    if (!value) {
      value = localAuth(pool, {
        appURL,
        secret: options.secret ?? '',
        smtpURL: options.smtpURL,
        mailFrom: options.mailFrom,
      });
      locals.set(pool, value);
    }
    return value;
  };
  return {
    config: () => ({
      provider: 'local',
      passwordReset: Boolean(options.smtpURL && options.mailFrom),
    }),
    getSession: async (request) => {
      if (request.headers.has('authorization'))
        throw new StorypaneError(
          'unauthenticated',
          'Local authentication requires a browser session',
        );
      return auth().api.getSession({ headers: request.headers });
    },
    async assertSession(actor) {
      const result = await pool.query(
        'SELECT u.id FROM "session" s JOIN "user" u ON u.id=s."userId" WHERE s.id=$1 AND u.id=$2 AND NOT u.disabled AND s."expiresAt">clock_timestamp()',
        [actor.sessionId, actor.userId],
      );
      if (!result.rowCount) throw expired();
    },
    async assertIdentity() {},
    async handle(request, tools) {
      const path = new URL(request.url).pathname.slice('/api/auth'.length);
      const allowed = new Set([
        '/sign-in/email',
        '/sign-out',
        '/get-session',
        '/change-password',
        ...(options.smtpURL && options.mailFrom
          ? ['/request-password-reset', '/reset-password']
          : []),
      ]);
      if (
        !allowed.has(path) &&
        !(request.method === 'GET' && /^\/reset-password\/[^/]+$/.test(path) && options.smtpURL)
      )
        return new Response('Not found', { status: 404 });
      if (request.method === 'POST') await editorPost(request, tools);
      return auth().handler(request);
    },
  };
};
