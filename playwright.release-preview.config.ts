import { defineConfig } from '@playwright/test';
import reviews from './playwright.reviews.config';
export default defineConfig({ ...reviews, testMatch: 'release-preview.e2e.ts' });
