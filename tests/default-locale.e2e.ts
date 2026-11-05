import { expect, test } from '@playwright/test';
import type { SchemaMigration, SpaceLocale } from '@storypane/core';
import { signInPage } from './auth';

test('changes the default without moving URLs, then reviews and removes the former root locale', async ({
  page,
}, testInfo) => {
  await signInPage(page);
  const created = await page.request.post('/api/spaces', {
    headers: { Origin: 'http://127.0.0.1:3130' },
    data: { name: `Default locale ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const space = await created.json();
  console.log('Default locale test space:', space.id);
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
  const definition = await post('/definitions', {
    baseVersion: 0,
    schema: { name: 'page', displayName: 'Page', kind: 'content-type', fields: [] },
  });
  const migrations: SchemaMigration[] = await get('/migrations?workspace=true');
  const active = migrations.find((migration) => migration.status === 'active')!;
  const review = await get(`/migrations/${active.id}/review`);
  await post(`/migrations/${active.id}/deploy`, { reviewToken: review.token });
  const story = await post('/stories', { name: 'Home', slug: 'home', definitionId: definition.id });
  const locales: SpaceLocale[] = await get('/locales');
  const root = locales.find((locale) => locale.isDefault)!;
  const canada: SpaceLocale = await post('/locales', { name: 'English (Canada)', slug: 'ca' });
  await page.goto(`/?space=${space.id}&view=settings&section=locales`);
  const settings = page.getByRole('region', { name: 'Space locales' });
  await expect(settings.getByRole('button', { name: 'Remove Default', exact: true })).toHaveCount(
    0,
  );
  await settings
    .getByRole('button', { name: 'Set English (Canada) as default', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Make English (Canada) the default?',
    exact: true,
  });
  await expect(confirmation).toContainText('URL prefixes stay unchanged');
  await confirmation.getByRole('button', { name: 'Set as default', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(
    settings.getByRole('row').filter({ has: page.getByText('English (Canada)', { exact: true }) }),
  ).toContainText('Default locale');
  await expect(
    settings.getByRole('button', { name: 'Remove English (Canada)', exact: true }),
  ).toHaveCount(0);
  expect(await get('/locales')).toEqual([
    { ...canada, isDefault: true },
    { ...root, isDefault: false },
  ]);
  await settings.getByRole('button', { name: 'Remove Default', exact: true }).click();
  const removal = page.getByRole('dialog', { name: 'Remove Default?', exact: true });
  await expect(removal).toContainText('Only remaining locale');
  await expect(removal.getByRole('link', { name: /Home/ })).toHaveAttribute(
    'href',
    `/?story=${story.id}&locale=&space=${space.id}`,
  );
  await removal.getByRole('checkbox').check();
  await expect(
    removal.getByRole('button', { name: 'Delete locale and content', exact: true }),
  ).toBeDisabled();
  await removal.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.goto(`/?space=${space.id}&story=${story.id}`);
  await expect(page.getByRole('tab', { name: 'Default', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await get(`/stories/${story.id}/locales`)).toHaveLength(1);
  await post(`/stories/${story.id}/locales`, { spaceLocaleId: canada.id });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Default', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto(`/?space=${space.id}&story=${story.id}`);
  await expect(page.getByRole('tab', { name: 'English (Canada) ca', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto(`/?space=${space.id}&view=settings&section=locales`);
  await settings.getByRole('button', { name: 'Remove Default', exact: true }).click();
  await expect(removal).not.toContainText('Only remaining locale');
  await removal.getByRole('checkbox').check();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => removal.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('remove-root-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await removal.getByRole('button', { name: 'Delete locale and content', exact: true }).click();
  await expect(removal).not.toBeVisible();
  await expect(settings.getByText('Default', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('default-locale-settings.png') });
  const next = await post('/stories', { name: 'Next', slug: 'next', definitionId: definition.id });
  expect(await get(`/stories/${next.id}/locales`)).toEqual([
    expect.objectContaining({ slug: 'ca', spaceLocaleId: canada.id }),
  ]);
  await page.goto(`/?space=${space.id}&story=${story.id}`);
  await expect(page.getByRole('tab', { name: 'English (Canada) ca', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await get('/locales')).toEqual([{ ...canada, isDefault: true, storyCount: 2 }]);
});
