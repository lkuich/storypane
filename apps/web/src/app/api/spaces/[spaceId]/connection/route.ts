import { env } from '#platform';
import { authenticateSession, createServices } from '../../../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse } from '../../../../../lib/http';

async function handle(request: Request, route: { params: Promise<{ spaceId: string }> }) {
  const services = createServices();
  try {
    const reveal = request.method === 'POST';
    if (reveal) assertOrigin(request, env.APP_URL);
    const session = await authenticateSession(request, services);
    const { spaceId } = await route.params;
    return jsonResponse(
      await services.installation.connectionDetails(session.user.id, spaceId, reveal),
    );
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}

export { handle as GET, handle as POST };
