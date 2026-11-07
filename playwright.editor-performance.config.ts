import { defineConfig } from '@playwright/test';
import reviews from './playwright.reviews.config';
export default defineConfig({
  ...reviews,
  use: { ...reviews.use, baseURL: 'http://127.0.0.1:3130' },
  testMatch: ['editor-performance.e2e.ts', 'personal-preview.e2e.ts'],
});
