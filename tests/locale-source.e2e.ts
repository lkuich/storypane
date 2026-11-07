import { test, expect } from '@playwright/test';
import { reviewInstallation } from './fixtures/review-installation';
import type { LocaleSnapshot, StoryLocale, SpaceLocale } from '@storypane/core';

test('create, compare, keep translations and apply scoped locale updates with keyboard and responsive layouts', async ({
  browser,
}, info) => {
  const installation = await reviewInstallation();
  const context = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 1440, height: 1050 },
  });
  try {
    const headers = { origin: installation.origin, 'x-storypane-space-id': installation.spaceId };
    const auth = await context.request.post('/api/auth/sign-in/email', {
      headers: { origin: installation.origin },
      data: { email: installation.people.admin.email, password: installation.password },
    });
    expect(auth.ok()).toBe(true);
    const configuredResponse = await context.request.post('/api/cms/locales', {
      headers,
      data: { name: 'CA-FR', slug: 'ca-fr' },
    });
    expect(configuredResponse.ok()).toBe(true);
    const configured: SpaceLocale = await configuredResponse.json();
    const localeResponse = await context.request.post(
      `/api/cms/stories/${installation.storyId}/locales`,
      { headers, data: { spaceLocaleId: configured.id } },
    );
    expect(localeResponse.ok()).toBe(true);
    const french: StoryLocale = await localeResponse.json();
    const base = `/api/cms/stories/${installation.storyId}/locales/${french.id}`;
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}&locale=ca-fr`);
    const updates = page.getByRole('button', { name: 'Updates from Default', exact: true });
    await updates.focus();
    await page.keyboard.press('Enter');
    let dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Create from Default');
    await expect(dialog.getByRole('checkbox')).toHaveCount(3);
    for (const checkbox of await dialog.getByRole('checkbox').all())
      await expect(checkbox).toBeChecked();
    await dialog.getByRole('button', { name: 'Clear selection' }).click();
    await expect(dialog.getByRole('checkbox').nth(1)).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Select all', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create from Default', exact: true }).click();
    await expect(
      dialog.getByText('CA-FR is up to date with Default', { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText('3 copied blocks need translation review')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Hero', exact: true })
      .click();
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await expect(title).toBeEditable();
    await title.fill('Bonjour Montréal');
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    await updates.click();
    await expect(
      page.getByRole('dialog').getByText('CA-FR is up to date with Default', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    const original: LocaleSnapshot = await (
      await context.request.get(
        `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}`,
        { headers },
      )
    ).json();
    const hero = original.blocks.find(
      (b) => original.definitions.find((d) => d.versionId === b.schemaVersionId)?.name === 'hero',
    )!;
    await installation.db.query(
      "UPDATE block_drafts SET fields=jsonb_set(fields,'{title}',$2::jsonb),revision=revision+1 WHERE id=$1",
      [hero.id, JSON.stringify('Updated English hero')],
    );
    await installation.db.query(
      "UPDATE block_drafts SET fields=jsonb_set(fields,'{title}',$2::jsonb),revision=revision+1 WHERE id=$1",
      [original.locale.rootBlockId, JSON.stringify('New page metadata')],
    );
    await updates.click();
    dialog = page.getByRole('dialog');
    await expect(dialog.locator('.locale-source-change')).toHaveCount(2);
    const conflict = dialog
      .locator('.locale-source-change')
      .filter({ hasText: 'Translation needs review' });
    await expect(conflict.getByRole('combobox')).toHaveValue('');
    await conflict.locator('summary').click();
    await expect(conflict.getByText('Bonjour Montréal', { exact: true })).toBeVisible();
    await expect(conflict.getByText('Updated English hero', { exact: true })).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath('locale-source-updates.png'), fullPage: true });
    await conflict.getByRole('combobox').selectOption('keep');
    await dialog.getByRole('button', { name: 'Apply 1 update', exact: true }).click();
    await expect(
      dialog.getByText('CA-FR is up to date with Default', { exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(title).toHaveValue('Bonjour Montréal');
    const saved: LocaleSnapshot = await (await context.request.get(base, { headers })).json();
    expect(saved.blocks.find((b) => b.id === saved.locale.rootBlockId)?.fields.title).toBe(
      'New page metadata',
    );
    expect(saved.locale.publishedVersionId).toBeNull();
    await installation.db.query(
      "UPDATE block_drafts SET fields=jsonb_set(fields,'{title}',$2::jsonb),revision=revision+1 WHERE id=$1",
      [hero.id, JSON.stringify('Next English hero')],
    );
    await installation.db.query(
      "UPDATE block_drafts SET fields=jsonb_set(fields,'{title}',$2::jsonb),revision=revision+1 WHERE id=$1",
      [original.locale.rootBlockId, JSON.stringify('Later page metadata')],
    );
    await page.getByRole('button', { name: 'Source updates for Hero', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.locator('.locale-source-change')).toHaveCount(1);
    await expect(dialog).not.toContainText('Later page metadata');
    await dialog.getByRole('combobox').selectOption('apply');
    await dialog.getByRole('button', { name: 'Apply 1 update', exact: true }).click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(title).toHaveValue('Next English hero');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await installation.close();
  }
});

test('links a pre-existing locale from a child block without changing translated content', async ({
  browser,
}, info) => {
  const installation = await reviewInstallation();
  const context = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
  });
  try {
    const headers = { origin: installation.origin, 'x-storypane-space-id': installation.spaceId };
    expect(
      (
        await context.request.post('/api/auth/sign-in/email', {
          headers: { origin: installation.origin },
          data: { email: installation.people.admin.email, password: installation.password },
        })
      ).ok(),
    ).toBe(true);
    const configured: SpaceLocale = await (
      await context.request.post('/api/cms/locales', {
        headers,
        data: { name: 'CA-FR', slug: 'ca-fr' },
      })
    ).json();
    const french: StoryLocale = await (
      await context.request.post(`/api/cms/stories/${installation.storyId}/locales`, {
        headers,
        data: { spaceLocaleId: configured.id },
      })
    ).json();
    const original: LocaleSnapshot = await (
      await context.request.get(
        `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}`,
        { headers },
      )
    ).json();
    const hero = original.blocks.find(
      (b) => original.definitions.find((d) => d.versionId === b.schemaVersionId)?.name === 'hero',
    )!;
    const page = await context.newPage();
    await page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}&locale=ca-fr`);
    await page.getByRole('button', { name: 'Copy blocks from Default…', exact: true }).click();
    const copies = page.getByRole('dialog', { name: 'Copy blocks from Default', exact: true });
    await expect(copies.getByRole('checkbox').first()).not.toBeChecked();
    await copies.getByRole('checkbox', { name: /Hero/ }).check();
    await copies.getByRole('button', { name: 'Copy 1 selected', exact: true }).click();
    await expect(copies).not.toBeVisible();
    const copied: LocaleSnapshot = await (
      await context.request.get(`/api/cms/stories/${installation.storyId}/locales/${french.id}`, {
        headers,
      })
    ).json();
    const targetId = copied.blocks.find((b) => b.definitionId === hero.definitionId)!.id;
    expect(
      (await installation.db.query('SELECT 1 FROM locale_sources WHERE locale_id=$1', [french.id]))
        .rowCount,
    ).toBe(0);
    await page
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Hero', exact: true })
      .click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Notre contenu français');
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Source updates for Hero', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Link to Default');
    await expect(dialog.getByText(/No content will be changed/)).toBeVisible();
    await dialog.getByLabel(/^Hero/).selectOption(targetId);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.screenshot({ path: info.outputPath('link-existing-locale.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Confirm source links' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByText('This block is up to date with Default', { exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Notre contenu français',
    );
    const links = (
      await installation.db.query('SELECT mappings FROM locale_sources WHERE locale_id=$1', [
        french.id,
      ])
    ).rows[0].mappings;
    expect(links[hero.id]).toBe(targetId);
  } finally {
    await context.close();
    await installation.close();
  }
});
