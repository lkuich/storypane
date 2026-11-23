import { dismissRecommendedSetup } from './fixtures/recommended-setup';
import { test, expect } from '@playwright/test';
import { reviewInstallation } from './fixtures/review-installation';
import type { LocaleSnapshot, Story, StoryLocale, SpaceLocale } from '@storypane/core';

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
    await dismissRecommendedSetup(page);
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
    await installation.db.query('DELETE FROM block_drafts WHERE id=$1', [hero.id]);
    await page.getByRole('button', { name: 'Source updates for Hero', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Removed in source', { exact: true })).toBeVisible();
    await dialog.getByRole('combobox').selectOption('apply');
    await dialog.getByRole('button', { name: 'Apply 1 update', exact: true }).click();
    await expect(dialog).not.toBeVisible();
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
    await dismissRecommendedSetup(page);
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

test('filter, create and manage a market-only story without creating versions on visit', async ({
  browser,
}) => {
  const installation = await reviewInstallation();
  const context = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 390, height: 844 },
  });
  try {
    const headers = { origin: installation.origin, 'x-storypane-space-id': installation.spaceId };
    const login = await context.request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: installation.people.admin.email, password: installation.password },
    });
    expect(login.ok()).toBe(true);
    const result = await context.request.post('/api/cms/locales', {
      headers,
      data: { name: 'Asia', slug: 'asia' },
    });
    expect(result.ok()).toBe(true);
    const asia: SpaceLocale = await result.json();
    const page = await context.newPage();
    await dismissRecommendedSetup(page);
    await page.goto('/?space=' + installation.spaceId);
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New folder' });
    await dialog.getByLabel('Name', { exact: true }).fill('Regional pages');
    await expect(dialog.getByText('/regional-pages/example-page')).toBeVisible();
    await dialog.getByRole('radio', { name: /URL folder/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio', { name: /Organizational folder/ })).toBeChecked();
    await expect(dialog.getByText('Example page URL', { exact: true })).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByText('/regional-pages/example-page')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('#folder-slug')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Create folder' }).click();
    await expect(page.getByRole('button', { name: 'Regional pages Editor only' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Locale folders' })).toHaveCount(0);
    const filter = page.getByRole('button', { name: 'Filter by locale' });
    await filter.focus();
    await filter.press('Enter');
    await page
      .getByRole('group', { name: 'Filter by locale' })
      .getByText('Asia', { exact: true })
      .click();
    await expect(page.getByRole('checkbox', { name: 'Asia', exact: true })).toBeFocused();
    await expect(page.getByRole('checkbox', { name: 'Asia', exact: true })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Default', exact: true }).check();
    expect(new URL(page.url()).searchParams.getAll('filterLocale')).toHaveLength(2);
    await page.getByRole('checkbox', { name: 'Default', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await expect(filter).toBeFocused();
    expect(new URL(page.url()).searchParams.getAll('filterLocale')).toEqual([asia.id]);
    const breadcrumbs = page.getByRole('navigation', { name: 'Content folders' });
    await expect(breadcrumbs.getByRole('button', { name: 'Asia' })).toHaveCount(0);
    await breadcrumbs.getByRole('button', { name: 'Root', exact: true }).click();
    expect(new URL(page.url()).searchParams.getAll('filterLocale')).toEqual([asia.id]);
    const filtersButton = page.getByRole('button', { name: 'Filters', exact: true });
    expect((await filtersButton.boundingBox())!.y).toBeCloseTo((await filter.boundingBox())!.y, 0);
    await page.getByRole('button', { name: 'New story', exact: true }).click();
    await expect(page.getByLabel('Starting locale')).toHaveValue(asia.id);
    await page.getByLabel('Name', { exact: true }).fill('Asia booking');
    await page.getByRole('button', { name: 'Create story', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Asia asia' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const storyId = new URL(page.url()).searchParams.get('story')!;
    const base = '/api/cms/stories/' + storyId + '/locales';
    await page.goto('/?space=' + installation.spaceId + '&story=' + storyId + '&locale=');
    await expect(page.getByText('This locale is not included on this story.')).toBeVisible();
    expect(await (await context.request.get(base, { headers })).json()).toHaveLength(1);
    await page.goto('/?space=' + installation.spaceId + '&story=' + storyId);
    await page.getByRole('button', { name: 'Add locale to story' }).click();
    await page
      .getByRole('group', { name: 'Add locale to story' })
      .getByRole('button', { name: 'Default', exact: true })
      .click();
    await expect(page.getByRole('tab', { name: 'Default', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('button', { name: 'Locale actions' }).click();
    const exclude = page.getByRole('button', { name: 'Exclude Default', exact: true });
    await exclude.focus();
    await exclude.press('Enter');
    await expect(page.getByRole('tab', { name: 'Asia asia' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Default', exact: true })).toHaveCount(0);
    await page.goto('/?space=' + installation.spaceId + '&filterLocale=' + asia.id);
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Asia booking', exact: true }) });
    await expect(row).toContainText('/asia/asia-booking');
    await expect(row.getByText('/asia/asia-booking', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(row).toContainText('Draft');
    await row.getByRole('button', { name: 'Asia booking', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Asia asia' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  } finally {
    await context.close();
    await installation.close();
  }
});

test('renames a localized path from Content and refreshes the open editor', async ({ browser }) => {
  const installation = await reviewInstallation();
  const context = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 390, height: 844 },
  });
  try {
    const { origin, spaceId } = installation;
    const headers = { origin, 'x-storypane-space-id': spaceId };
    const auth = await context.request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: installation.people.admin.email, password: installation.password },
    });
    expect(auth.ok()).toBe(true);
    const post = async (path: string, data: unknown) => {
      const response = await context.request.post(`/api/cms${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const locale: SpaceLocale = await post('/locales', { name: 'Canada', slug: 'ca' });
    const folder = await post('/folders', { name: 'Pages', slug: 'pages' });
    const previewId = crypto.randomUUID();
    const previewSettings = await context.request.put('/api/cms/delivery-settings', {
      headers,
      data: {
        defaultPreviewId: previewId,
        previewUrls: [
          {
            id: previewId,
            name: 'Staging',
            url: 'https://staging.example.test/preview?slug={slug}&locale={locale}',
          },
        ],
      },
    });
    expect(previewSettings.ok(), await previewSettings.text()).toBe(true);
    const source: LocaleSnapshot = await (
      await context.request.get(
        `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}`,
        { headers },
      )
    ).json();
    const story: Story = await post('/stories', {
      name: 'Canadian homepage',
      slug: 'canadian-homepage',
      definitionId: source.blocks.find((block) => block.id === source.locale.rootBlockId)!
        .definitionId,
      folderId: folder.id,
      spaceLocaleId: locale.id,
    });
    const editor = await context.newPage();
    const content = await context.newPage();
    await dismissRecommendedSetup(editor);
    await dismissRecommendedSetup(content);
    await editor.goto(`/?space=${spaceId}&story=${story.id}&locale=ca`);
    await expect(editor.getByText('All changes saved', { exact: true })).toBeVisible();
    await content.goto(`/?space=${spaceId}&folder=${folder.id}`);
    await content.getByRole('button', { name: 'Edit location of Canadian homepage' }).focus();
    await content.keyboard.press('Enter');
    const dialog = content.getByRole('dialog', { name: 'Page location · Canadian homepage' });
    await expect(dialog.getByRole('combobox', { name: 'Language' })).toHaveValue(locale.id);
    await expect(dialog.getByText('/ca/pages/canadian-homepage', { exact: true })).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await dialog.getByRole('textbox', { name: 'Page slug' }).fill('home');
    await content.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(editor.locator('.story-path')).toHaveText('/ca/pages/home', { timeout: 4000 });

    const renamed = await context.request.put(`/api/cms/folders/${folder.id}`, {
      headers,
      data: { name: 'Pages', slug: 'learn' },
    });
    expect(renamed.ok(), await renamed.text()).toBe(true);
    await expect(editor.locator('.story-path')).toHaveText('/ca/learn/home', { timeout: 4000 });
    await editor.route('https://staging.example.test/**', (route) => route.fulfill({ body: '' }));
    const toggle = editor.getByRole('button', { name: 'Preview', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    const link = editor.getByRole('link', { name: 'Open page on selected site' });
    await expect(link).toHaveAttribute('href', 'https://staging.example.test/ca/learn/home');
    await expect(editor.getByTitle('Live application preview')).toHaveAttribute(
      'src',
      'https://staging.example.test/preview?slug=learn%2Fhome&locale=ca&storypane_preview=1',
    );
    await context.route('https://staging.example.test/ca/learn/home', (route) =>
      route.fulfill({ body: '' }),
    );
    await link.focus();
    const popupPromise = editor.waitForEvent('popup');
    await editor.keyboard.press('Enter');
    const popup = await popupPromise;
    await expect(popup).toHaveURL('https://staging.example.test/ca/learn/home');
  } finally {
    await context.close();
    await installation.close();
  }
});
