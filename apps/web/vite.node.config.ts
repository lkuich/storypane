import { defineConfig } from 'vite';
import vinext from 'vinext';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// vinext treats a Cloudflare config in the build root as a mandatory Workers target.
const root = new URL('./.node/', import.meta.url);
mkdirSync(root, { recursive: true });
writeFileSync(
  new URL('package.json', root),
  readFileSync(new URL('./package.json', import.meta.url)),
);
export default defineConfig({
  root: root.pathname,
  publicDir: new URL('./public', import.meta.url).pathname,
  plugins: [
    {
      name: 'storypane-node-platform',
      enforce: 'pre',
      resolveId(id) {
        if (id === '#platform') return { id: '@storypane/runtime-node', external: true };
      },
    },
    vinext({
      appDir: new URL('./src', import.meta.url).pathname,
      nextConfig: { output: 'standalone' },
    }),
  ],
  resolve: { conditions: ['storypane-node'] },
  ssr: { external: ['@storypane/runtime-node'] },
});
