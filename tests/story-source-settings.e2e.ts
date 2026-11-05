import { expect, test } from '@playwright/test';
import type { BlockDefinition } from '@storypane/core';
import { signInPage } from './auth';

test('filters story content types to direct children without changing the saved restriction', async ({
  page,
}, testInfo) => {
  const id = (index: number) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const definitions: BlockDefinition[] = [
    { displayName: 'Page', kind: 'content-type', parentDefinitionId: null },
    { displayName: 'Article', kind: 'content-type', parentDefinitionId: id(1) },
    { displayName: 'Shared', kind: 'universal', parentDefinitionId: id(1) },
    { displayName: 'Grandchild', kind: 'content-type', parentDefinitionId: id(2) },
    { displayName: 'Other', kind: 'content-type', parentDefinitionId: null },
    { displayName: 'Section', kind: 'nestable', parentDefinitionId: id(1) },
    { displayName: 'Section only', kind: 'nestable', parentDefinitionId: id(5) },
  ].map((item, index) => ({
    ...item,
    kind: item.kind as BlockDefinition['kind'],
    name: item.displayName.toLowerCase().replaceAll(' ', '_'),
    id: id(index + 1),
    versionId: id(index + 101),
    version: 1,
    createdAt: '2026-11-05T10:00:00Z',
    fields: [
      { name: 'related', label: 'Related', type: 'option', source: { type: 'stories' } },
      {
        name: 'others',
        label: 'Others',
        type: 'options',
        source: { type: 'stories', contentTypeId: id(5) },
      },
    ],
  }));
  let saves = 0;
  await page.route('**/api/cms/definitions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/references')) return route.fulfill({ json: { total: 0, items: [] } });
    if (request.method() === 'GET') return route.fulfill({ json: definitions });
    expect(path).toBe(`/api/cms/definitions/${id(1)}/versions`);
    expect(request.method()).toBe('POST');
    const input = request.postDataJSON();
    expect(input.schema.fields[0].source).toEqual({ type: 'stories', contentTypeId: id(5) });
    definitions[0] = { ...definitions[0], ...input.schema };
    saves++;
    return route.fulfill({ json: definitions[0] });
  });
  await page.route('**/api/cms/migrations**', (route) => route.fulfill({ json: [] }));
  await signInPage(page);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Blocks', exact: true })
    .click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const drawer = page.locator('dialog.schema-drawer');
  const filter = drawer.getByRole('checkbox', { name: 'Show only directly nested blocks' });
  const contentType = drawer.getByLabel('Restrict to a content type', { exact: true });
  const save = drawer.getByRole('button', { name: 'Save to migration', exact: true });
  await drawer.getByRole('button', { name: 'Edit related', exact: true }).click();
  await expect(filter).toBeChecked();
  await expect(contentType.locator('option')).toHaveText(['All stories', 'Article', 'Shared']);
  await filter.focus();
  await page.keyboard.press('Space');
  await expect(filter).not.toBeChecked();
  await expect(contentType.locator('option')).toHaveText([
    'All stories',
    'Page',
    'Article',
    'Shared',
    'Grandchild',
    'Other',
  ]);
  await expect(save).toBeDisabled();
  await contentType.selectOption(id(5));
  await filter.check();
  await expect(contentType).toHaveValue(id(5));
  await expect(contentType.locator('option')).toHaveText([
    'All stories',
    'Article',
    'Shared',
    'Other',
  ]);
  await expect(contentType.locator('optgroup')).toHaveAttribute(
    'label',
    'Current selection (outside nested blocks)',
  );
  await save.click();
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible();
  expect(saves).toBe(1);
  await drawer.getByRole('button', { name: 'Edit others', exact: true }).click();
  await expect(filter).not.toBeChecked();
  await expect(contentType).toHaveValue(id(5));
  await drawer.getByLabel('Option source', { exact: true }).selectOption('inline');
  await expect(filter).toHaveCount(0);
  await drawer.getByLabel('Option source', { exact: true }).selectOption('stories');
  await expect(filter).toBeChecked();
  await expect(contentType.locator('option')).toHaveText(['All stories', 'Article', 'Shared']);
  await filter.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('nested-story-types-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => drawer.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await filter.scrollIntoViewIfNeeded();
  await expect(filter).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('nested-story-types-mobile.png') });
  page.once('dialog', (dialog) => dialog.accept());
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Other', exact: true }).click();
  await drawer.getByRole('button', { name: 'Edit related', exact: true }).click();
  await expect(filter).not.toBeChecked();
  await expect(contentType.locator('option')).toHaveCount(6);
  await filter.check();
  await expect(contentType.locator('option')).toHaveText(['All stories']);
  await expect(
    drawer.getByRole('status').filter({ hasText: 'No directly nested content types.' }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
});
