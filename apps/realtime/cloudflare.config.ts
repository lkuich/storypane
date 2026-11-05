import { bindings, defineConfig, defineWorker } from 'cf/config';
import { cloudflareSettings, installation } from '../../scripts/installation.ts';

export const realtimeWorker = defineWorker(({ mode }) => {
  const config = cloudflareSettings(mode);
  return {
    name: config.realtime,
    entrypoint: new URL('./src/index.ts', import.meta.url).pathname,
    compatibilityDate: '2026-11-03',
    compatibilityFlags: ['nodejs_compat'],
    observability: { enabled: true, traces: { enabled: true } },
    env: {
      HYPERDRIVE: bindings.hyperdrive({
        id: config.hyperdriveId,
        dev: { connectionString: config.databaseUrl },
      }),
    },
    exports: { StoryRoom: { type: 'durable-object', storage: 'sqlite' } },
  };
});
export default defineConfig({
  accountId: installation('production').CLOUDFLARE_ACCOUNT_ID,
  worker: realtimeWorker,
});
