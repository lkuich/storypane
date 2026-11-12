import { dismissRecommendedSetup } from './fixtures/recommended-setup';
import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
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
  const definition = definitions.find((d) => d.name === 'page')!;
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
  const promote = page.getByRole('button', { name: 'Review promotion', exact: true });
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
  expect(promoted.find((d) => d.id === definition.id)?.displayName).toBe(`Promoted ${name}`);
  await page.goto(`${baseURL}/?space=${production.id}&view=settings`);
  await expect(page.getByRole('checkbox', { name: /Schema read-only/ })).toBeChecked();
  await page.goto(`${baseURL}/?space=${production.id}&view=blocks`);
  await expect(
    page
      .getByRole('region', { name: 'Space environment' })
      .getByText('Schema read-only', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'New block', exact: true })).toHaveCount(0);
  const tokens: { id: string; token: string }[] = [];
  for (const h of [headers, prodHeaders]) {
    const response = await page.request.post(api('/management-tokens'), {
      headers: h,
      data: { name: 'Environment CLI test', capability: 'deploy' },
    });
    expect(response.ok()).toBe(true);
    tokens.push(await response.json());
  }
  const directory = await mkdtemp(join(tmpdir(), 'storypane-environment-cli-'));
  try {
    const cli = (command: string) =>
      promisify(execFile)(
        process.execPath,
        [
          resolve('packages/sdk/bin/storypane.mjs'),
          'migrations',
          command,
          ...(command === 'status' ? [] : ['--yes']),
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            STORYPANE_URL: baseURL,
            STORYPANE_SPACE_ID: dev.id,
            STORYPANE_MANAGEMENT_TOKEN: tokens[0].token,
            STORYPANE_PRODUCTION_MANAGEMENT_TOKEN: tokens[1].token,
          },
        },
      );
    const status = JSON.parse((await cli('status')).stdout);
    expect(status.production.id).toBe(production.id);
    expect(status.behind).toBe(false);
    const current: BlockDefinition[] = await (
      await page.request.get(api('/definitions'), { headers })
    ).json();
    expect(
      (
        await page.request.post(api(`/definitions/${definition.id}/versions`), {
          headers,
          data: {
            baseVersion: deployed.version + 1,
            expectedVersionId: current.find((d) => d.id === definition.id)!.versionId,
            schema: { ...schema, displayName: 'CLI promotion verified' },
          },
        })
      ).ok(),
    ).toBe(true);
    const next: SchemaMigration[] = await (
      await page.request.get(api('/migrations'), { headers })
    ).json();
    const pending = next.find((m) => m.status === 'active')!;
    const inspected = await (
      await page.request.get(api(`/migrations/${pending.id}/review`), { headers })
    ).json();
    expect(
      (
        await page.request.post(api(`/migrations/${pending.id}/deploy`), {
          headers,
          data: { reviewToken: inspected.token },
        })
      ).ok(),
    ).toBe(true);
    expect((await cli('promote')).stdout).toContain('Applied promote');
    const final: BlockDefinition[] = await (
      await page.request.get(api('/definitions?deployed=true'), { headers: prodHeaders })
    ).json();
    expect(final.find((d) => d.id === definition.id)?.displayName).toBe('CLI promotion verified');
  } finally {
    await rm(directory, { recursive: true, force: true });
    for (const [index, h] of [headers, prodHeaders].entries())
      await page.request.delete(api(`/management-tokens/${tokens[index].id}`), { headers: h });
  }
  expect(errors).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await dismissRecommendedSetup(page);
});
