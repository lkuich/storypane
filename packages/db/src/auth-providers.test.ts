import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createAuthentication } from './auth-providers';
import { Installation, authProvider } from './installation';
import type { Authentication } from './authentication';

it('validates provider names and fails closed when no implementation is installed', () => {
  expect(authProvider('okta')).toBe('okta');
  expect(() => authProvider('../okta')).toThrow();
  const pool = new Pool();
  expect(() =>
    createAuthentication({ pool, provider: 'okta', appURL: 'https://cms.test' }),
  ).toThrow('No authentication implementation');
});

it('keeps provider binding and local disabled-account checks outside a custom adapter', async () => {
  const adapter: Authentication = {
    config: () => ({ provider: 'redirect', name: 'Okta', signInPath: '/api/auth/sign-in/okta' }),
    getSession: vi.fn(),
    assertSession: vi.fn(),
    assertIdentity: vi.fn(),
    handle: vi.fn(),
  };
  const factory = vi.fn(() => adapter);
  const installation = new Installation({
    provider: 'okta',
    authentication: factory,
    connectionString: 'postgresql://unused',
    encryptionKey: randomBytes(32).toString('base64'),
  });
  let disabled = false,
    provider = 'okta';
  vi.spyOn(installation.pool, 'query').mockImplementation(
    async (sql) =>
      ({
        rows: String(sql).includes('installation_config')
          ? [{ auth_provider: provider }]
          : disabled
            ? []
            : [{ id: 'local-user' }],
        rowCount: disabled ? 0 : 1,
      }) as never,
  );
  try {
    const actor = { userId: 'local-user', sessionId: 'remote-session' };
    const scope = installation.authentication();
    await installation.assertSession(actor, scope);
    await installation.assertIdentity(actor.userId, scope);
    expect(adapter.assertSession).toHaveBeenCalledWith(actor);
    expect(adapter.assertIdentity).toHaveBeenCalledWith(actor.userId);
    disabled = true;
    await expect(installation.assertSession(actor, scope)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(installation.assertIdentity(actor.userId, scope)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(adapter.assertSession).toHaveBeenCalledTimes(1);
    disabled = false;
    provider = 'clerk';
    await expect(installation.assertSession(actor, scope)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(factory).toHaveBeenCalledOnce();
  } finally {
    await installation.pool.end();
    vi.restoreAllMocks();
  }
});

it('preserves local route restrictions, origin enforcement, JSON bounds and rate limiting', async () => {
  const pool = new Pool();
  const adapter = createAuthentication({ pool, provider: 'local', appURL: 'https://cms.test' });
  await expect(
    adapter.getSession(
      new Request('https://cms.test', {
        headers: { authorization: 'Bearer unrelated-credential' },
      }),
    ),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
  const tools = { assertOrigin: vi.fn(), readJson: vi.fn(), rateLimit: vi.fn() };
  const request = new Request('https://cms.test/api/auth/callback/okta', { method: 'POST' });
  expect((await adapter.handle(request, tools)).status).toBe(404);
  const signIn = new Request('https://cms.test/api/auth/sign-in/email', { method: 'POST' });
  tools.assertOrigin.mockImplementationOnce(() => {
    throw new Error('bad origin');
  });
  await expect(adapter.handle(signIn, tools)).rejects.toThrow('bad origin');
  expect(tools.readJson).not.toHaveBeenCalled();
  tools.readJson.mockRejectedValueOnce(new Error('oversized JSON'));
  await expect(adapter.handle(signIn, tools)).rejects.toThrow('oversized JSON');
  tools.readJson.mockResolvedValue({ email: 'EDITOR@EXAMPLE.COM' });
  tools.rateLimit.mockRejectedValueOnce(new Error('rate limited'));
  await expect(adapter.handle(signIn, tools)).rejects.toThrow('rate limited');
  expect(tools.rateLimit).toHaveBeenCalledWith('/api/auth/sign-in/email:editor@example.com');
  await pool.end();
});
