import { expect, test } from '@playwright/test';

const session = {
  user: { id: 'error-page-check', name: 'Error page check', email: 'check@example.com' },
  sessionId: 'error-page-check',
  installationAdmin: false,
  space: null,
};

test('keeps recovery visible during retries and supports keyboard, themes and narrow screens', async ({
  page,
}, testInfo) => {
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/spaces', (route) => route.fulfill({ json: [] }));
  let outcome: 'network' | 'pending' | 'failure' | 'success' = 'network';
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/session**', async (route) => {
    requests++;
    if (outcome === 'network') return route.abort('connectionfailed');
    if (outcome === 'pending') await pending;
    return outcome === 'success'
      ? route.fulfill({ json: session })
      : route.fulfill({
          status: 503,
          json: {
            error: { message: 'This workspace is temporarily unavailable. Please try again.' },
          },
        });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?space=11111111-1111-4111-8111-111111111111');
  const heading = page.getByRole('heading', { name: 'Unable to open this workspace', exact: true });
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Cannot connect to the workspace');
  await expect(page.getByRole('link', { name: 'All spaces', exact: true })).toHaveAttribute(
    'href',
    '/',
  );
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('workspace-error-dark.png'),
  });
  const before = requests;
  outcome = 'pending';
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Reconnecting…', exact: true })).toBeDisabled();
  await expect(heading).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Checking your connection to the workspace…');
  await expect(page.locator('.login-shell')).toHaveCount(0);
  await page.keyboard.press('Enter');
  expect(requests).toBe(before + 1);
  outcome = 'failure';
  release();
  await expect(retry).toBeEnabled();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await page.getByRole('combobox', { name: /Appearance/ }).selectOption('light');
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('workspace-error-light.png'),
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await expect(retry).toBeInViewport();
    await expect(page.getByRole('link', { name: 'All spaces', exact: true })).toBeInViewport();
  }
  await page.getByRole('combobox', { name: /Appearance/ }).selectOption('dark');
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('workspace-error-mobile.png'),
  });
  outcome = 'success';
  await retry.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  await expect(heading).toHaveCount(0);
  outcome = 'failure';
  await page.goto('/?space=11111111-1111-4111-8111-111111111111');
  await expect(heading).toBeVisible();
  outcome = 'success';
  await page.getByRole('link', { name: 'All spaces', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
});

test('uses the same recovery page when authentication cannot load', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/auth/config', (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: { provider: 'local' } }),
  );
  await page.route('**/api/session**', (route) => route.fulfill({ json: session }));
  await page.route('**/api/spaces', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Unable to start Storypane' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Unable to load authentication.');
  await expect(page.getByRole('link', { name: 'All spaces', exact: true })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
});
