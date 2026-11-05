import { expect, test } from '@playwright/test';
import { signInPage } from './auth';

const message = 'The request could not be completed. Please retry.';

test('blocks and migrations recover from initial read failures without reloading', async ({
  page,
}) => {
  await signInPage(page);
  const failed = new Set<string>();
  await page.route('**/api/cms/**', async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.endsWith('/datasources')
      ? 'datasources'
      : url.pathname.endsWith('/migrations') && url.searchParams.has('workspace')
        ? 'migrations'
        : null;
    if (key && !failed.has(key)) {
      failed.add(key);
      await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message } } });
    } else await route.continue();
  });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Blocks', exact: true })
    .click();
  await expect(page.getByText(message, { exact: true })).toHaveCount(2);
  // A focus refresh is the same recovery path as the periodic refresh.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(message, { exact: true })).toHaveCount(0, { timeout: 15000 });
  await expect(
    page
      .getByRole('region', { name: 'Schema migrations' })
      .getByText('Current release', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.data-table tbody tr').first()).toBeVisible();
  expect([...failed].sort()).toEqual(['datasources', 'migrations']);
});

test('successful polling does not dismiss a failed management action', async ({ page }) => {
  await signInPage(page);
  await page.route('**/api/cms/management-tokens', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Token could not be created.' } },
      });
    else await route.continue();
  });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Blocks', exact: true })
    .click();
  await page.getByRole('button', { name: 'CLI access', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'CLI & CI access' });
  await dialog.getByLabel('Token name', { exact: true }).fill('Recovery test');
  await dialog.getByRole('button', { name: 'Create management token', exact: true }).click();
  await expect(dialog.getByText('Token could not be created.', { exact: true })).toBeVisible();
  const refreshed = page.waitForResponse(
    (response) => response.url().includes('/migrations?workspace=true') && response.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(dialog.getByText('Token could not be created.', { exact: true })).toBeVisible();
});
