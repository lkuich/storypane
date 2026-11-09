import { test, expect } from '@playwright/test';

const space = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test space',
  description: '',
  role: 'admin',
  roleName: 'Administrator',
  permissions: ['settings:write'],
  environment: 'prod',
  createdAt: '2026-11-01T00:00:00Z',
  storyCount: 0,
  memberCount: 1,
  members: [],
};

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
          space: new URL(route.request().url()).searchParams.has('space') ? space : null,
        },
      }),
    );
    let removed = false;
    await page.route('**/api/spaces', async (route) => {
      if (route.request().method() === 'DELETE') {
        expect(route.request().postDataJSON()).toEqual({
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Test space',
          deleteDatabase: width === 1280,
        });
        removed = true;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({
        json: removed ? [] : [{ ...space, canDeleteDatabase: width === 1280 }],
      });
    });
    await page.route('**/api/cms/**', (route) => {
      const resource = new URL(route.request().url()).pathname.split('/').at(-1);
      const responses: Record<string, unknown> = {
        space,
        'delivery-settings': {
          previewUrls: [],
          defaultPreviewId: null,
          personalDefaultPreviewId: null,
          previewParameter: 'storypane_preview',
          blockPreviews: false,
          blockPickerPreviews: false,
          blockLibraryPreviews: false,
        },
        webhooks: { configured: false, endpoints: [] },
        uploads: { items: [] },
        'public-media': { enabled: false },
      };
      return route.fulfill({ json: responses[resource ?? ''] ?? [] });
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
    await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Settings for Test space', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Space settings', exact: true })).toBeVisible();
    await page.getByLabel('Space name', { exact: true }).fill('Unsaved name');
    await page.getByRole('button', { name: 'Delete space', exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete space', exact: true });
    await expect(dialog.getByRole('button', { name: 'Delete space', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox').fill('Test space');
    if (width === 1280) await dialog.getByRole('checkbox').check();
    else await expect(dialog.getByRole('checkbox')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Delete space', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your first space' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
