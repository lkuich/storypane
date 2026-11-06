import { env } from '#platform';
import { authenticateSession, createServices } from '../../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse, readJson } from '../../../../lib/http';
export async function POST(request: Request) {
  const services = createServices();
  try {
    assertOrigin(request, env.APP_URL);
    const session = await authenticateSession(request, services);
    return jsonResponse(
      await services.installation.reviewClone(
        { userId: session.user.id, sessionId: session.session.id },
        await readJson(request),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}
