import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/example-next/src', import.meta.url)) } },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
