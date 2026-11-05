import { expect, test } from '@playwright/test';
import type { BlockDefinition, DefinitionReferencesPage, SchemaMigration } from '@storypane/core';
import { signInPage } from './auth';

test('shows distinct story references, locale links, empty states and recoverable errors', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await signInPage(page);
  const created = await page.request.post('/api/spaces', {
    headers: { Origin: 'http://127.0.0.1:3130' },
    data: { name: `References ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const space = await created.json();
  const headers = { Origin: 'http://127.0.0.1:3130', 'x-storypane-space-id': space.id };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/cms${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const definitions: BlockDefinition[] = [];
  for (const name of ['Page', 'Unused']) {
    definitions.push(
      await post('/definitions', {
        baseVersion: 0,
        schema: {
          name: name.toLowerCase(),
          displayName: name,
          kind: 'content-type',
          fields: [{ name: 'title', label: 'Title', type: 'text' }],
        },
      }),
    );
  }
  const migrations: SchemaMigration[] = await (
    await page.request.get('/api/cms/migrations?workspace=true', { headers })
  ).json();
  const active = migrations.find((item) => item.status === 'active')!;
  const review = await (
    await page.request.get(`/api/cms/migrations/${active.id}/review`, { headers })
  ).json();
  await post(`/migrations/${active.id}/deploy`, { reviewToken: review.token });
  const story = await post('/stories', {
    name: 'Home',
    slug: 'home',
    definitionId: definitions[0].id,
  });
  const french = await post('/locales', { name: 'French', slug: 'fr' });
  await post(`/stories/${story.id}/locales`, { spaceLocaleId: french.id });
  const endpoint = `/api/cms/definitions/${definitions[0].id}/references`;
  const references: DefinitionReferencesPage = await (
    await page.request.get(endpoint, { headers })
  ).json();
  expect(references.total).toBe(1);
  expect(references.items[0].locales).toHaveLength(2);

  await page.goto(`/?space=${space.id}&view=blocks`);
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const drawer = page.locator('dialog.schema-drawer');
  const tab = drawer.getByRole('tab', { name: 'References (1)', exact: true });
  await expect(tab).toBeVisible();
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click();
  await drawer.getByLabel('Display name', { exact: true }).fill('Unsaved page name');
  await tab.click();
  const panel = drawer.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(panel.getByText('Draft', { exact: true })).toHaveCount(2);
  await expect(panel.getByText('/home', { exact: true })).toBeVisible();
  await expect(panel.getByText('/fr/home', { exact: true })).toBeVisible();
  for (const locale of references.items[0].locales) {
    const link = panel.getByRole('link', { name: `Open Home · ${locale.localeName} in a new tab` });
    const href = new URL((await link.getAttribute('href'))!, 'http://127.0.0.1:3130');
    expect(href.searchParams.get('space')).toBe(space.id);
    expect(href.searchParams.get('story')).toBe(story.id);
    expect(href.searchParams.get('locale') ?? '').toBe(locale.localeSlug);
    expect(href.searchParams.get('block')).toBe(locale.blockId);
    await expect(link).toHaveAttribute('target', '_blank');
  }
  const popupPromise = page.waitForEvent('popup');
  await panel.getByRole('link', { name: 'Open Home · French in a new tab' }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(popup.getByRole('tab', { name: 'French fr', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await popup.close();

  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: testInfo.outputPath(`references-${colorScheme}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => drawer.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('references-mobile.png') });
  await tab.focus();
  await page.keyboard.press('Home');
  await expect(drawer.getByRole('tab', { name: 'Fields', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(drawer.getByRole('tab', { name: 'Fields', exact: true })).toBeFocused();
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click();
  await expect(drawer.getByLabel('Display name', { exact: true })).toHaveValue('Unsaved page name');
  await drawer.getByLabel('Display name', { exact: true }).fill('Page');

  const route = `**/definitions/${definitions[0].id}/references?*`;
  await page.route(route, (request) =>
    request.fulfill({
      status: 503,
      json: { error: { code: 'unavailable', message: 'References are temporarily unavailable.' } },
    }),
  );
  await tab.click();
  await expect(drawer.getByRole('tab', { name: 'References (—)', exact: true })).toBeVisible();
  await expect(panel.getByRole('alert')).toBeVisible();
  await page.unroute(route);
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(tab).toBeVisible();

  const items = Array.from({ length: 21 }, (_, index) => ({
    ...references.items[0],
    storyId: crypto.randomUUID(),
    storyName: `Story ${index + 1}`,
  }));
  await page.route(route, (request) => {
    const cursor = Number(new URL(request.request().url()).searchParams.get('cursor'));
    return request.fulfill({
      json: {
        total: 21,
        items: items.slice(cursor, cursor + 20),
        nextCursor: cursor === 0 ? '20' : null,
      },
    });
  });
  await drawer.getByRole('tab', { name: 'Fields', exact: true }).click();
  await drawer.getByRole('tab', { name: /^References/ }).click();
  await expect(drawer.getByRole('tab', { name: 'References (21)', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Story 21', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Story 1', exact: true })).toBeVisible();
  await page.unroute(route);
  page.once('dialog', (dialog) => dialog.accept());
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(drawer).not.toBeVisible();

  await page.getByRole('button', { name: 'Unused', exact: true }).click();
  await drawer.getByRole('tab', { name: 'References (0)', exact: true }).click();
  await expect(drawer.getByText('No references yet', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'New block', exact: true }).click();
  await drawer.getByRole('tab', { name: 'References (0)', exact: true }).click();
  await expect(
    drawer.getByText('Save and deploy this block to start using it in stories.'),
  ).toBeVisible();
});
