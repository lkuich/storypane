import { dismissRecommendedSetup } from './fixtures/recommended-setup';
import { expect, test } from '@playwright/test';
import type { Space, UserDeliverySettings } from '@storypane/core';

test('members save a personal default, recover from save errors, and return to the space default', async ({
  page,
}) => {
  const space: Space = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Preview preferences',
    description: '',
    role: 'editor',
    roleName: 'Editor',
    permissions: ['content:read'],
    environment: 'prod',
    schemaReadOnly: true,
    createdAt: '2026-11-01T00:00:00Z',
    storyCount: 0,
    memberCount: 2,
  };
  const settings: UserDeliverySettings = {
    previewUrls: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Staging',
        url: 'https://staging.example.com/{slug}',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Local',
        url: 'http://localhost:3140/{slug}',
      },
    ],
    defaultPreviewId: '22222222-2222-4222-8222-222222222222',
    personalDefaultPreviewId: null,
    blockPreviews: true,
    blockPickerPreviews: true,
    blockLibraryPreviews: true,
    previewParameter: 'storypane_preview',
  };
  let failSave = true;
  const unexpected: string[] = [];
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (route) =>
    route.fulfill({
      json: {
        sessionId: 'preview-member',
        user: { id: 'member', name: 'Member', email: 'member@example.test' },
        space,
      },
    }),
  );
  await page.route('**/api/spaces', (route) => route.fulfill({ json: [space] }));
  await page.route('**/api/cms/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/cms', '');
    if (path === '/delivery-settings/personal-default' && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      expect(Object.keys(body)).toEqual([
        'previewId',
        'blockPreviews',
        'blockPickerPreviews',
        'blockLibraryPreviews',
      ]);
      if (failSave)
        return route.fulfill({ status: 503, json: { error: { message: 'Please retry saving' } } });
      settings.personalDefaultPreviewId = body.previewId;
      settings.blockPreviews = body.blockPreviews;
      settings.blockPickerPreviews = body.blockPickerPreviews;
      settings.blockLibraryPreviews = body.blockLibraryPreviews;
      return route.fulfill({ json: body });
    }
    const responses: Record<string, unknown> = {
      '/space': { ...space, members: [] },
      '/roles': [],
      '/reviews': [],
      '/locales': [],
      '/invitations': [],
      '/assets/uploads': { items: [] },
      '/public-media': { enabled: false },
      '/delivery-settings': settings,
      '/webhooks': { configured: false, endpoints: [] },
    };
    if (route.request().method() === 'GET' && path in responses)
      return route.fulfill({ json: responses[path] });
    unexpected.push(`${route.request().method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected request' } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?space=${space.id}&view=settings&section=delivery`);
  const personal = page.getByRole('combobox', { name: 'My default preview', exact: true });
  const save = page.getByRole('button', { name: 'Save preview settings', exact: true });
  await expect(personal).toHaveValue('');
  await expect(save).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add preview URL', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Use preview 1 as space default' })).toBeDisabled();
  await expect(
    page
      .getByRole('group', { name: 'Preview URL 1', exact: true })
      .getByLabel('Application preview URL'),
  ).toBeDisabled();
  await personal.focus();
  await expect(personal).toBeFocused();
  await personal.selectOption({ label: 'Local' });
  await expect(personal).toHaveValue(settings.previewUrls[1].id);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Content editor', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Add block pane', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Blocks table', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Please retry saving');
  await expect(personal).toHaveValue(settings.previewUrls[1].id);
  failSave = false;
  await save.click();
  await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(personal).toHaveValue(settings.previewUrls[1].id);
  await expect(
    page.getByRole('checkbox', { name: 'Content editor', exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Add block pane', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Blocks table', exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.delivery-settings')
    .screenshot({ path: '/tmp/storypane-personal-preview-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await personal.selectOption('');
  await save.click();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(personal).toHaveValue('');
  expect(settings.defaultPreviewId).toBe(settings.previewUrls[0].id);
  expect(unexpected).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await dismissRecommendedSetup(page);
});
