import app from 'vinext/server/fetch-handler';
import { Pool } from 'pg';
import { StorypaneStore } from '@storypane/db';
import { runBackgroundTasks } from './lib/background';
import { authenticate, createServices } from './lib/context';
import { assertOrigin, errorResponse } from './lib/http';

export default {
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env) {
    const db = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 3 });
    db.on('error', (error) => {
      if (db.ending && error.message === 'This socket has been closed.') return;
      console.error('Background database connection error', error.message);
    });
    const store = new StorypaneStore(db);
    try {
      await runBackgroundTasks({
        db,
        publish: () => store.runScheduledPublications(),
        rooms: env.ROOMS,
        webhookEncryptionKey: env.WEBHOOK_ENCRYPTION_KEY,
        webhookHosts: (env.WEBHOOK_HOSTS ?? '')
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      });
    } finally {
      await db.end();
    }
  },
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
              'x-storypane-actor': JSON.stringify(actor),
              'x-storypane-preview-id': preview.id,
              'x-storypane-story-id': preview.storyId,
              'x-storypane-locale-id': preview.localeId,
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
              'x-storypane-actor': JSON.stringify(actor),
              'x-storypane-story-id': storyId,
              'x-storypane-locale-id': localeId,
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
