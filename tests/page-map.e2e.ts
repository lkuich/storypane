import { expect, test } from '@playwright/test';
const spaceId = '11111111-1111-4111-8111-111111111111';
const home = '20000000-0000-4000-8000-000000000001';
const about = '20000000-0000-4000-8000-000000000002';
const nodes = [home, about].map((id, i) => ({
  id,
  localeId: id,
  title: i ? 'About' : 'Home',
  url: i ? 'about' : 'home',
  locale: '',
  localeName: 'English',
  fallback: false,
  status: 'published',
  incoming: i,
  outgoing: 1 - i,
}));
test('page map supports keyboard navigation, URL restoration, read-only cards, themes and a mobile details sheet', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/auth/config', (r) => r.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (r) =>
    r.fulfill({
      json: {
        user: { id: 'map-test', name: 'Map Test', email: 'map@test.local' },
        sessionId: 'map-test',
        space: {
          id: spaceId,
          name: 'Map fixture',
          role: 'admin',
          roleName: 'Administrator',
          permissions: ['content:read'],
          environment: 'prod',
        },
      },
    }),
  );
  await page.route('**/api/cms/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.includes('/assets/uploads'))
      return r.fulfill({ json: { items: [], nextCursor: null } });
    if (u.pathname.endsWith('/locales'))
      return r.fulfill({ json: [{ id: home, name: 'English', slug: '', isDefault: true }] });
    if (/page-map\/(pages|orphans)$/.test(u.pathname))
      return r.fulfill({ json: { pages: nodes, nextOffset: null, restricted: false } });
    if (u.pathname.endsWith('/page-map'))
      return r.fulfill({
        json: {
          nodes,
          edges: [
            {
              source: home,
              target: about,
              kind: 'link',
              count: 2,
              usages: [{ blockId: home, block: 'Footer', field: 'link', label: 'Link' }],
            },
          ],
          truncated: false,
          limits: { nodes: 100, edges: 500 },
        },
      });
    return r.fulfill({ json: [] });
  });
  await page.goto(`/?space=${spaceId}`);
  const mapButton = page.getByRole('button', { name: 'Map', exact: true });
  await mapButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Page map', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Home \/home/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.getByLabel('Depth', { exact: true }).selectOption('3');
  await expect(page).toHaveURL(/map-depth=3/);
  await page.goBack();
  await expect(page.getByLabel('Depth', { exact: true })).toHaveValue('2');
  const card = page.locator('.map-card-title').filter({ hasText: 'Home' });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Page details' })).toContainText('Footer');
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: /Appearance/ }).selectOption(theme);
    await page.screenshot({ path: info.outputPath(`map-${theme}.png`) });
  }
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Page details', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`map-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Page details', exact: true })).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Potential orphans', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Potential orphans', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View in map', exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('View in map keeps the editor open when saving an unsaved edit fails', async ({ page }) => {
  const localeId = '30000000-0000-4000-8000-000000000001';
  const blockId = '30000000-0000-4000-8000-000000000002';
  const definitionId = '30000000-0000-4000-8000-000000000003';
  const createdAt = '2026-11-01T00:00:00Z';
  const story = { id: home, name: 'Home', slug: 'home', createdAt, updatedAt: createdAt };
  const locale = {
    id: localeId,
    storyId: home,
    spaceLocaleId: localeId,
    name: 'English',
    slug: '',
    urlSlug: 'home',
    rootBlockId: blockId,
    revision: 1,
    checkpointId: null,
    publishedVersionId: null,
  };
  const definition = {
    id: definitionId,
    versionId: definitionId,
    version: 1,
    name: 'page',
    displayName: 'Page',
    kind: 'content-type',
    createdAt,
    fields: [
      { id: definitionId, name: 'title', label: 'Title', type: 'text', format: 'singleline' },
    ],
  };
  const snapshot = {
    story,
    locale,
    blocks: [
      {
        id: blockId,
        definitionId,
        schemaVersionId: definitionId,
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
  };
  await page.route('**/api/auth/config', (r) => r.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (r) =>
    r.fulfill({
      json: {
        user: { id: 'guard-user', name: 'Editor', email: 'editor@test.local' },
        sessionId: 'guard-session',
        space: {
          id: spaceId,
          name: 'Fixture',
          role: 'admin',
          roleName: 'Administrator',
          permissions: ['content:read', 'content:edit'],
        },
      },
    }),
  );
  await page.routeWebSocket('**/api/cms/**/live**', () => {});
  let saves = 0;
  let held = false;
  const lease = {
    blockId,
    userId: 'guard-user',
    sessionId: 'guard-session',
    token: blockId,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await page.route('**/api/cms/**', (r) => {
    const path = new URL(r.request().url()).pathname.replace('/api/cms', '');
    const base = `/stories/${home}/locales/${localeId}`;
    if (path === `${base}/commands`) {
      saves++;
      return r.fulfill({
        status: 503,
        json: { error: { message: 'Save unavailable', code: 'unavailable' } },
      });
    }
    if (path === `${base}/leases`) {
      held = r.request().method() !== 'DELETE';
      return r.fulfill({ json: lease });
    }
    const data: Record<string, unknown> = {
      [`/stories/${home}`]: story,
      [`/stories/${home}/locales`]: [locale],
      [base]: { ...snapshot, leases: held ? [lease] : [] },
      [`${base}/schedules`]: [],
      '/locales': [{ id: localeId, name: 'English', slug: '', isDefault: true }],
      '/definitions': [definition],
      '/datasources': [],
      '/presence': {},
      '/delivery-settings': { previewUrls: [] },
      '/assets/uploads': { items: [] },
      '/releases': [],
    };
    return r.fulfill({ json: data[path] ?? [] });
  });
  await page.goto(`/?space=${spaceId}&story=${home}`);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeEditable();
  await title.fill('Unsaved title');
  await page.getByRole('button', { name: 'View in map', exact: true }).click();
  await expect.poll(() => saves).toBeGreaterThan(0);
  await expect(
    page.getByText('Your edits are still unsaved. Resolve them before leaving this story.').first(),
  ).toBeVisible();
  await expect(title).toHaveValue('Unsaved title');
  await expect(page).toHaveURL(new RegExp(`story=${home}`));
  await expect(page.getByRole('heading', { name: 'Page map', exact: true })).toHaveCount(0);
});
