import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:3130', channel: 'chrome', trace: 'retain-on-failure' },
  reporter: 'list',
  webServer: existsSync('apps/example-astro/.env') ? {
    command:'pnpm --filter @blok/example-astro preview --ignore-lock',
    url:'http://127.0.0.1:3132/home',
    reuseExistingServer:!process.env.CI,
    timeout:30000,
  } : undefined,
})
