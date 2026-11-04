import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ContentScopes, Permission, SpaceRole } from '@storypane/core';

const ids = {
  space: '10000000-0000-4000-8000-000000000001',
  blog: '20000000-0000-4000-8000-000000000001',
  news: '20000000-0000-4000-8000-000000000002',
  legal: '20000000-0000-4000-8000-000000000003',
  terms: '30000000-0000-4000-8000-000000000001',
  announcement: '30000000-0000-4000-8000-000000000002',
  english: '40000000-0000-4000-8000-000000000001',
  french: '40000000-0000-4000-8000-000000000002',
  article: '50000000-0000-4000-8000-000000000001',
  product: '50000000-0000-4000-8000-000000000002',
  headline: '60000000-0000-4000-8000-000000000001',
  body: '60000000-0000-4000-8000-000000000002',
  price: '60000000-0000-4000-8000-000000000003',
  role: '70000000-0000-4000-8000-000000000001',
};
type RoleInput = { name: string; permissions: Permission[]; contentScopes: ContentScopes };

async function mockRoles(page: Page) {
  let saved: RoleInput | undefined;
  let roles: SpaceRole[] = [];
  const choices = {
    folders: [
      { id: ids.blog, name: 'Blog', slug: 'blog', parentId: null },
      { id: ids.news, name: 'News', slug: 'news', parentId: ids.blog },
      { id: ids.legal, name: 'Legal', slug: 'legal', parentId: null },
    ],
    stories: [
      { id: ids.terms, name: 'Terms', slug: 'legal/terms' },
      { id: ids.announcement, name: 'Announcement', slug: 'announcement' },
    ],
    locales: [
      { id: ids.english, name: 'English', slug: '', storyCount: 2 },
      { id: ids.french, name: 'French', slug: 'fr', storyCount: 2 },
    ],
    definitions: [
      {
        id: ids.article,
        name: 'article',
        displayName: 'Article',
        fields: [
          {
            id: ids.headline,
            name: 'headline',
            label: 'Headline',
            type: 'text',
            format: 'singleline',
          },
          { id: ids.body, name: 'body', label: 'Body', type: 'text', format: 'richtext' },
        ],
      },
      {
        id: ids.product,
        name: 'product',
        displayName: 'Product',
        fields: [{ id: ids.price, name: 'price', label: 'Price', type: 'number' }],
      },
    ],
  };
  await page.route('**/api/cms/**', async (route) => {
    const request = route.request();
    const resource = new URL(request.url()).pathname.split('/')[3];
    expect(request.headers()['x-storypane-space-id']).toBe(ids.space);
    if (resource === 'roles') {
      if (request.method() === 'POST' || request.method() === 'PUT') {
        saved = request.postDataJSON() as RoleInput;
        roles = [{ ...saved, id: ids.role, system: false, memberCount: 0, invitationCount: 0 }];
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: roles });
    }
    if (resource in choices)
      return route.fulfill({ json: choices[resource as keyof typeof choices] });
    return route.fulfill({
      status: 404,
      json: { error: { message: 'Unexpected fixture request' } },
    });
  });
  await page.goto(`/roles.html?space=${ids.space}`);
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create role', exact: true });
  await expect(dialog.getByLabel('Role name')).toBeEnabled();
  return { dialog, choices, saved: () => saved };
}

async function restrict(dialog: Locator, label: string, selected: string[]) {
  const group = dialog.getByRole('group', { name: label, exact: true });
  await group.getByRole('checkbox', { name: `All ${label.toLowerCase()}`, exact: true }).uncheck();
  await expect(
    group.getByText('Nothing selected: access is denied in this dimension.', { exact: true }),
  ).toBeVisible();
  for (const name of selected) await group.getByRole('checkbox', { name, exact: true }).check();
  await expect(group.getByText(`${selected.length} selected`, { exact: true })).toBeVisible();
}

// Real role/settings components; authorization and effective policy are covered by Postgres tests.
test('saves independent read, edit and publish scopes as stable IDs and preserves them after renames', async ({
  page,
}) => {
  const fixture = await mockRoles(page),
    { dialog } = fixture;
  await dialog.getByLabel('Role name').fill('French blog editor');
  await dialog.getByRole('checkbox', { name: 'Create and edit content', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Publish content', exact: true }).check();
  const action = dialog.getByLabel('Configure access for');
  const locations = dialog.getByRole('group', { name: 'Locations', exact: true });
  await locations.getByRole('checkbox', { name: 'All locations', exact: true }).uncheck();
  await locations.getByRole('textbox', { name: 'Search locations' }).fill('blog');
  await expect(
    locations.getByRole('checkbox', { name: 'Folder: /legal', exact: true }),
  ).not.toBeVisible();
  await locations.getByRole('checkbox', { name: 'Folder: /blog', exact: true }).check();
  await locations.getByRole('textbox', { name: 'Search locations' }).clear();
  await locations.getByRole('checkbox', { name: 'Story: Terms /legal/terms', exact: true }).check();
  await expect(locations.getByText('2 selected', { exact: true })).toBeVisible();
  await restrict(dialog, 'Locales', ['English', 'French']);
  await restrict(dialog, 'Block types', ['Article']);
  await restrict(dialog, 'Fields', ['Article → Headline', 'Article → Body']);

  await action.selectOption('edit');
  await expect(
    locations.getByRole('checkbox', { name: 'All locations', exact: true }),
  ).toBeChecked();
  await restrict(dialog, 'Locations', ['Folder: /blog/news', 'Story: Terms /legal/terms']);
  await restrict(dialog, 'Locales', ['French']);
  await restrict(dialog, 'Block types', ['Article']);
  await restrict(dialog, 'Fields', ['Article → Headline']);

  await action.selectOption('publish');
  await expect(dialog.getByRole('checkbox', { name: 'All fields', exact: true })).toBeChecked();
  await restrict(dialog, 'Locations', ['Folder: /blog', 'Story: Announcement /announcement']);
  await restrict(dialog, 'Locales', ['French']);
  await restrict(dialog, 'Block types', ['Article']);
  await restrict(dialog, 'Fields', ['Article → Headline', 'Article → Body']);
  await expect(
    dialog.getByText('Publishing applies to the entire locale.', { exact: false }),
  ).toBeVisible();

  await action.selectOption('read');
  await expect(
    locations.getByRole('checkbox', { name: 'Folder: /blog', exact: true }),
  ).toBeChecked();
  await expect(
    locations.getByRole('checkbox', { name: 'Folder: /blog/news', exact: true }),
  ).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'English', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(fixture.saved()).toEqual({
    name: 'French blog editor',
    permissions: ['content:read', 'content:edit', 'content:publish'],
    contentScopes: {
      read: {
        locations: { folderIds: [ids.blog], storyIds: [ids.terms] },
        localeIds: [ids.english, ids.french],
        definitionIds: [ids.article],
        fieldIds: [ids.headline, ids.body],
      },
      edit: {
        locations: { folderIds: [ids.news], storyIds: [ids.terms] },
        localeIds: [ids.french],
        definitionIds: [ids.article],
        fieldIds: [ids.headline],
      },
      publish: {
        locations: { folderIds: [ids.blog], storyIds: [ids.announcement] },
        localeIds: [ids.french],
        definitionIds: [ids.article],
        fieldIds: [ids.headline, ids.body],
      },
    },
  });
  await expect(
    page.getByRole('heading', { name: 'French blog editor', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Role request state')).toHaveText('Ready');

  fixture.choices.folders[0].slug = 'journal';
  fixture.choices.stories[0].name = 'Terms renamed';
  fixture.choices.definitions[0].fields[0].label = 'Heading renamed';
  await page.getByRole('button', { name: 'Edit role', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit French blog editor', exact: true });
  await expect(editDialog.getByLabel('Role name')).toBeEnabled();
  await editDialog.getByLabel('Configure access for').selectOption('read');
  await expect(
    editDialog.getByRole('checkbox', { name: 'Folder: /journal', exact: true }),
  ).toBeChecked();
  await expect(
    editDialog.getByRole('checkbox', { name: 'Story: Terms renamed /legal/terms', exact: true }),
  ).toBeChecked();
  await expect(
    editDialog.getByRole('checkbox', { name: 'Article → Heading renamed', exact: true }),
  ).toBeChecked();
  await editDialog.getByLabel('Configure access for').selectOption('edit');
  await expect(
    editDialog.getByRole('checkbox', { name: 'Folder: /journal/news', exact: true }),
  ).toBeChecked();
  await expect(
    editDialog.getByRole('checkbox', { name: 'Article → Body', exact: true }),
  ).not.toBeChecked();
});

test('empty scope selection stays deny-all instead of becoming unrestricted', async ({ page }) => {
  const fixture = await mockRoles(page),
    { dialog } = fixture;
  await dialog.getByLabel('Role name').fill('No locales');
  const locales = dialog.getByRole('group', { name: 'Locales', exact: true });
  await locales.getByRole('checkbox', { name: 'All locales', exact: true }).uncheck();
  await expect(
    locales.getByText('Nothing selected: access is denied in this dimension.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(fixture.saved()?.contentScopes.read.localeIds).toEqual([]);
  expect(fixture.saved()?.contentScopes.edit.localeIds).toBeNull();
  expect(fixture.saved()?.contentScopes.publish.localeIds).toBeNull();
  await page.getByRole('button', { name: 'Edit role', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Edit No locales', exact: true });
  await expect(
    reopened.getByRole('checkbox', { name: 'All locales', exact: true }),
  ).not.toBeChecked();
  await expect(
    reopened.getByText('Nothing selected: access is denied in this dimension.', { exact: true }),
  ).toBeVisible();
});

test('write grants without read permission display the ineffective-grants warning', async ({
  page,
}) => {
  const { dialog } = await mockRoles(page);
  await dialog.getByRole('checkbox', { name: 'Create and edit content', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Publish content', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Read content', exact: true }).uncheck();
  await dialog.getByLabel('Configure access for').selectOption('edit');
  const warning = dialog.getByText(
    'Content read is disabled. Editing and publishing grants are ineffective until read access is enabled.',
    { exact: true },
  );
  await expect(warning).toBeVisible();
  await dialog.getByLabel('Configure access for').selectOption('publish');
  await expect(warning).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Read content', exact: true }).check();
  await expect(warning).not.toBeVisible();
});
