import { expect, test } from '@playwright/test';
import { signInPage } from './auth';

const alpha = '20000000-0000-4000-8000-000000000001';
const nested = '20000000-0000-4000-8000-000000000002';
const sibling = '20000000-0000-4000-8000-000000000003';
const folders = [
  { id: alpha, name: 'Alpha', slug: 'alpha', parentId: null },
  { id: nested, name: 'Nested', slug: 'nested', parentId: alpha },
  { id: sibling, name: 'Sibling', slug: 'sibling', parentId: null },
].map((folder) => ({
  ...folder,
  localeSlugs: {},
  allowedDefinitionIds: [],
  defaultDefinitionId: null,
}));
const stories = [
  { name: 'Home', slug: 'home', folderId: null },
  { name: 'Schedule', slug: 'schedule', folderId: null },
  { name: 'Alpha page', slug: 'alpha/page', folderId: alpha },
  { name: 'Nested page', slug: 'alpha/nested/page', folderId: nested },
  { name: 'Sibling page', slug: 'sibling/page', folderId: sibling },
].map((story, index) => ({
  ...story,
  id: `30000000-0000-4000-8000-00000000000${index}`,
  pinned: index === 3,
  createdAt: '2026-11-05T10:00:00Z',
  updatedAt: '2026-11-05T10:00:00Z',
  publicationStatus: 'draft',
  localeCount: 1,
  pendingLocaleCount: 1,
}));

test('folder lists stay local and navigation clears selection and supports back/forward', async ({
  page,
}) => {
  await page.route('**/api/cms/stories', (route) => route.fulfill({ json: stories }));
  await page.route('**/api/cms/folders', (route) => route.fulfill({ json: folders }));
  await signInPage(page);
  const rows = page.locator('.data-table tbody tr');
  const navigation = page.getByRole('group', { name: 'Folder navigation' });
  const back = navigation.getByRole('button', { name: 'Back', exact: true });
  const forward = navigation.getByRole('button', { name: 'Forward', exact: true });
  const actions = page.getByRole('group', { name: 'Selected story actions' });
  const breadcrumbs = page.getByRole('navigation', { name: 'Content folders' });
  const openFolder = (name: string) =>
    page
      .getByRole('region', { name: 'Folders', exact: true })
      .getByRole('button', { name: new RegExp(`^${name} /`) })
      .click();

  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Nested page', exact: true })).toHaveCount(0);
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select up to 50 visible stories' }).check();
  await expect(actions).toContainText('2 selected');
  for (const name of ['Publish', 'Unpublish', 'Duplicate', 'Move', 'Delete', 'Clear selection'])
    await expect(
      actions.getByRole('button', { name, exact: true }).locator('svg[aria-hidden="true"]'),
    ).toHaveCount(1);

  await openFolder('Alpha');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Alpha page');
  await expect(actions).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`folder=${alpha}`));
  await page.getByRole('checkbox', { name: 'Select Alpha page', exact: true }).check();
  await openFolder('Nested');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Nested page');
  await expect(actions).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Select Nested page', exact: true }).check();
  await back.click();
  await expect(rows).toContainText('Alpha page');
  await expect(actions).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'Select Alpha page', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Select Alpha page', exact: true }).check();
  await forward.click();
  await expect(rows).toContainText('Nested page');
  await expect(actions).toHaveCount(0);
  await expect(forward).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select Nested page', exact: true }).check();
  await breadcrumbs.getByRole('button', { name: 'Root', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(actions).toHaveCount(0);
  await back.click();
  await expect(rows).toContainText('Nested page');
  await back.click();
  await expect(rows).toContainText('Alpha page');
  // A new visit replaces the forward branch.
  await breadcrumbs.getByRole('button', { name: 'Root', exact: true }).click();
  await expect(forward).toBeDisabled();
  await openFolder('Sibling');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Sibling page');
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Sibling page');
});
