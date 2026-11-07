import { StorypaneError, type Actor } from '@storypane/core';
import { getInstallation } from '@storypane/db/installation';
export function createServices() {
  const installation = getInstallation();
  const authentication = installation.authentication();
  let selected: Awaited<ReturnType<typeof installation.acquire>> | undefined;
  let spaceId: string | undefined;
  return {
    installation,
    get db() {
      if (!selected) throw new StorypaneError('invalid', 'Select a space');
      return selected.db;
    },
    get store() {
      if (!selected) throw new StorypaneError('invalid', 'Select a space');
      return selected.store;
    },
    authentication,
    async selectSpace(id: string) {
      if (selected) {
        if (id !== spaceId) throw new StorypaneError('forbidden', 'Request space mismatch');
        return;
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        throw new StorypaneError('invalid', 'Invalid space ID');
      selected = await installation.acquire(id, authentication);
      spaceId = id;
    },
    async close() {
      await selected?.close();
    },
  };
}
export function requestedSpace(request: Request) {
  return (
    request.headers.get('x-storypane-space-id') ??
    new URL(request.url).searchParams.get('space') ??
    ''
  );
}
export async function authenticateSession(
  request: Request,
  services: ReturnType<typeof createServices>,
) {
  await services.installation.assertProvider();
  const session = await services.authentication.getSession(request);
  if (!session) throw new StorypaneError('unauthenticated', 'Sign in to continue.');
  await services.installation.assertSession(
    {
      userId: session.user.id,
      sessionId: session.session.id,
    },
    services.authentication,
  );
  return session;
}
export async function authenticate(request: Request, services: ReturnType<typeof createServices>) {
  const session = await authenticateSession(request, services);
  await services.selectSpace(requestedSpace(request));
  await services.installation.syncProfile(services.db, session.user.id);
  const actor: Actor = {
    userId: session.user.id,
    sessionId: session.session.id,
    spaceId: requestedSpace(request),
    role: '',
  };
  const space = await services.store.getSpace(actor);
  actor.role = space.role;
  return { actor, session, space: { ...space, provisioningStatus: 'ready' as const } };
}
