import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: [
    'webhooks.browser.e2e.ts',
    'permissions.browser.e2e.ts',
    'linked-story-status.browser.e2e.ts',
  ],
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3144', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm --filter @storypane/web exec vite --config vite.webhooks-test.config.ts',
    url: 'http://127.0.0.1:3144',
    reuseExistingServer: false,
  },
});
