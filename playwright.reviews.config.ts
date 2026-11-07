import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
export default defineConfig({
  testDir: './tests',
  testMatch: 'reviews.e2e.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: { channel: 'chrome', trace: 'retain-on-failure', actionTimeout: 10000 },
  reporter: 'list',
});
