import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`account menu and space deletion work with the keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/auth/config', (route) =>
      route.fulfill({ json: { provider: 'local' } }),
    );
    await page.route('**/api/session**', (route) =>
      route.fulfill({
        json: {
          user: { id: 'admin', name: 'Loren Kuich', email: 'loren@example.test' },
          sessionId: 'session',
          installationAdmin: true,
          space: null,
        },
      }),
    );
    let removed = false;
    await page.route('**/api/spaces', async (route) => {
      if (route.request().method() === 'DELETE') {
        expect(route.request().postDataJSON()).toEqual({
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Test space',
          deleteDatabase: true,
        });
        removed = true;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({
        json: removed
          ? []
          : [
              {
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Test space',
                description: '',
                role: 'admin',
                permissions: [],
                environment: 'prod',
                canDeleteDatabase: true,
              },
            ],
      });
    });
    await page.goto('/');
    const account = page.getByRole('button', { name: 'Account: Loren Kuich' });
    await expect(account).toHaveText('LK');
    await account.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const password = page.getByRole('dialog', { name: 'Your account' });
    await expect(password).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(password).not.toBeVisible();
    await page.getByRole('button', { name: 'Delete Test space', exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete space', exact: true });
    await expect(dialog.getByRole('button', { name: 'Delete space', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox').fill('Test space');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Delete space', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your first space' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
