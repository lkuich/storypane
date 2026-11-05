import { expect, test } from '@playwright/test';
import type { BlockDefinition, SchemaMigration } from '@storypane/core';
import { signInPage } from './auth';

test('deletes unused block schemas with confirmation and preserves referenced and nested blocks', async ({
  page,
}, testInfo) => {
  await signInPage(page);
  const response = await page.request.post('/api/spaces', {
    headers: { Origin: 'http://127.0.0.1:3130' },
    data: { name: `Block deletion ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const space = await response.json();
  const headers = { Origin: 'http://127.0.0.1:3130', 'x-storypane-space-id': space.id };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/cms${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const definitions: BlockDefinition[] = [];
  for (const name of ['Used', 'Unused', 'Child']) {
    definitions.push(
      await post('/definitions', {
        baseVersion: 0,
        ...(name === 'Child' ? { parentDefinitionId: definitions[1].id } : {}),
        schema: { name: name.toLowerCase(), displayName: name, kind: 'universal', fields: [] },
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
  await post('/stories', { name: 'Home', slug: 'home', definitionId: definitions[0].id });
  await page.goto(`/?space=${space.id}&view=blocks`);
  const drawer = page.locator('dialog.schema-drawer');
  await page.getByRole('button', { name: 'Used', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: 'References (1)', exact: true })).toBeVisible();
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click();
  await drawer.getByRole('button', { name: 'Delete block', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: 'Delete “Used”?', exact: true });
  await expect(blocked.getByRole('button', { name: 'Delete block', exact: true })).toBeDisabled();
  await blocked.getByRole('button', { name: 'View references', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: 'References (1)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(drawer.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await page.getByRole('button', { name: 'Unused', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: 'References (0)', exact: true })).toBeVisible();
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click();
  await drawer.getByLabel('Display name', { exact: true }).fill('Unsaved name');
  await drawer.getByRole('button', { name: 'Delete block', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete “Unused”?', exact: true });
  await expect(confirmation).toContainText('Nested block definitions will be kept');
  await expect(confirmation).toContainText('Unsaved schema edits will be discarded');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(drawer.getByLabel('Display name', { exact: true })).toHaveValue('Unsaved name');
  await drawer.getByRole('button', { name: 'Delete block', exact: true }).click();
  const endpoint = `**/definitions/${definitions[1].id}`;
  await page.route(endpoint, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'Please try again.' } },
        })
      : route.continue(),
  );
  await confirmation.getByRole('button', { name: 'Delete block', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toBeVisible();
  await page.unroute(endpoint);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('block-deletion-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await confirmation.getByRole('button', { name: 'Delete block', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Unused', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Used', exact: true })).toBeVisible();
  await expect(page.locator(`[data-definition-id="${definitions[2].id}"]`)).toHaveAttribute(
    'data-depth',
    '0',
  );
  const deployed: BlockDefinition[] = await (
    await page.request.get('/api/cms/definitions?deployed=true', { headers })
  ).json();
  expect(deployed.some((item) => item.id === definitions[1].id)).toBe(true);
  await page.getByRole('button', { name: /^Review migration/ }).click();
  const migration = page.getByRole('dialog', { name: /^Review migration/ });
  await expect(migration.getByRole('region', { name: 'Schema changes' })).toContainText('unused');
  await expect(migration.getByRole('region', { name: 'Schema changes' })).toContainText('removed');
  await migration.getByRole('button', { name: 'Deploy migration', exact: true }).click();
  await expect(migration).not.toBeVisible();
  const final: BlockDefinition[] = await (
    await page.request.get('/api/cms/definitions?deployed=true', { headers })
  ).json();
  expect(final.map((item) => item.name).sort()).toEqual(['child', 'used']);
});
