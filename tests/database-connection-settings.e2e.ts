import { expect, test } from '@playwright/test';

test('database connection is available only in installation-admin space settings', async ({
  page,
}) => {
  const space = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Example space',
    description: '',
    role: 'admin',
    roleName: 'Admin',
    permissions: ['content:read', 'settings:write'],
    createdAt: '2026-01-01T00:00:00Z',
    storyCount: 1,
    memberCount: 1,
    provisioningStatus: 'ready',
    members: [],
  };
  let installationAdmin = true;
  let update: unknown;
  await page.route('**/api/auth/config', (r) => r.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (r) =>
    r.fulfill({
      json: {
        user: { id: 'admin', name: 'Admin', email: 'admin@example.test' },
        sessionId: 'test',
        installationAdmin,
        space: new URL(r.request().url()).searchParams.has('space') ? space : null,
      },
    }),
  );
  await page.route('**/api/spaces', (r) => {
    if (r.request().method() === 'PUT') {
      update = r.request().postDataJSON();
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: [space] });
  });
  let summaries = 0,
    reveals = 0;
  const fullUrl =
    'postgresql://space_role:private%40password@db.internal:5432/content?sslmode=require';
  const maskedUrl = 'postgresql://space_role:********@db.internal:5432/content?sslmode=require';
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/spaces/*/connection', (r) => {
    if (r.request().method() === 'POST') reveals++;
    else summaries++;
    return r.fulfill({
      json: {
        status: 'ready',
        url: r.request().method() === 'POST' ? fullUrl : maskedUrl,
      },
    });
  });
  await page.route('**/api/cms/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/cms/space') return r.fulfill({ json: space });
    if (/\/(roles|members|invitations|locales|management-tokens)$/.test(path))
      return r.fulfill({ json: [] });
    return r.fulfill({ status: 503, json: { error: { message: 'Not used by this UI check' } } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByRole('button', { name: /database connection/i })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings for Example space' }).click();
  const button = page.getByRole('button', { name: 'Update database connection', exact: true });
  await expect(button).toBeHidden();
  expect(summaries).toBe(0);
  const databaseTab = page.getByRole('button', { name: 'Database connection', exact: true });
  await databaseTab.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/section=database/);
  await expect(button).toBeVisible();
  await expect(page.getByText('Database configured. Ready.', { exact: true })).toBeVisible();
  const savedUrl = page.getByLabel('Saved database URL', { exact: true });
  await expect(savedUrl).toHaveValue(maskedUrl);
  expect(reveals).toBe(0);
  await page.getByRole('button', { name: 'Copy full URL', exact: true }).click();
  await expect(page.getByText('Full URL copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fullUrl);
  await expect(savedUrl).toHaveValue(maskedUrl);
  await page.getByRole('button', { name: 'Reveal full URL', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(savedUrl).toHaveValue(fullUrl);
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(savedUrl).toHaveValue(maskedUrl);
  expect(reveals).toBe(2);
  await page.reload();
  await expect(databaseTab).toHaveAttribute('aria-current', 'page');
  await expect(button).toBeVisible();
  await expect(savedUrl).toHaveValue(maskedUrl);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const input = page.getByLabel('Database connection URL');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(button).toBeFocused();
  }
  await button.click();
  await page
    .getByLabel('Database connection URL')
    .fill('postgresql://role:test@localhost/database');
  await page.getByRole('button', { name: 'Update connection', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(update).toEqual({
    id: space.id,
    connectionString: 'postgresql://role:test@localhost/database',
  });
  const before = summaries;
  installationAdmin = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Space settings', exact: true })).toBeVisible();
  await expect(button).toHaveCount(0);
  await expect(databaseTab).toHaveCount(0);
  expect(summaries).toBe(before);
});
