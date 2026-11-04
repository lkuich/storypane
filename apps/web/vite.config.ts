import { defineConfig } from 'vite';
import vinext from 'vinext';
import { cloudflare } from '@cloudflare/vite-plugin';
import { realtimeWorker } from '../realtime/cloudflare.config.ts';

export default defineConfig(({ mode }) => ({
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      auxiliaryWorkers: [{ config: realtimeWorker({ mode, isPreview: false }) }],
      persistState: { path: '../../.cloudflare/state' },
      inspectorPort: false,
    }),
  ],
}));
