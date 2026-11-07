import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'webhooks.recovery.ts',
  workers: 1,
  timeout: 180_000,
  use: { channel: 'chrome', trace: 'off', actionTimeout: 15_000, navigationTimeout: 30_000 }, // The one-time signing secret must stay out of traces.
});
