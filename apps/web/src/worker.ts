import app from 'vinext/server/fetch-handler';
import { authenticate, createServices } from './lib/context';
import { assertOrigin, errorResponse } from './lib/http';

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    if (
      new URL(request.url).pathname === '/api/preview/live' &&
      request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ) {
      const services = createServices();
      try {
        const protocols = (request.headers.get('sec-websocket-protocol') ?? '')
          .split(',')
          .map((value) => value.trim());
        const preview = await services.store.authenticatePreview(
          protocols.find((value) => value.startsWith('bp_')) ?? '',
          request.headers.get('origin') ?? '',
        );
        const actor = {
          spaceId: preview.spaceId,
          userId: 'preview',
          sessionId: preview.id,
          role: 'editor',
        };
        const room = env.ROOMS.getByName(
          `${preview.spaceId}:${preview.storyId}:${preview.localeId}`,
        );
        return await room.fetch(
          new Request('https://room/preview-live', {
            headers: {
              upgrade: 'websocket',
              'x-blok-actor': JSON.stringify(actor),
              'x-blok-preview-id': preview.id,
              'x-blok-story-id': preview.storyId,
              'x-blok-locale-id': preview.localeId,
            },
          }),
        );
      } catch (error) {
        return errorResponse(error);
      } finally {
        await services.db.end();
      }
    }
    const path = new URL(request.url).pathname.match(
      /^\/api\/cms\/stories\/([0-9a-f-]{36})\/locales\/([0-9a-f-]{36})\/live$/i,
    );
    // WebSocket upgrades must bypass the framework's HTTP response cloning.
    if (path && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const services = createServices();
      try {
        assertOrigin(request, env.APP_URL);
        const { actor } = await authenticate(request, services);
        const [, storyId, localeId] = path;
        await services.store.getSnapshot(actor, storyId, localeId);
        const room = env.ROOMS.getByName(`${actor.spaceId}:${storyId}:${localeId}`);
        return await room.fetch(
          new Request('https://room/live', {
            headers: {
              upgrade: 'websocket',
              'x-blok-actor': JSON.stringify(actor),
              'x-blok-story-id': storyId,
              'x-blok-locale-id': localeId,
            },
          }),
        );
      } catch (error) {
        return errorResponse(error);
      } finally {
        await services.db.end();
      }
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
