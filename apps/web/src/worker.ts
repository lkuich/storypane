import app from 'vinext/server/fetch-handler';
import { Pool } from 'pg';
import { StorypaneStore } from '@storypane/db';
import { runBackgroundTasks } from './lib/background';
import { liveRequest } from './lib/live';
import { errorResponse } from './lib/http';

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
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      try {
        const live = await liveRequest(request);
        if (live) return await env.ROOMS.getByName(live.name).fetch(live.request);
      } catch (error) {
        return errorResponse(error);
      }
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
