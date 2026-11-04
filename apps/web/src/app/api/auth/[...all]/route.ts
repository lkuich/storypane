import { env } from 'cloudflare:workers';
import { authenticateSession, createServices } from '../../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse } from '../../../../lib/http';

export async function GET(request: Request) {
  if (new URL(request.url).pathname === '/api/auth/config')
    return jsonResponse({ publishableKey: env.VITE_CLERK_PUBLISHABLE_KEY });
  return new Response('Not found', { status: 404 });
}
export async function POST(request: Request) {
  if (new URL(request.url).pathname !== '/api/auth/sign-out')
    return new Response('Not found', { status: 404 });
  const services = createServices();
  try {
    assertOrigin(request, env.APP_URL);
    const { session } = await authenticateSession(request, services);
    await services.auth.sessions.revokeSession(session.id);
    await services.db.query('DELETE FROM cms_sessions WHERE id=$1', [session.id]);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.db.end();
  }
}
