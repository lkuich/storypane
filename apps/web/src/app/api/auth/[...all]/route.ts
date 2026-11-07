import { env } from '#platform';
import { authenticateSession, createServices } from '../../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse, readJson } from '../../../../lib/http';
import { acceptInvitation } from '@storypane/db/accept-invitation';
import { StorypaneError } from '@storypane/core';

async function handle(request: Request) {
  const services = createServices();
  try {
    const path = new URL(request.url).pathname;
    if (path === '/api/auth/config' && request.method === 'GET')
      return jsonResponse(services.authentication.config());
    await services.installation.assertProvider();
    if (path === '/api/auth/accept-invitation' && request.method === 'POST') {
      assertOrigin(request, env.APP_URL);
      await services.installation.authAttempt(
        `invitation:${((await readJson(request.clone())) as { token?: unknown }).token ?? 'anonymous'}`,
      );
      let userId: string | undefined;
      try {
        userId = (await authenticateSession(request, services)).user.id;
      } catch (error) {
        if (!(error instanceof StorypaneError) || error.code !== 'unauthenticated') throw error;
      }
      return jsonResponse(
        await acceptInvitation(services.installation, await readJson(request), userId),
      );
    }
    const response = await services.authentication.handle(request, {
      assertOrigin: (value) => assertOrigin(value, env.APP_URL),
      readJson,
      rateLimit: (subject) => services.installation.authAttempt(subject),
    });
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}
export { handle as GET, handle as POST };
