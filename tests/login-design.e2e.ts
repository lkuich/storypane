import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({ json: { provider: 'local', passwordReset: true } }),
  );
  await page.route('**/api/session**', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Sign in to continue' } } }),
  );
});

test('login fits phone and desktop screens in both themes and supports keyboard sign-in', async ({
  page,
}) => {
  await page.goto('/');
  const email = page.getByLabel('Email', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  for (const width of [320, 390, 700, 768, 1440]) {
    await page.setViewportSize({ width, height: width <= 760 ? 740 : 900 });
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Appearance').selectOption(theme);
      await expect(submit).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const brand = await page.locator('.brand-name').boundingBox();
      const appearance = await page.locator('.login-appearance').boundingBox();
      expect(brand!.x + brand!.width).toBeLessThan(appearance!.x);
    }
  }
  await expect(email).toHaveCSS('font-size', '16px');
  await email.focus();
  await page.keyboard.type('editor@example.com');
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await page.keyboard.type('incorrect-password');
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Invalid email or password.' } } }),
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(submit).toBeEnabled();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(password).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(password).toBeVisible();
});
