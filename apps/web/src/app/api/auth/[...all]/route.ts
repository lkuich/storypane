import { env } from '#platform';
import { authenticateSession, createServices } from '../../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse, readJson } from '../../../../lib/http';
import { acceptInvitation } from '@storypane/db/accept-invitation';
import { StorypaneError } from '@storypane/core';

async function handle(request: Request) {
  const services = createServices();
  try {
    const path = new URL(request.url).pathname;
    const provider = services.installation.options.provider;
    if (path === '/api/auth/config' && request.method === 'GET')
      return jsonResponse({
        provider,
        ...(provider === 'clerk'
          ? { publishableKey: env.VITE_CLERK_PUBLISHABLE_KEY }
          : { passwordReset: Boolean(process.env.SMTP_URL && process.env.MAIL_FROM) }),
      });
    await services.installation.assertProvider();
    if (request.method === 'POST') {
      assertOrigin(request, env.APP_URL);
      const body = (await readJson(request.clone())) as { email?: unknown; token?: unknown };
      await services.installation.authAttempt(
        `${path}:${typeof body.email === 'string' ? body.email.trim().toLowerCase() : typeof body.token === 'string' ? body.token : 'anonymous'}`,
      );
    }
    if (path === '/api/auth/accept-invitation' && request.method === 'POST') {
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
    if (provider === 'local') {
      const allowed = new Set([
        '/sign-in/email',
        '/sign-out',
        '/get-session',
        '/change-password',
        ...(process.env.SMTP_URL && process.env.MAIL_FROM
          ? ['/request-password-reset', '/reset-password']
          : []),
      ]);
      const suffix = path.slice('/api/auth'.length);
      if (
        !allowed.has(suffix) &&
        !(
          request.method === 'GET' &&
          /^\/reset-password\/[^/]+$/.test(suffix) &&
          process.env.SMTP_URL
        )
      )
        return new Response('Not found', { status: 404 });
      return await services.localAuth.handler(request);
    }
    if (path !== '/api/auth/sign-out' || request.method !== 'POST')
      return new Response('Not found', { status: 404 });
    const { session } = await authenticateSession(request, services);
    await services.auth.sessions.revokeSession(session.id);
    await services.installation.pool.query('DELETE FROM cms_sessions WHERE id=$1', [session.id]);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}
export { handle as GET, handle as POST };
