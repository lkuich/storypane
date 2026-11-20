import { env } from '#platform';
import { acceptAccountInvitation, listAccountInvitations } from '@storypane/db/accept-invitation';
import { authenticateSession, createServices } from '../../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse, readJson } from '../../../../lib/http';

async function handle(request: Request) {
  const services = createServices();
  try {
    const accepting = request.method === 'POST';
    if (accepting) assertOrigin(request, env.APP_URL);
    const session = await authenticateSession(request, services);
    const { installation } = services;
    return jsonResponse(
      accepting
        ? await acceptAccountInvitation(installation, await readJson(request), session.user.id)
        : await listAccountInvitations(installation, session.user.id),
    );
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}

export { handle as GET, handle as POST };
