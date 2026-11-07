import { defineConfig } from '@playwright/test';
import reviews from './playwright.reviews.config';
export default defineConfig({ ...reviews, testMatch: 'locale-source.e2e.ts' });
