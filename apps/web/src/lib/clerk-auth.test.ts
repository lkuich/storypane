import { beforeEach, expect, it, vi } from 'vitest';
import { clerkSession } from './clerk-auth';
import type { Pool } from 'pg';
import type { createClerkClient } from '@clerk/backend';

const query = vi.fn(async (_sql: string, _args?: unknown[]) => ({
  rows: [] as Record<string, unknown>[],
  rowCount: 0,
}));
const release = vi.fn();
const db = { query, connect: async () => ({ query, release }) } as unknown as Pool;
const auth = {
  userId: 'clerk-user',
  sessionId: 'clerk-session',
  sessionClaims: { exp: Math.floor(Date.now() / 1000) + 300 },
};
const user = {
  imageUrl: 'https://img.clerk.com/alice.png',
  id: 'clerk-user',
  externalId: null as string | null,
  firstName: 'Alice',
  lastName: null,
  primaryEmailAddressId: 'email',
  emailAddresses: [
    { id: 'email', emailAddress: 'alice@example.com', verification: { status: 'verified' } },
  ],
  banned: false,
  locked: false,
};
const clerk = {
  authenticateRequest: vi.fn(),
  sessions: { getSession: vi.fn() },
  users: { getUser: vi.fn() },
};
const run = (installation = false) =>
  clerkSession(
    new Request('https://cms.test/api/session'),
    db,
    clerk as unknown as ReturnType<typeof createClerkClient>,
    'https://cms.test',
    installation,
  );
beforeEach(() => {
  vi.clearAllMocks();
  user.externalId = null;
  user.banned = false;
  user.emailAddresses[0]!.verification.status = 'verified';
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  clerk.authenticateRequest.mockResolvedValue({ isAuthenticated: true, toAuth: () => auth });
  clerk.sessions.getSession.mockResolvedValue({ status: 'active', userId: auth.userId });
  clerk.users.getUser.mockResolvedValue(user);
});
it('rejects old cookies and unsigned requests before touching the database', async () => {
  clerk.authenticateRequest.mockResolvedValue({ isAuthenticated: false });
  await expect(run()).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(query).not.toHaveBeenCalled();
});
it('verifies the application origin and bounds socket authorization to sixty seconds', async () => {
  const before = Date.now();
  expect((await run()).user.id).toBe('clerk-user');
  expect(query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO "user"'))![1]![4]).toBe(
    user.imageUrl,
  );
  expect(clerk.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
    authorizedParties: ['https://cms.test'],
    acceptsToken: 'session_token',
  });
  const grant = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO cms_sessions'))!;
  const expiry = grant[1]![2] as Date;
  expect(expiry.getTime()).toBeGreaterThan(before);
  expect(expiry.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
});
it('removes a revoked session grant', async () => {
  clerk.sessions.getSession.mockResolvedValue({ status: 'revoked', userId: auth.userId });
  await expect(run()).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(query).toHaveBeenCalledWith('DELETE FROM cms_sessions WHERE id=$1', ['clerk-session']);
});
it('requires email verification', async () => {
  user.emailAddresses[0]!.verification.status = 'unverified';
  await expect(run()).rejects.toMatchObject({ code: 'forbidden' });
  expect(query).not.toHaveBeenCalled();
});
it('does not invent a local identity for an unknown imported account', async () => {
  user.externalId = 'missing';
  await expect(run()).rejects.toMatchObject({ code: 'forbidden' });
  expect(query).toHaveBeenCalledWith('ROLLBACK');
  expect(release).toHaveBeenCalled();
});

it('preserves the administrator-assigned external ID for imported memberships', async () => {
  user.externalId = 'legacy-admin';
  query.mockImplementation(async (sql) =>
    sql.startsWith('SELECT id,clerk_user_id')
      ? { rows: [{ id: 'legacy-admin', clerk_user_id: null }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  );
  expect((await run()).user.id).toBe('legacy-admin');
  expect(query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO cms_sessions'))![1]![1]).toBe(
    'legacy-admin',
  );
});
it('rejects linking to an identity already owned by another Clerk account', async () => {
  user.externalId = 'legacy-admin';
  query.mockImplementation(async (sql) =>
    sql.startsWith('SELECT id,clerk_user_id')
      ? { rows: [{ id: 'legacy-admin', clerk_user_id: 'different-user' }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  );
  await expect(run()).rejects.toMatchObject({ code: 'forbidden' });
});

it('shares concurrent identity lookups but checks revocation again for the next request', async () => {
  let finish!: (session: { status: string; userId: string }) => void;
  clerk.sessions.getSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = run(),
    second = run();
  await vi.waitFor(() => expect(clerk.sessions.getSession).toHaveBeenCalledTimes(1));
  finish({ status: 'active', userId: auth.userId });
  await Promise.all([first, second]);
  expect(clerk.authenticateRequest).toHaveBeenCalledTimes(2);
  expect(clerk.users.getUser).toHaveBeenCalledTimes(1);
  clerk.sessions.getSession.mockResolvedValue({ status: 'revoked', userId: auth.userId });
  await expect(run()).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(clerk.sessions.getSession).toHaveBeenCalledTimes(2);
});

it('does not reuse failed identity checks', async () => {
  clerk.sessions.getSession.mockRejectedValueOnce(new Error('Rate limited'));
  const results = await Promise.allSettled([run(), run()]);
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
  expect((await run()).user.id).toBe(auth.userId);
  expect(clerk.sessions.getSession).toHaveBeenCalledTimes(2);
});

it('does not share identity lookups between sessions', async () => {
  clerk.authenticateRequest.mockResolvedValueOnce({
    isAuthenticated: true,
    toAuth: () => ({ ...auth, sessionId: 'other-session' }),
  });
  await Promise.all([run(), run()]);
  expect(clerk.sessions.getSession).toHaveBeenCalledTimes(2);
  expect(clerk.sessions.getSession).toHaveBeenCalledWith('other-session');
  expect(clerk.sessions.getSession).toHaveBeenCalledWith(auth.sessionId);
});

it('keeps installation identities separate from space invitation authority', async () => {
  await run(true);
  expect(query.mock.calls.some(([sql]) => sql.includes('space_invitations'))).toBe(false);
});
it('rejects a disabled installation account without committing a session grant', async () => {
  query.mockImplementation(async (sql) => ({
    rows: sql.startsWith('SELECT disabled') ? [{ disabled: true }] : [],
    rowCount: 1,
  }));
  await expect(run(true)).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(query).toHaveBeenCalledWith('ROLLBACK');
  expect(query).not.toHaveBeenCalledWith('COMMIT');
});
