import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { getInstallation } from '@storypane/db/installation';
import type { BlockDefinition, SchemaMigration } from '@storypane/core';
import { signInPage } from './auth';

const origin = 'http://127.0.0.1:3130';
test('SEO preset uses normal editable fields and a reviewed migration, including on mobile', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const installation = getInstallation();
  const provisioningURL = installation.options.provisioningURL;
  if (!provisioningURL || !['localhost', '127.0.0.1'].includes(new URL(provisioningURL).hostname))
    throw new Error('SEO preset test requires disposable local database provisioning');
  const spaceId = crypto.randomUUID();
  const headers = { Origin: origin, 'x-storypane-space-id': spaceId };
  try {
    await signInPage(page);
    const created = await page.request.post('/api/spaces', {
      headers,
      data: { id: spaceId, name: `SEO preset ${spaceId}`, mode: 'create' },
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto(`/?space=${spaceId}&view=blocks`);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Blocks', exact: true })
      .click();
    await page.getByRole('button', { name: 'New block', exact: true }).click();
    const drawer = page.locator('dialog.schema-drawer');
    const preset = drawer.getByRole('button', { name: 'Use SEO & AI preset', exact: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await preset.focus();
    await expect(preset).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer.getByLabel('Display name', { exact: true })).toHaveValue('SEO & AI');
    await expect(drawer.getByLabel('Technical name', { exact: true })).toHaveValue('seo');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await drawer.screenshot({ path: '/tmp/storypane-seo-preset-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await drawer.getByRole('tab', { name: 'Config', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(drawer.getByRole('tab', { name: 'Fields', exact: true })).toBeFocused();
    await drawer.screenshot({ path: '/tmp/storypane-seo-preset-fields.png' });
    await drawer.getByRole('button', { name: 'Create block', exact: true }).click();
    await expect(page.getByText('Saved to active migration', { exact: true })).toBeVisible();
    const definitions = (await (
      await page.request.get('/api/cms/definitions', { headers })
    ).json()) as BlockDefinition[];
    const seo = definitions.find((d) => d.name === 'seo')!;
    expect(seo.kind).toBe('nestable');
    expect(seo.fields).toHaveLength(7);
    expect(new Set(seo.fields.map((f) => f.id)).size).toBe(7);
    expect(seo.fields.find((f) => f.name === 'markdown_enabled')?.defaultValue).toBe(false);
    const migrations = (await (
      await page.request.get('/api/cms/migrations?workspace=true', { headers })
    ).json()) as SchemaMigration[];
    expect(migrations.some((m) => m.status === 'active')).toBe(true);
    await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: /^Review migration/ }).click();
    await page.getByRole('button', { name: 'Deploy migration', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /^Review migration/ })).not.toBeVisible();
    const deployed = (await (
      await page.request.get('/api/cms/migrations?workspace=true', { headers })
    ).json()) as SchemaMigration[];
    expect(deployed.some((m) => m.status === 'active')).toBe(false);
    await page.getByRole('button', { name: 'New block', exact: true }).click();
    await expect(preset).toBeDisabled();
    await expect(
      drawer.getByText('An SEO block already exists. Reuse it in your page’s SEO field.'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
  } finally {
    await Promise.all(context.pages().map((current) => current.close()));
    const provisioner = new Pool({ connectionString: provisioningURL });
    try {
      const name = `sp_${spaceId.replaceAll('-', '')}`;
      await installation.pool.query('DELETE FROM space_connections WHERE id=$1', [spaceId]);
      await provisioner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await provisioner.query(`DROP ROLE IF EXISTS "${name}"`);
    } finally {
      await provisioner.end();
      await installation.pool.end();
    }
  }
});
