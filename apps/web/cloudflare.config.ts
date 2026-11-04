import { bindings, defineConfig, defineWorker, triggers } from 'cf/config';
import { realtimeWorker } from '../realtime/cloudflare.config.ts';

export default defineConfig({
  accountId: 'c813587edc389800e834e0c261a91ef5',
  worker: defineWorker({
    name: process.env.STORYPANE_WEB_WORKER_NAME ?? 'storypane-web',
    entrypoint: './src/worker.ts',
    compatibilityDate: '2026-11-03',
    compatibilityFlags: ['nodejs_compat'],
    observability: { enabled: true, traces: { enabled: true } },
    triggers: [triggers.scheduled({ schedule: '* * * * *' })],
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
    },
    env: {
      ASSETS: bindings.assets(),
      MEDIA: bindings.r2({ name: process.env.R2_BUCKET ?? 'storypane-assets' }),
      IMAGES: bindings.images(),
      HYPERDRIVE: bindings.hyperdrive({
        id: process.env.HYPERDRIVE_ID ?? '00000000000000000000000000000000',
        dev: {
          connectionString:
            process.env.DATABASE_URL ??
            'postgresql://storypane:storypane@127.0.0.1:55432/storypane',
        },
      }),
      ROOMS: bindings.durableObject({ worker: realtimeWorker, exportName: 'StoryRoom' }),
      CLERK_SECRET_KEY: bindings.secret(),
      VITE_CLERK_PUBLISHABLE_KEY: bindings.secret(),
      APP_URL: bindings.text(process.env.STORYPANE_APP_URL ?? 'http://127.0.0.1:3130'),
      EXTERNAL_OPTION_HOSTS: bindings.text(process.env.EXTERNAL_OPTION_HOSTS ?? ''),
      WEBHOOK_HOSTS: bindings.text(process.env.WEBHOOK_HOSTS ?? ''),
      WEBHOOK_ENCRYPTION_KEY: bindings.secret(),
    },
  }),
});
