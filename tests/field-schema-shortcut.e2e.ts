import { expect, test } from '@playwright/test';
import type { BlockDefinition, LocaleSnapshot, Story, StoryLocale } from '@storypane/core';

test('field gears open the matching active schema with keyboard access and schema permissions', async ({
  page,
}, testInfo) => {
  const spaceId = '11111111-1111-4111-8111-111111111111';
  const createdAt = '2026-01-01T00:00:00Z';
  const definition: BlockDefinition = {
    id: '22222222-2222-4222-8222-222222222222',
    versionId: '33333333-3333-4333-8333-333333333333',
    version: 1,
    name: 'page',
    displayName: 'Page',
    kind: 'content-type',
    createdAt,
    fields: [
      { name: 'title', label: 'Title', type: 'text', format: 'singleline', required: true },
      { name: 'previousPage', label: 'Previous page', type: 'link' },
      { name: 'sections', label: 'Sections', type: 'blocks' },
    ],
  };
  // The active migration may order fields differently from the deployed content schema.
  const active = { ...definition, fields: [...definition.fields].reverse() };
  const story: Story = {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Home',
    slug: 'home',
    createdAt,
    updatedAt: createdAt,
  };
  const locale: StoryLocale = {
    id: '55555555-5555-4555-8555-555555555555',
    storyId: story.id,
    spaceLocaleId: '66666666-6666-4666-8666-666666666666',
    name: 'English',
    slug: '',
    urlSlug: 'home',
    rootBlockId: '77777777-7777-4777-8777-777777777777',
    revision: 1,
    checkpointId: null,
    publishedVersionId: null,
  };
  const snapshot: LocaleSnapshot = {
    story,
    locale,
    blocks: [
      {
        id: locale.rootBlockId,
        definitionId: definition.id,
        schemaVersionId: definition.versionId,
        parentId: null,
        parentField: null,
        position: 0,
        fields: { title: 'Home' },
        revision: 1,
      },
    ],
    definitions: [definition],
    leases: [],
    revision: 1,
    checkpointId: null,
    access: {
      complete: true,
      edit: false,
      publish: false,
      preview: false,
      blocks: {
        [locale.rootBlockId]: {
          complete: true,
          read: true,
          edit: false,
          fields: { sections: { read: true, edit: false } },
        },
      },
    },
  };
  let canManage = true;
  const unexpected: string[] = [];
  const mutations: string[] = [];
  await page.route('**/api/auth/config', (r) => r.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (r) =>
    r.fulfill({
      json: {
        user: { id: 'schema-editor', name: 'Schema editor', email: 'schema@example.test' },
        sessionId: 'schema-editor',
        installationAdmin: false,
        space: {
          id: spaceId,
          name: 'Example space',
          role: 'editor',
          permissions: ['content:read', ...(canManage ? ['schemas:write'] : [])],
        },
      },
    }),
  );
  await page.routeWebSocket('**/api/cms/**/live**', () => {});
  await page.route('**/api/cms/**', (r) => {
    const url = new URL(r.request().url());
    const path = url.pathname.replace('/api/cms', '');
    if (r.request().method() !== 'GET') mutations.push(path);
    const base = `/stories/${story.id}/locales/${locale.id}`;
    const responses: Record<string, unknown> = {
      [`/stories/${story.id}`]: story,
      [`/stories/${story.id}/locales`]: [locale],
      [base]: snapshot,
      [`${base}/schedules`]: [],
      '/locales': [{ id: locale.spaceLocaleId, name: 'English', slug: '', isDefault: true }],
      '/definitions': [url.searchParams.has('deployed') ? definition : active],
      [`/definitions/${definition.id}/references`]: { items: [], total: 0 },
      '/datasources': [],
      '/migrations': [],
      '/presence': {},
      '/reviews': [],
      '/delivery-settings': { previewUrls: [] },
      '/assets/uploads': { items: [] },
    };
    if (path in responses) return r.fulfill({ json: responses[path] });
    unexpected.push(path);
    return r.fulfill({ status: 404, json: { error: { message: `Unexpected route: ${path}` } } });
  });
  await page
    .context()
    .route('https://storypane.dev/docs/', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Storypane documentation</h1>' }),
    );
  await page.goto(`/?space=${spaceId}&story=${story.id}`);
  const editor = page.getByRole('region', { name: 'Block editor', exact: true });
  await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Home', {
    timeout: 20000,
  });
  await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toBeDisabled();
  const drawer = page.getByRole('dialog', { name: "Edit 'page'", exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sidebar = page.getByRole('complementary', { name: 'Workspace', exact: true });
    if (width === 390) await page.getByRole('button', { name: 'Toggle navigation' }).click();
    const navigation =
      width === 390 ? page.getByRole('dialog', { name: 'Navigation', exact: true }) : sidebar;
    const docs = navigation.getByRole('link', { name: 'Docs (opens in a new tab)', exact: true });
    await docs.focus();
    await expect(docs).toBeFocused();
    await expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
    const bounds = (await docs.boundingBox())!;
    expect(bounds.y).toBeGreaterThan(800);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await expect(popup).toHaveURL('https://storypane.dev/docs/');
    await expect(page).toHaveURL(new RegExp(`space=${spaceId}&story=${story.id}`));
    await popup.close();
    await page.keyboard.press('Escape');
    for (const field of definition.fields) {
      const gear = editor.getByRole('button', {
        name: `Edit schema for ${field.label}`,
        exact: true,
      });
      await gear.focus();
      await page.keyboard.press('Enter');
      await expect(drawer).toBeVisible();
      const selected = drawer.getByRole('button', { name: `Edit ${field.name}`, exact: true });
      await expect(selected).toHaveAttribute('aria-expanded', 'true');
      await expect(selected).toBeFocused();
      await expect(drawer.getByLabel('Label', { exact: true })).toHaveValue(field.label);
      await expect(drawer.locator('.schema-field-card[data-expanded]')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(gear).toBeFocused();
    }
    await page.screenshot({ path: testInfo.outputPath(`field-gears-${width}.png`) });
  }
  await editor.getByRole('button', { name: 'Edit schema', exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.schema-field-card[data-expanded]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  active.fields = active.fields.filter((field) => field.name !== 'previousPage');
  await editor.getByRole('button', { name: 'Edit schema for Previous page', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('field is no longer in the active schema');
  await expect(drawer).toBeHidden();
  canManage = false;
  await page.reload();
  await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: /^Edit schema/ })).toHaveCount(0);
  expect(mutations).toEqual([]);
  expect(unexpected).toEqual([]);
});
