import { startProdServer } from 'vinext/server/prod-server';
import { validateEnvironment } from '@storypane/runtime-node';
import { attachNodeServices } from './node-services';

validateEnvironment();
const { server } = await startProdServer({
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  outDir: new URL('../dist', import.meta.url).pathname,
});
const stop = attachNodeServices(server);
async function shutdown() {
  await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())), stop()]);
  process.exit(0);
}
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
