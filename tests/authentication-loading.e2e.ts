import { expect, test } from '@playwright/test';

test('uses one workspace loading state while configuration and session load', async ({ page }) => {
  let releaseConfig!: () => void, releaseSession!: () => void;
  const config = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  const session = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route('**/api/auth/config', async (route) => {
    await config;
    await route.fulfill({ json: { provider: 'local' } });
  });
  await page.route('**/api/session**', async (route) => {
    await session;
    await route.fulfill({ status: 401, json: { error: { message: 'Sign in to continue' } } });
  });
  await page.goto('/');
  const loading = page.locator('main[aria-busy="true"]');
  await expect(loading).toHaveText('Opening your workspace…', { timeout: 20000 });
  releaseConfig();
  await expect(loading).toHaveText('Opening your workspace…');
  await expect(page.getByText('Loading authentication…')).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  releaseSession();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
});
