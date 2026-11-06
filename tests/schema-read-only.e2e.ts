import { expect, test } from '@playwright/test';
import { contentScopesSchema, type BlockDefinition, type Space } from '@storypane/core';

const production: Space = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Production',
  description: '',
  environment: 'prod',
  schemaReadOnly: true,
  role: 'admin',
  roleName: 'Admin',
  permissions: ['content:read', 'schemas:write', 'settings:write'],
  createdAt: '2026-11-01T00:00:00Z',
  storyCount: 0,
  memberCount: 1,
};
const developer: Space = {
  ...production,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Alex’s development space',
  environment: 'dev',
  productionSpaceId: production.id,
  schemaReadOnly: false,
};
const definition: BlockDefinition = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'about',
  displayName: 'About',
  kind: 'nestable',
  version: 1,
  versionId: '44444444-4444-4444-8444-444444444444',
  createdAt: production.createdAt,
  fields: [{ name: 'name', label: 'Name', type: 'text', format: 'singleline' }],
};

test('read-only schemas explain protection and permissions, with accessible dev and settings links', async ({
  page,
}, info) => {
  let current = { ...production };
  let spaces: Space[] = [
    developer,
    { ...developer, id: 'locked', name: 'Locked dev', schemaReadOnly: true },
    { ...developer, id: 'viewer', name: 'Viewer dev', permissions: ['content:read'] },
    {
      ...developer,
      id: 'scoped',
      name: 'Scoped dev',
      contentScopes: contentScopesSchema.parse({ read: { definitionIds: [] } }),
    },
    { ...developer, id: 'private', name: 'Private dev', role: '' },
    { ...developer, id: 'failed', name: 'Failed dev', provisioningStatus: 'failed' as const },
    { ...developer, id: 'other', name: 'Unrelated dev', productionSpaceId: 'other-project' },
  ];
  let failSpaces = false;
  let spaceRequests = 0;
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (route) =>
    route.fulfill({
      json: {
        sessionId: 'schema-viewer',
        user: { id: 'schema-viewer', name: 'Schema viewer', email: 'schema@example.test' },
        space:
          new URL(route.request().url()).searchParams.get('space') === developer.id
            ? developer
            : current,
      },
    }),
  );
  await page.route('**/api/spaces', (route) => {
    spaceRequests++;
    return failSpaces
      ? route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } })
      : route.fulfill({ json: spaces });
  });
  await page.route('**/api/cms/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/cms', '');
    const space =
      route.request().headers()['x-storypane-space-id'] === developer.id ? developer : current;
    const responses: Record<string, unknown> = {
      '/definitions': [definition],
      '/datasources': [],
      '/migrations': [],
      '/migrations/environment': {
        environment: space.environment,
        schemaReadOnly: space.schemaReadOnly,
        production: null,
        behind: false,
        pending: [],
      },
      '/space': { ...space, members: [] },
      '/roles': [],
      '/assets/uploads': { items: [] },
      '/locales': [],
      '/invitations': [],
      '/delivery-settings': {
        previewUrls: [],
        defaultPreviewId: null,
        previewParameter: 'storypane_preview',
        personalDefaultPreviewId: null,
      },
      '/delivery-tokens': [],
      '/management-tokens': [],
      '/webhooks': { configured: false, endpoints: [] },
      '/public-media': { enabled: false },
      [`/definitions/${definition.id}/references`]: { items: [], total: 0 },
    };
    if (route.request().method() === 'GET' && path in responses)
      return route.fulfill({ json: responses[path] });
    unexpected.push(`${route.request().method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected request' } } });
  });
  const drawer = page.getByRole('dialog', { name: "View 'about'", exact: true });
  const notice = drawer.getByRole('region', { name: 'Schema editing is disabled', exact: true });
  async function open() {
    await page.goto(`/?space=${production.id}&view=blocks`);
    await page.getByRole('button', { name: 'About', exact: true }).click();
    await expect(drawer).toBeVisible();
  }
  await open();
  await expect(notice).toContainText('Schema read-only is enabled for this production space');
  await expect(notice.getByRole('link')).toHaveCount(1);
  const devLink = notice.getByRole('link', { name: `Open ${developer.name}`, exact: true });
  await expect(devLink).toHaveAttribute('href', `/?space=${developer.id}&view=blocks`);
  await expect(drawer.getByRole('button', { name: 'Save to migration' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'View name', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: 'Label', exact: true })).toBeDisabled();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await devLink.focus();
      await expect(devLink).toBeFocused();
      expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`read-only-${theme}-${width}.png`) });
    }
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`space=${developer.id}&view=blocks`));
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const editable = page.getByRole('dialog', { name: "Edit 'about'", exact: true });
  await expect(editable.getByRole('button', { name: 'Save to migration' })).toBeVisible();
  await expect(editable.locator('.schema-read-only-notice')).toHaveCount(0);
  expect(spaceRequests).toBe(1);

  spaces = [];
  await open();
  await expect(notice).toContainText('No linked development space with schema editing access');
  await expect(notice).toContainText(
    'To edit here, turn off Schema read-only in Space settings → General.',
  );
  const settings = notice.getByRole('link', { name: 'Space settings', exact: true });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`space=${production.id}&view=settings&section=general`));
  await expect(page.getByRole('checkbox', { name: /Schema read-only/ })).toBeChecked();

  current = { ...production, role: 'editor', permissions: ['content:read'] };
  await open();
  await expect(notice).toContainText('A space administrator can turn off Schema read-only');
  await expect(notice.getByRole('link', { name: 'Space settings' })).toHaveCount(0);

  current = { ...current, schemaReadOnly: false };
  await open();
  const permissions = drawer.getByRole('region', { name: 'Schema editing requires access' });
  await expect(permissions).toContainText(
    'Your role or content access does not allow schema editing',
  );
  await expect(permissions).toContainText('No linked development space');
  await expect(permissions).not.toContainText('turn off');
  await expect(permissions.getByRole('link')).toHaveCount(0);

  current = { ...production };
  spaces = [developer];
  failSpaces = true;
  await open();
  await expect(notice.getByRole('alert')).toContainText(
    'Linked development spaces could not be loaded',
  );
  await expect(notice).not.toContainText('No linked development space');
  failSpaces = false;
  await notice.getByRole('button', { name: 'Try again' }).focus();
  await page.keyboard.press('Enter');
  await expect(devLink).toBeVisible();
  await expect(notice.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
