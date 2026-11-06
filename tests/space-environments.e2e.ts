import { test, expect } from '@playwright/test';
import type { BlockDefinition, SchemaMigration, Space } from '@storypane/core';
const baseURL = process.env.STORYPANE_ENVIRONMENTS_TEST_URL;
test.skip(
  !baseURL,
  'Use a disposable installation with admin@environments.test and a Production fixture space',
);
test('clones a dev space, promotes a migration to protected production, and supports responsive keyboard use', async ({
  page,
}) => {
  test.setTimeout(90000);
  if (!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
    throw new Error('Use a disposable local installation');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.getByLabel('Email', { exact: true }).fill('admin@environments.test');
  await page.getByLabel('Password', { exact: true }).fill('environments-browser-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  const spaces: Space[] = await (await page.request.get(`${baseURL}/api/spaces`)).json();
  const production = spaces.find((s) => s.name === 'Production fixture')!;
  const name = `Developer ${Date.now()}`;
  await page
    .getByRole('article', { name: 'Production fixture', exact: true })
    .getByRole('button', { name: 'Clone space' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create a space' });
  await dialog.getByLabel('Space name', { exact: true }).fill(name);
  await expect(dialog.getByRole('combobox', { name: 'Environment', exact: true })).toHaveValue(
    'dev',
  );
  await expect(dialog.getByRole('combobox', { name: 'Base space', exact: true })).toHaveValue(
    production.id,
  );
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await dialog.getByRole('button', { name: 'Review clone' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText(/Required dependencies:/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create space', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  const updated: Space[] = await (await page.request.get(`${baseURL}/api/spaces`)).json();
  const dev = updated.find((s) => s.name === name)!;
  expect(dev.productionSpaceId).toBe(production.id);
  const headers = { Origin: baseURL, 'x-storypane-space-id': dev.id };
  const api = (path: string) => `${baseURL}/api/cms${path}`;
  const definitions: BlockDefinition[] = await (
    await page.request.get(api('/definitions'), { headers })
  ).json();
  const definition = definitions[0];
  const history: SchemaMigration[] = await (
    await page.request.get(api('/migrations'), { headers })
  ).json();
  const deployed = history.filter((m) => m.status === 'deployed').at(-1)!;
  const {
    id: _id,
    versionId: _versionId,
    version: _version,
    createdAt: _createdAt,
    parentDefinitionId: _parent,
    ...schema
  } = definition;
  expect(
    (
      await page.request.post(api(`/definitions/${definition.id}/versions`), {
        headers,
        data: {
          expectedVersionId: definition.versionId,
          baseVersion: deployed.version,
          schema: { ...schema, displayName: `Promoted ${name}` },
        },
      })
    ).ok(),
  ).toBe(true);
  const migrations: SchemaMigration[] = await (
    await page.request.get(api('/migrations'), { headers })
  ).json();
  const active = migrations.find((m) => m.status === 'active')!;
  const reviewed = await (
    await page.request.get(api(`/migrations/${active.id}/review`), { headers })
  ).json();
  expect(
    (
      await page.request.post(api(`/migrations/${active.id}/deploy`), {
        headers,
        data: { reviewToken: reviewed.token },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`${baseURL}/?space=${dev.id}&view=blocks`);
  const promote = page.getByRole('button', { name: 'Promote to production', exact: true });
  await expect(promote).toBeEnabled();
  await promote.click();
  const transfer = page.getByRole('dialog', { name: 'Promote to production', exact: true });
  await expect(transfer.getByText(/changed: page/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await transfer.getByRole('button', { name: 'Apply reviewed changes' }).focus();
  await page.keyboard.press('Enter');
  await expect(transfer).not.toBeVisible();
  const prodHeaders = { ...headers, 'x-storypane-space-id': production.id };
  const promoted: BlockDefinition[] = await (
    await page.request.get(api('/definitions?deployed=true'), { headers: prodHeaders })
  ).json();
  expect(promoted[0].displayName).toBe(`Promoted ${name}`);
  await page.goto(`${baseURL}/?space=${production.id}&view=settings`);
  await expect(page.getByRole('checkbox', { name: /Schema read-only/ })).toBeChecked();
  await page.goto(`${baseURL}/?space=${production.id}&view=blocks`);
  await expect(page.getByText('Production · Schema read-only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New block', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
