import { env } from '#platform';
import { authenticateSession, createServices } from '../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse, readJson } from '../../../lib/http';
import type { Space } from '@storypane/core';

async function handle(request: Request) {
  const services = createServices();
  try {
    const session = await authenticateSession(request, services);
    const installation = services.installation;
    const actor = { userId: session.user.id, sessionId: session.session.id };
    if (request.method === 'PUT') {
      assertOrigin(request, env.APP_URL);
      const input = (await readJson(request)) as { id: string; connectionString: string };
      await installation.updateConnection(session.user.id, input.id, input.connectionString);
      return jsonResponse({ ok: true });
    }
    if (request.method === 'POST') {
      assertOrigin(request, env.APP_URL);
      const result = await installation.provision(session.user.id, await readJson(request));
      await services.selectSpace(result.id);
      return jsonResponse(
        {
          ...(await services.store.getSpace({ ...actor, spaceId: result.id, role: 'admin' })),
          provisioningStatus: result.status,
        },
        201,
      );
    }
    const admin = await installation.isAdmin(session.user.id);
    const spaces: Space[] = [];
    const unavailable = await installation.forEachSpace(async (id) => {
      const selected = await installation.acquire(id, services.clerkChecks);
      try {
        const entries = await selected.store.listSpaces(actor);
        spaces.push(
          ...entries.map((space) => ({ ...space, provisioningStatus: 'ready' as const })),
        );
      } finally {
        await selected.close();
      }
    });
    if (admin)
      for (const row of await installation.directory()) {
        if (!spaces.some((space) => space.id === row.id))
          spaces.push({
            id: row.id,
            name: row.name,
            description: row.description,
            role: '',
            roleName: unavailable.includes(row.id) ? 'Unavailable' : row.status,
            permissions: [],
            createdAt: row.created_at.toISOString(),
            storyCount: 0,
            memberCount: 0,
            provisioningStatus: row.status,
            provisioningMode: row.mode,
          });
      }
    return jsonResponse(spaces.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}
export { handle as GET, handle as POST, handle as PUT };
