import { bindings, defineConfig, defineWorker } from 'cf/config';
import { existsSync } from 'node:fs';

const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const realtimeWorker = defineWorker({
  name: 'blok-realtime',
  entrypoint: new URL('./src/index.ts', import.meta.url).pathname,
  compatibilityDate: '2026-11-03',
  compatibilityFlags: ['nodejs_compat'],
  observability: { enabled: true, traces: { enabled: true } },
  env: {
    HYPERDRIVE: bindings.hyperdrive({
      id: process.env.HYPERDRIVE_ID ?? '00000000000000000000000000000000',
      dev: {
        connectionString: process.env.DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok',
      },
    }),
  },
  exports: { StoryRoom: { type: 'durable-object', storage: 'sqlite' } },
});

export default defineConfig({
  accountId: 'c813587edc389800e834e0c261a91ef5',
  worker: realtimeWorker,
});
