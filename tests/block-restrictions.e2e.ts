import { expect, test } from '@playwright/test';
import type { BlockDefinition } from '@storypane/core';
import { signInPage } from './auth';

test('keeps selected allowed blocks visible across scrolling, search and tabs', async ({
  page,
}, testInfo) => {
  const id = (index: number) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const definitions: BlockDefinition[] = Array.from({ length: 25 }, (_, index) => ({
    id: id(index),
    versionId: id(index + 100),
    version: 1,
    createdAt: '2026-11-05T10:00:00Z',
    name: index ? `section_${index}` : 'page',
    displayName: index ? `Section ${index}` : 'Page',
    kind: index ? 'nestable' : 'content-type',
    parentDefinitionId: index > 0 && index < 24 ? id(0) : null,
    fields: index
      ? []
      : [{ name: 'body', label: 'Body', type: 'blocks', allowedDefinitionIds: [id(23), id(24)] }],
  }));
  definitions[24].displayName = 'Shared section with a long name that wraps on small screens';
  await page.route('**/api/cms/definitions**', (route) => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/references')
        ? { total: 0, items: [] }
        : definitions,
    });
  });
  await page.route('**/api/cms/migrations**', (route) => route.fulfill({ json: [] }));
  await signInPage(page);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Blocks', exact: true })
    .click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const drawer = page.locator('dialog.schema-drawer');
  await drawer.getByRole('button', { name: 'Edit body', exact: true }).click();
  const picker = drawer.locator('.block-restrictions');
  const selected = picker.getByRole('group', { name: 'Selected allowed blocks' });
  const search = picker.getByRole('searchbox', { name: 'Search allowed blocks' });
  const choices = picker.locator('.restriction-choices');
  await expect(selected.getByRole('button')).toHaveCount(2);
  await expect(selected).toContainText('Section 23');
  await expect(selected).toContainText(definitions[24].displayName);
  await expect(picker.getByRole('button', { name: 'Nested', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(choices.getByRole('checkbox', { name: /Shared section/ })).toHaveCount(0);
  await choices.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(selected).toBeVisible();
  await search.fill('No matching block');
  await expect(choices.getByRole('checkbox')).toHaveCount(0);
  await expect(selected.getByRole('button')).toHaveCount(2);
  await picker.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(selected.getByRole('button')).toHaveCount(2);
  await expect(choices.getByRole('checkbox', { name: /Section 23/ })).toBeChecked();
  await selected.getByRole('button', { name: 'Remove Section 23 from allowed blocks' }).focus();
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(selected.getByRole('button')).toHaveCount(1);
  await expect(choices.getByRole('checkbox', { name: /Section 23/ })).not.toBeChecked();
  await expect(picker.locator('.restriction-selection')).toContainText('1 selected');
  await choices.getByRole('checkbox', { name: 'Section 1 section_1', exact: true }).check();
  await expect(selected.getByRole('button')).toHaveCount(2);
  await selected.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('allowed-blocks-selected-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await selected.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      selected.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth &&
          element.getBoundingClientRect().right <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => drawer.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('allowed-blocks-selected-mobile.png') });
  await picker.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(selected).toHaveCount(0);
  await expect(choices.locator('input:checked')).toHaveCount(0);
  await expect(picker.locator('.restriction-selection')).toContainText(
    'All nestable and universal blocks',
  );
});
