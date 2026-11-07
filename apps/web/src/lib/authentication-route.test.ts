import { beforeEach, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';
import type { Authentication } from '@storypane/db/authentication';

const mocks = vi.hoisted(() => ({
  provider: { value: 'okta' },
  getSession: vi.fn(),
  assertSession: vi.fn(),
  assertIdentity: vi.fn(),
  handler: vi.fn(),
  config: vi.fn(),
  assertProvider: vi.fn(),
  acquire: vi.fn(),
  syncProfile: vi.fn(),
  getSpace: vi.fn(),
  close: vi.fn(),
  authAttempt: vi.fn(),
  acceptInvitation: vi.fn(),
}));
vi.mock('#platform', () => ({ env: { APP_URL: 'https://cms.test' } }));
const authentication: Authentication = {
  config: mocks.config,
  getSession: mocks.getSession,
  assertSession: mocks.assertSession,
  assertIdentity: mocks.assertIdentity,
  handle: mocks.handler,
};
vi.mock('@storypane/db/installation', () => ({
  getInstallation: () => ({
    options: { provider: mocks.provider.value },
    authentication: () => ({
      config: mocks.config,
      getSession: mocks.getSession,
      assertSession: mocks.assertSession,
      assertIdentity: mocks.assertIdentity,
      handle: mocks.handler,
    }),
    assertProvider: mocks.assertProvider,
    assertSession: async (actor: unknown, scope: Authentication) =>
      scope.assertSession(actor as never),
    acquire: mocks.acquire,
    syncProfile: mocks.syncProfile,
    authAttempt: mocks.authAttempt,
  }),
}));
vi.mock('@storypane/db/accept-invitation', () => ({ acceptInvitation: mocks.acceptInvitation }));
const { GET, POST } = await import('../app/api/auth/[...all]/route');
const { authenticate, authenticateSession, createServices } = await import('./context');
const spaceId = 'a53358b5-83f1-49bb-9921-97070a18842b';
const session = {
  user: { id: 'mapped-user', name: 'Editor', email: 'editor@example.com' },
  session: { id: 'provider-session' },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({
    provider: 'redirect',
    name: 'Okta',
    signInPath: '/api/auth/sign-in/okta',
  });
  mocks.getSession.mockResolvedValue(session);
  mocks.acquire.mockResolvedValue({
    db: {},
    store: { getSpace: mocks.getSpace },
    close: mocks.close,
  });
  mocks.getSpace.mockResolvedValue({ id: spaceId, role: 'editor', permissions: ['content:read'] });
});

it('uses the custom adapter for HTTP sessions and derives the space role from Storypane', async () => {
  const request = new Request(`https://cms.test/api/session?space=${spaceId}`);
  const services = createServices();
  const result = await authenticate(request, services);
  expect(result.actor).toEqual({
    userId: session.user.id,
    sessionId: session.session.id,
    spaceId,
    role: 'editor',
  });
  expect(mocks.acquire).toHaveBeenCalledWith(spaceId, authentication);
  expect(mocks.assertSession).toHaveBeenCalledWith({
    userId: session.user.id,
    sessionId: session.session.id,
  });
  await services.close();
  expect(mocks.close).toHaveBeenCalledOnce();
});

it('rejects missing and revoked custom sessions', async () => {
  mocks.getSession.mockResolvedValueOnce(null);
  await expect(
    authenticateSession(new Request('https://cms.test'), createServices()),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
  mocks.assertSession.mockRejectedValueOnce(new StorypaneError('unauthenticated', 'Revoked'));
  await expect(
    authenticateSession(new Request('https://cms.test'), createServices()),
  ).rejects.toThrow('Revoked');
});

it('returns public redirect configuration without implementation details', async () => {
  const response = await GET(new Request('https://cms.test/api/auth/config'));
  expect(await response.json()).toEqual(authentication.config());
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('delegates form callbacks to the adapter without weakening invitation origin checks', async () => {
  mocks.handler.mockImplementation(async (request: Request) => {
    expect(await request.text()).toBe('code=example&state=example');
    return Response.redirect('https://cms.test/', 303);
  });
  const response = await POST(
    new Request('https://cms.test/api/auth/callback/okta', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=example&state=example',
    }),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.handler).toHaveBeenCalledOnce();
  const rejected = await POST(
    new Request('https://cms.test/api/auth/accept-invitation', {
      method: 'POST',
      headers: { origin: 'https://wrong.test', 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  expect(rejected.status).toBe(403);
  expect(mocks.acceptInvitation).not.toHaveBeenCalled();
});
