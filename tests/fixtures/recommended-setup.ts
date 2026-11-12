import type { Page } from '@playwright/test';

// Other journeys start after the first-visit prompt; its behavior has a dedicated test.
export async function dismissRecommendedSetup(page: Page) {
  const welcome = page.getByRole('dialog', { name: 'Welcome to Storypane' });
  await page.addLocatorHandler(welcome, () =>
    welcome.getByRole('button', { name: 'Maybe later' }).click(),
  );
}
