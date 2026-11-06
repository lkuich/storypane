import { authenticate, authenticateSession, createServices } from '../../../lib/context';
import { errorResponse, jsonResponse } from '../../../lib/http';

export async function GET(request: Request) {
  const services = createServices();
  try {
    const { session, space } = new URL(request.url).searchParams.has('space')
      ? await authenticate(request, services)
      : { session: await authenticateSession(request, services), space: null };
    return jsonResponse({
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
      sessionId: session.session.id,
      installationAdmin: await services.installation.isAdmin(session.user.id),
      space,
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}
