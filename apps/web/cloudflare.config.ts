import { bindings, defineConfig, defineWorker, triggers } from 'cf/config';
import { cloudflareSettings, installation } from '../../scripts/installation.ts';
import { realtimeWorker } from '../realtime/cloudflare.config.ts';

export default defineConfig({
  accountId: installation('production').CLOUDFLARE_ACCOUNT_ID,
  worker: defineWorker(({ mode }) => {
    const config = cloudflareSettings(mode);
    return {
      name: config.web,
      domains: config.domains,
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
        MEDIA: bindings.r2({ name: config.bucket }),
        IMAGES: bindings.images(),
        HYPERDRIVE: bindings.hyperdrive({
          id: config.hyperdriveId,
          dev: { connectionString: config.databaseUrl },
        }),
        ROOMS: bindings.durableObject({ worker: realtimeWorker, exportName: 'StoryRoom' }),
        CLERK_SECRET_KEY: bindings.secret(),
        VITE_CLERK_PUBLISHABLE_KEY: bindings.secret(),
        APP_URL: bindings.text(config.appUrl),
        EXTERNAL_OPTION_HOSTS: bindings.text(config.optionHosts),
        WEBHOOK_HOSTS: bindings.text(config.webhookHosts),
        WEBHOOK_ENCRYPTION_KEY: bindings.secret(),
      },
    };
  }),
});
