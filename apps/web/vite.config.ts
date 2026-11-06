import { defineConfig } from 'vite';
import vinext from 'vinext';

export default defineConfig({
  root: new URL('./', import.meta.url).pathname,
  plugins: [
    {
      name: 'storypane-node-platform',
      apply: 'build',
      enforce: 'pre',
      resolveId(id) {
        if (id === '#platform') return { id: '@storypane/runtime-node', external: true };
        // Keep SQL paths and the shared resolver/error classes in their source packages.
        if (
          this.environment.name !== 'client' &&
          ['@storypane/db', '@storypane/core'].some(
            (name) => id === name || id.startsWith(`${name}/`),
          )
        )
          return { id, external: true };
      },
    },
    vinext({
      appDir: new URL('./src', import.meta.url).pathname,
      nextConfig: { output: 'standalone' },
    }),
  ],
  environments: Object.fromEntries(
    ['rsc', 'ssr'].map((name) => [
      name,
      {
        resolve: {
          external: ['@storypane/runtime-node', '@storypane/db', '@storypane/core'],
        },
      },
    ]),
  ),
  ssr: { external: ['@storypane/runtime-node', '@storypane/db', '@storypane/core'] },
});
