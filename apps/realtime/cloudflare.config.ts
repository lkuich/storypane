import { bindings, defineConfig, defineWorker } from 'cf/config';
import { existsSync } from 'node:fs';

const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export const realtimeWorker = defineWorker(({ mode }) => ({
  name:
    mode === 'production'
      ? 'storypane-realtime'
      : (process.env.STORYPANE_REALTIME_WORKER_NAME ?? 'storypane-realtime'),
  entrypoint: new URL('./src/index.ts', import.meta.url).pathname,
  compatibilityDate: '2026-11-03',
  compatibilityFlags: ['nodejs_compat'],
  observability: { enabled: true, traces: { enabled: true } },
  env: {
    HYPERDRIVE: bindings.hyperdrive({
      id:
        process.env.HYPERDRIVE_ID ??
        (mode === 'production'
          ? 'dba85d3dab20441c9d23c8e813b6c27b'
          : '00000000000000000000000000000000'),
      dev: {
        connectionString:
          process.env.DATABASE_URL ?? 'postgresql://storypane:storypane@127.0.0.1:55432/storypane',
      },
    }),
  },
  exports: { StoryRoom: { type: 'durable-object', storage: 'sqlite' } },
}));

export default defineConfig({
  accountId: 'c813587edc389800e834e0c261a91ef5',
  worker: realtimeWorker,
});
