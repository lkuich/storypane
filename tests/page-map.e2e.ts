import { expect, test, type Page } from '@playwright/test';

const spaceId = '11111111-1111-4111-8111-111111111111';
const home = '20000000-0000-4000-8000-000000000001';
const about = '20000000-0000-4000-8000-000000000002';
const english = '30000000-0000-4000-8000-000000000001';
const french = '30000000-0000-4000-8000-000000000004';
const blockId = '30000000-0000-4000-8000-000000000002';
const definitionId = '30000000-0000-4000-8000-000000000003';
const createdAt = '2026-11-01T00:00:00Z';
const stories = [home, about].map((id, i) => ({
  id,
  name: i ? 'About' : 'Home',
  slug: i ? 'about/our-team-and-the-story-behind-our-work' : 'home',
  createdAt,
  updatedAt: createdAt,
}));
const locales = [
  { id: english, name: 'English', slug: '', isDefault: true },
  { id: french, name: 'French', slug: 'fr', isDefault: false },
];

async function mockEditor(page: Page) {
  const graphRequests: URL[] = [];
  const saves: string[] = [];
  let held = false;
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
  const lease = {
    blockId,
    userId: 'editor',
    sessionId: 'editor-session',
    token: blockId,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await page.route('**/api/auth/config', (r) => r.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (r) =>
    r.fulfill({
      json: {
        user: { id: 'editor', name: 'Editor', email: 'editor@test.local' },
        sessionId: 'editor-session',
        space: {
          id: spaceId,
          name: 'Map fixture',
          role: 'admin',
          roleName: 'Administrator',
          permissions: ['content:read', 'content:edit'],
        },
      },
    }),
  );
  await page.routeWebSocket('**/api/cms/**/live**', () => {});
  await page.route('http://preview.test/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<html><body style="font:24px sans-serif;padding:32px">Application preview</body></html>',
    }),
  );
  await page.route('**/api/cms/**', (r) => {
    const url = new URL(r.request().url());
    const path = url.pathname.replace('/api/cms', '');
    if (path === '/page-map') {
      graphRequests.push(url);
      const locale = locales.find((l) => l.slug === url.searchParams.get('locale'))!;
      return r.fulfill({
        json: {
          nodes: stories.map((story, i) => ({
            id: story.id,
            localeId: locale.id,
            title: story.name,
            url: story.slug,
            locale: locale.slug,
            localeName: locale.name,
            fallback: false,
            status: 'published',
            incoming: i,
            outgoing: 1 - i,
          })),
          edges: [
            {
              source: home,
              target: about,
              kind: 'link',
              count: 2,
              usages: [{ blockId, block: 'Footer', field: 'link', label: 'Link' }],
            },
          ],
          truncated: false,
          limits: { nodes: 100, edges: 500 },
        },
      });
    }
    const story = stories.find((s) => path.startsWith(`/stories/${s.id}`));
    if (story) {
      const available = locales.map((l) => ({
        ...l,
        storyId: story.id,
        spaceLocaleId: l.id,
        urlSlug: story.slug,
        rootBlockId: blockId,
        revision: 1,
        checkpointId: null,
        publishedVersionId: null,
      }));
      if (path === `/stories/${story.id}`) return r.fulfill({ json: story });
      if (path === `/stories/${story.id}/locales`) return r.fulfill({ json: available });
      if (path.endsWith('/commands')) {
        saves.push(path);
        return r.fulfill({
          status: 503,
          json: { error: { message: 'Save unavailable', code: 'unavailable' } },
        });
      }
      if (path.endsWith('/leases')) {
        held = r.request().method() !== 'DELETE';
        return r.fulfill({ json: lease });
      }
      const locale = available.find((l) => path === `/stories/${story.id}/locales/${l.id}`);
      if (locale)
        return r.fulfill({
          json: {
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
                fields: { title: story.name },
                revision: 1,
              },
            ],
            definitions: [definition],
            leases: held ? [lease] : [],
            revision: 1,
            checkpointId: null,
          },
        });
    }
    const data: Record<string, unknown> = {
      '/stories': stories,
      '/locales': locales,
      '/definitions': [definition],
      '/presence': {},
      '/delivery-settings': {
        defaultPreviewId: 'app',
        previewParameter: 'preview',
        previewUrls: [{ id: 'app', name: 'App', url: 'http://preview.test/{slug}' }],
      },
      '/assets/uploads': { items: [] },
    };
    return r.fulfill({ json: data[path] ?? [] });
  });
  return { graphRequests, saves };
}

test('map loads only when expanded below preview, follows the editor locale, and supports keyboard navigation', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { graphRequests } = await mockEditor(page);
  await page.goto(`/?space=${spaceId}&story=${home}`);
  const panel = page.locator('.page-map-panel');
  const toggle = panel.locator('summary');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeEditable();
  await expect(toggle).toBeVisible();
  await expect(panel).not.toHaveAttribute('open');
  await expect(page.locator('.map-canvas')).toHaveCount(0);
  expect(graphRequests).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'View in map', exact: true })).toHaveCount(0);
  const preview = await page.getByRole('region', { name: 'Application preview' }).boundingBox();
  const collapsed = await panel.boundingBox();
  expect(collapsed!.y).toBeGreaterThanOrEqual(preview!.y + preview!.height);

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(graphRequests).toHaveLength(1);
  expect(Object.fromEntries(graphRequests[0].searchParams)).toMatchObject({
    root: home,
    locale: '',
  });
  await expect(page.getByLabel('Content mode', { exact: true })).toHaveCount(0);
  const card = page.locator('.map-card-title').filter({ hasText: 'Home' });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Page details' })).toContainText('Footer');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: /Appearance/ }).selectOption(theme);
    await panel.screenshot({ animations: 'disabled', path: info.outputPath(`map-${theme}.png`) });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const previewBounds = await page
      .getByRole('region', { name: 'Application preview' })
      .boundingBox();
    const mapBounds = await panel.boundingBox();
    expect(mapBounds!.y).toBeGreaterThanOrEqual(previewBounds!.y + previewBounds!.height);
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Page details' })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await toggle.click();
  await expect(page.locator('.map-canvas')).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(graphRequests).toHaveLength(2);
  await page.getByRole('tab', { name: 'French fr', exact: true }).click();
  await expect(panel).not.toHaveAttribute('open');
  expect(graphRequests).toHaveLength(2);
  await toggle.click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(graphRequests[2].searchParams.get('locale')).toBe('fr');
  await page.locator('.map-card-title').filter({ hasText: 'About' }).click();
  await page.getByRole('button', { name: 'Open page', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`story=${about}.*locale=fr`));
  await expect(panel).not.toHaveAttribute('open');
  expect(graphRequests).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('opening a connected page preserves unsaved edits when saving fails', async ({ page }) => {
  const { saves, graphRequests } = await mockEditor(page);
  await page.goto(`/?space=${spaceId}&story=${home}`);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeEditable();
  await title.fill('Unsaved title');
  await page.locator('.page-map-panel > summary').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  expect(graphRequests).toHaveLength(1);
  await page.locator('.map-card-title').filter({ hasText: 'About' }).click();
  await page.getByRole('button', { name: 'Open page', exact: true }).click();
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  await expect(
    page.getByText('Your edits are still unsaved. Resolve them before leaving this story.').first(),
  ).toBeVisible();
  await expect(title).toHaveValue('Unsaved title');
  await expect(page).toHaveURL(new RegExp(`story=${home}`));
});

test('collapsing the panel cancels an in-flight graph request', async ({ page }) => {
  await mockEditor(page);
  let release: () => void = () => {};
  await page.route('**/api/cms/page-map?**', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      json: { nodes: [], edges: [], truncated: false, limits: { nodes: 100, edges: 500 } },
    });
  });
  await page.goto(`/?space=${spaceId}&story=${home}`);
  const toggle = page.locator('.page-map-panel > summary');
  const request = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/cms/page-map');
  await toggle.click();
  await request;
  const aborted = page.waitForEvent(
    'requestfailed',
    (r) => new URL(r.url()).pathname === '/api/cms/page-map',
  );
  await toggle.click();
  release();
  expect((await aborted).failure()?.errorText).toContain('ERR_ABORTED');
  await expect(page.locator('.map-canvas')).toHaveCount(0);
});
