import { expect, test } from '@playwright/test';
import { signInPage } from './auth';
import type {
  BlockDefinition,
  OptionRequestContext,
  OptionSource,
  SchemaMigration,
  StoryLocale,
} from '@storypane/core';

test('configures external headers and includes the requesting field context in option lookups', async ({
  page,
}, testInfo) => {
  await signInPage(page);
  const created = await page.request.post('/api/spaces', {
    headers: { Origin: 'http://127.0.0.1:3130' },
    data: { name: `External options ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const space = await created.json();
  console.log('External options test space:', space.id);
  const headers = { Origin: 'http://127.0.0.1:3130', 'x-storypane-space-id': space.id };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/cms${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const get = async (path: string) => {
    const response = await page.request.get(`/api/cms${path}`, { headers });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const definition: BlockDefinition = await post('/definitions', {
    baseVersion: 0,
    schema: {
      name: 'external_page',
      displayName: 'External page',
      kind: 'content-type',
      fields: [
        {
          name: 'courses',
          label: 'Courses',
          type: 'options',
          source: { type: 'external', url: 'https://example.com/options' },
        },
      ],
    },
  });
  await page.goto(`/?space=${space.id}&view=blocks`);
  await page.getByRole('button', { name: 'External page', exact: true }).click();
  const drawer = page.locator('dialog.schema-drawer');
  await drawer.getByRole('button', { name: 'Edit courses', exact: true }).click();
  await drawer.getByRole('button', { name: 'Add header', exact: true }).click();
  await drawer.getByLabel('Header 1 name', { exact: true }).fill('X-Storypane-Story-Id');
  await drawer.getByLabel('Header 1 value', { exact: true }).fill('courses');
  await drawer.getByRole('button', { name: 'Save to migration', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('managed by the server');
  await drawer.getByLabel('Header 1 name', { exact: true }).fill('X-Catalog');
  await drawer.getByRole('button', { name: 'Add header', exact: true }).click();
  await drawer.getByRole('button', { name: 'Remove header 2', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(drawer.getByLabel('Header 2 name', { exact: true })).toHaveCount(0);
  await drawer.locator('summary', { hasText: 'Automatic context headers' }).focus();
  await page.keyboard.press('Enter');
  await expect(drawer.getByText('X-Storypane-Block-Id', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => drawer.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('external-headers-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/definitions/${definition.id}/versions`) &&
      response.request().method() === 'POST',
  );
  await drawer.getByRole('button', { name: 'Save to migration', exact: true }).click();
  expect((await savedResponse).ok()).toBe(true);
  const definitions: BlockDefinition[] = await get('/definitions');
  const field = definitions.find((item) => item.id === definition.id)!.fields[0];
  expect(field).toMatchObject({ source: { headers: [{ name: 'X-Catalog', value: 'courses' }] } });
  await page.screenshot({ path: testInfo.outputPath('external-headers-desktop.png') });
  const migrations: SchemaMigration[] = await get('/migrations?workspace=true');
  const active = migrations.find((item) => item.status === 'active')!;
  const review = await get(`/migrations/${active.id}/review`);
  await post(`/migrations/${active.id}/deploy`, { reviewToken: review.token });
  const story = await post('/stories', {
    name: 'Options test',
    slug: 'options-test',
    definitionId: definition.id,
  });
  const locales: StoryLocale[] = await get(`/stories/${story.id}/locales`);
  const context = {
    storyId: story.id,
    localeId: locales[0].id,
    blockId: locales[0].rootBlockId,
    fieldName: 'courses',
  };
  const requests: {
    context: OptionRequestContext;
    source: OptionSource;
    query?: string;
    values?: string[];
    cursor?: string;
  }[] = [];
  await page.route('**/api/cms/options', (route) => {
    const input = route.request().postDataJSON();
    if (input.source.type !== 'external') return route.continue();
    requests.push(input);
    return route.fulfill({
      json: {
        items: [{ value: 'one', label: 'First course' }],
        ...(input.cursor || input.query || input.values ? {} : { nextCursor: '50' }),
      },
    });
  });
  await page.goto(`/?space=${space.id}&story=${story.id}`);
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
  await expect(page.getByRole('button', { name: 'First course', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more choices', exact: true }).click();
  await expect.poll(() => requests.some((request) => request.cursor === '50')).toBe(true);
  await page.getByRole('button', { name: 'First course', exact: true }).click();
  await expect.poll(() => requests.some((request) => request.values?.includes('one'))).toBe(true);
  await page.getByRole('searchbox', { name: 'Search Courses options' }).fill('First');
  await expect.poll(() => requests.some((request) => request.query === 'First')).toBe(true);
  for (const request of requests) {
    expect(request.context).toEqual(context);
    expect(request.source).toMatchObject({
      type: 'external',
      headers: [{ name: 'X-Catalog', value: 'courses' }],
    });
  }
});
