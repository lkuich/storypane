import { createServer } from 'vite';
import { Server } from 'node:http';
import { validateEnvironment } from '@storypane/runtime-node';
import { attachNodeServices } from './node-services';

validateEnvironment();
let stop: (() => Promise<void>) | undefined;
const vite = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  plugins: [
    {
      name: 'storypane-node-services',
      configureServer(server) {
        if (!(server.httpServer instanceof Server))
          throw new Error('Node development requires an HTTP server');
        const stopCurrent = attachNodeServices(server.httpServer);
        stop = stopCurrent;
        server.httpServer.once('close', () => {
          void stopCurrent();
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: Number(process.env.PORT || 3130), strictPort: true },
});
await vite.listen();
vite.printUrls();
async function shutdown() {
  await stop?.();
  await vite.close();
  process.exit(0);
}
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
