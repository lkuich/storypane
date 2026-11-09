import { startProdServer } from 'vinext/server/prod-server';
import { once } from 'node:events';
import { validateEnvironment } from '@storypane/runtime-node';
import { attachNodeServices } from './node-services';
import { createDeliveryServer } from './delivery-server';

const service = process.env.STORYPANE_SERVICE ?? 'combined';
if (!['combined', 'delivery'].includes(service))
  throw new Error('STORYPANE_SERVICE must be combined or delivery');
validateEnvironment();
const options = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  outDir: new URL('../dist', import.meta.url).pathname,
};
const server =
  service === 'delivery' ? createDeliveryServer() : (await startProdServer(options)).server;
if (service === 'delivery') {
  await once(server.listen(options.port, options.host), 'listening');
  console.log(`Storypane delivery listening on ${options.host}:${options.port}`);
}
const stop = service === 'delivery' ? async () => {} : await attachNodeServices(server);
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
