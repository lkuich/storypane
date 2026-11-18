import { expect, test } from '@playwright/test';
import {
  definitionInput,
  type BlockDefinition,
  type SchemaMigration,
  type LocaleSnapshot,
} from '@storypane/core';
import { dismissRecommendedSetup } from './fixtures/recommended-setup';
import { reviewInstallation } from './fixtures/review-installation';

test('organizes blocks and browses only eligible blocks by folder or in a flat list', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const installation = await reviewInstallation();
  const context = await browser.newContext({ baseURL: installation.origin });
  try {
    const { origin, people, spaceId, storyId, localeId } = installation;
    const signIn = await context.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email: people.admin.email, password: installation.password },
    });
    expect(signIn.ok()).toBe(true);
    const page = await context.newPage();
    await dismissRecommendedSetup(page);
    const editorUrl = `/?space=${spaceId}&story=${storyId}`;
    const libraryUrl = `/?space=${spaceId}&view=blocks`;
    const add = page
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Add block', exact: true });
    const picker = page.getByRole('dialog', { name: 'Add a block' });
    const navigation = picker.getByRole('navigation', { name: 'Block folders' });
    await page.goto(editorUrl);
    await expect(add).toBeEnabled();
    await add.press('Enter');
    await expect(navigation.getByRole('status')).toHaveText('Root');
    await expect(navigation.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(navigation.getByRole('button', { name: 'Forward' })).toBeDisabled();
    await expect(navigation.getByRole('checkbox', { name: 'Flatten blocks' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(libraryUrl);
    const createFolder = page.getByRole('dialog', { name: 'New block folder' });
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    await createFolder.getByLabel('Folder name').fill('Marketing');
    await createFolder.getByRole('button', { name: 'Create folder' }).press('Enter');
    await expect(createFolder).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: 'Open folder Marketing' }).click();
    await expect(page.getByRole('heading', { name: 'This folder is empty' })).toBeVisible();
    await page.goto(editorUrl);
    await expect(add).toBeEnabled();
    await add.press('Enter');
    await picker.getByRole('button', { name: 'Open folder Marketing' }).click();
    await expect(picker.getByRole('heading', { name: 'This folder is empty' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(libraryUrl);
    await page.getByRole('button', { name: 'Edit Hero', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: "Edit 'hero'" });
    await drawer.getByRole('tab', { name: 'Config' }).click();
    const folderSelect = drawer.getByRole('combobox', { name: 'Block folder', exact: true });
    await folderSelect.selectOption('Marketing');
    await drawer.getByRole('button', { name: 'New folder', exact: true }).click();
    await createFolder.getByLabel('Folder name').fill('Heroes');
    await createFolder.getByRole('button', { name: 'Create folder' }).press('Enter');
    await expect(folderSelect).toHaveValue('Marketing/Heroes');
    await drawer.getByRole('button', { name: 'Save to migration' }).click();
    await expect(drawer.getByText('Saved to active migration')).toBeVisible();
    await drawer.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Open folder Marketing' }).press('Enter');
    await page.getByRole('button', { name: 'Open folder Heroes' }).press('Enter');
    await expect(page.getByRole('button', { name: 'Edit Hero', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New block' }).click();
    await expect(page.getByLabel('Block folder', { exact: true })).toHaveValue('Marketing/Heroes');
    await page.keyboard.press('Escape');

    async function cms<T>(path: string, data?: unknown): Promise<T> {
      const response = await context.request.fetch('/api/cms' + path, {
        method: data ? 'POST' : 'GET',
        headers: { origin, 'x-storypane-space-id': spaceId },
        data,
      });
      expect(response.ok(), path).toBe(true);
      return response.json();
    }
    const deployed = await cms<BlockDefinition[]>('/definitions?deployed=true');
    expect(deployed.find((item) => item.name === 'hero')?.folderPath).toBeUndefined();
    const pageDefinition = deployed.find((item) => item.name === 'page')!;
    const create = (name: string, displayName: string, folderPath: string) =>
      cms<BlockDefinition>('/definitions', {
        baseVersion: 1,
        schema: { name, displayName, kind: 'nestable', fields: [], folderPath },
      });
    const card = await create('card', 'Card', 'Marketing/Cards');
    await create('restricted', 'Restricted', 'Hidden');
    await cms(`/definitions/${pageDefinition.id}/versions`, {
      baseVersion: 1,
      expectedVersionId: pageDefinition.versionId,
      schema: {
        ...definitionInput(pageDefinition),
        fields: pageDefinition.fields.map((field) =>
          field.type === 'blocks'
            ? {
                ...field,
                allowedDefinitionIds: [
                  ...deployed.filter((item) => item.kind !== 'content-type').map((item) => item.id),
                  card.id,
                ],
              }
            : field,
        ),
      },
    });
    const migrations = await cms<SchemaMigration[]>('/migrations?workspace=true');
    const active = migrations.find((item) => item.status === 'active')!;
    const review = await cms<{ token: string }>(`/migrations/${active.id}/review`);
    await cms(`/migrations/${active.id}/deploy`, { reviewToken: review.token });
    const snapshot = () => cms<LocaleSnapshot>(`/stories/${storyId}/locales/${localeId}`);
    const before = await snapshot();

    await page.goto(`/?space=${spaceId}&story=${storyId}`);
    const search = picker.getByRole('searchbox', { name: 'Search blocks' });
    const button = (name: string) => picker.getByRole('button', { name, exact: true });
    const flat = picker.getByRole('checkbox', { name: 'Flatten blocks' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(add).toBeEnabled();
      await add.press('Enter');
      await expect(flat).not.toBeChecked();
      await expect(button('Back')).toBeDisabled();
      await expect(button('Forward')).toBeDisabled();
      await expect(button('Open folder Hidden')).toHaveCount(0);
      await expect(button('Add Footer')).toBeVisible();
      await search.fill('hero');
      await expect(picker.getByText('No matching blocks')).toBeVisible();
      await search.fill('market');
      await button('Open folder Marketing').press('Enter');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('');
      await button('Open folder Heroes').press('Enter');
      await expect(button('Add Hero')).toBeVisible();
      await button('Back').press('Enter');
      await button('Forward').press('Enter');
      await expect(button('Add Hero')).toBeVisible();
      await button('Back').press('Enter');
      await button('Open folder Cards').press('Enter');
      await expect(button('Forward')).toBeDisabled();
      await search.fill('footer');
      await expect(button('Add Footer')).toHaveCount(0);
      await flat.press('Space');
      await expect(button('Add Footer')).toBeVisible();
      await search.fill('');
      await expect(button('Add Restricted')).toHaveCount(0);
      await expect(button('Add Page')).toHaveCount(0);
      await expect(button('Add Hero')).toBeVisible();
      await flat.press('Space');
      await expect(button('Add Hero')).toHaveCount(0);
      await expect(button('Add Card')).toBeVisible();
      expect(await picker.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (width === 390) await button('Add Card').press('Enter');
      else await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();
    }
    const after = await snapshot();
    expect(after.blocks).toHaveLength(before.blocks.length + 1);
    expect(after.blocks).toContainEqual(
      expect.objectContaining({
        definitionId: card.id,
        parentId: installation.rootBlockId,
        parentField: 'body',
      }),
    );

    await page.goto(`/?space=${spaceId}&view=blocks`);
    await page.getByRole('button', { name: 'Open folder Marketing' }).click();
    await page.getByRole('button', { name: 'Open folder Cards' }).click();
    await page.getByRole('button', { name: 'Edit Card', exact: true }).click();
    const cardDrawer = page.getByRole('dialog', { name: "Edit 'card'" });
    await cardDrawer.getByRole('tab', { name: 'Config' }).click();
    await cardDrawer.getByRole('combobox', { name: 'Block folder', exact: true }).selectOption('');
    await cardDrawer.getByRole('button', { name: 'Save to migration' }).click();
    await expect(cardDrawer.getByText('Saved to active migration')).toBeVisible();
    await cardDrawer.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('button', { name: 'Open folder Cards' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open folder Heroes' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Block folders' })
      .getByRole('button', { name: 'Back', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Edit Card', exact: true })).toBeVisible();
  } finally {
    await context.close();
    await installation.close();
  }
});
