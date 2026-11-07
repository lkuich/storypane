import { randomBytes } from 'node:crypto';
import type { createClerkClient } from '@clerk/backend';
import { expect, it, vi } from 'vitest';
import { createClerkChecks } from './clerk-checks.js';
import { Installation } from './installation.js';
import { clerkAuthentication } from './auth-providers.js';

type Clerk = ReturnType<typeof createClerkClient>;
function fixture() {
  const user = { id: 'clerk-user', banned: false, locked: false };
  const session = { userId: user.id, status: 'active' };
  const clerk = {
    users: { getUser: vi.fn(async () => ({ ...user })) },
    sessions: { getSession: vi.fn(async () => ({ ...session })) },
  };
  return { user, session, clerk, checks: () => createClerkChecks(clerk as unknown as Clerk) };
}

it('shares remote results within one operation and in-flight calls across operations, not completed results', async () => {
  const f = fixture(),
    first = f.checks(),
    second = f.checks();
  await Promise.all([first.getUser('clerk-user'), second.getUser('clerk-user')]);
  await first.getUser('clerk-user');
  await second.getUser('clerk-user');
  expect(f.clerk.users.getUser).toHaveBeenCalledTimes(1);
  await f.checks().getUser('clerk-user');
  expect(f.clerk.users.getUser).toHaveBeenCalledTimes(2);
  await first.getUser('other-user');
  expect(f.clerk.users.getUser).toHaveBeenLastCalledWith('other-user');
});

it('shares failures only within the operation and retries in a fresh operation', async () => {
  const f = fixture(),
    checks = f.checks();
  f.clerk.users.getUser.mockRejectedValueOnce(new Error('Rate limited'));
  await expect(checks.getUser('clerk-user')).rejects.toThrow('Rate limited');
  await expect(checks.getUser('clerk-user')).rejects.toThrow('Rate limited');
  expect(f.clerk.users.getUser).toHaveBeenCalledTimes(1);
  await expect(f.checks().getUser('clerk-user')).resolves.toMatchObject({ id: 'clerk-user' });
});

it('reuses HTTP auth checks in the store but rechecks local authority on every operation and Clerk on the next request', async () => {
  const f = fixture();
  const installation = new Installation({
    connectionString: 'postgresql://unused',
    encryptionKey: randomBytes(32).toString('base64'),
    provider: 'clerk',
  });
  let disabled = false;
  vi.spyOn(installation.pool, 'query').mockImplementation(
    async (sql) =>
      ({
        rows: String(sql).includes('installation_config')
          ? [{ auth_provider: 'clerk' }]
          : disabled
            ? []
            : [{ clerk_user_id: 'clerk-user' }],
        rowCount: disabled ? 0 : 1,
      }) as never,
  );
  const actor = { userId: 'local-user', sessionId: 'session' };
  try {
    const scope = () =>
      clerkAuthentication(
        installation.pool,
        f.clerk as unknown as Clerk,
        'https://cms.test',
        'test',
      );
    const request = scope();
    await installation.assertSession(actor, request);
    await installation.assertSession(actor, request);
    await installation.assertIdentity(actor.userId, request);
    expect(f.clerk.sessions.getSession).toHaveBeenCalledTimes(1);
    expect(f.clerk.users.getUser).toHaveBeenCalledTimes(1);
    disabled = true;
    await expect(installation.assertSession(actor, request)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    disabled = false;
    f.session.status = 'revoked';
    await expect(installation.assertSession(actor, scope())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    f.session.status = 'active';
    f.user.banned = true;
    await expect(installation.assertSession(actor, scope())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(installation.assertIdentity(actor.userId, scope())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  } finally {
    vi.restoreAllMocks();
    await installation.pool.end();
  }
});
