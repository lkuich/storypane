import { expect, test } from '@playwright/test';

test('publishing a large page shows only changed components with accessible field comparisons', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/publication-review.html');
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const trigger = page.getByRole('button', { name: 'Review & publish' });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Review before publishing' });
      await expect(dialog.getByRole('heading', { name: '2 components changed' })).toBeVisible();
      await expect(dialog).toContainText('49 unchanged components hidden');
      await expect(dialog.locator('.publication-change')).toHaveCount(2);
      await expect(dialog.getByText('Section 50', { exact: true })).not.toBeVisible();
      await expect(dialog.locator('.publication-full-content pre')).not.toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Publish revision 46' })).toBeInViewport();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/publication-review-${theme}-${width}.png`,
        fullPage: true,
      });
      const row = dialog.locator('.publication-change').first();
      await row.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(row.getByText('Build something wonderful', { exact: true })).toBeVisible();
      await expect(row.getByText('Your next chapter starts here', { exact: true })).toBeVisible();
      await expect(row.getByRole('heading', { name: 'Description', exact: true })).toHaveCount(0);
      await page.keyboard.press('Space');
      await expect(row.locator('.publication-change-detail')).not.toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
  }
  expect(errors).toEqual([]);
});

test('first publication is compact, and unchanged content does not list the whole page', async ({
  page,
}) => {
  await page.goto('/publication-review.html?mode=first');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('heading', { name: 'No live version to compare' })).toBeVisible();
  await expect(page.locator('.publication-change').first()).not.toBeVisible();
  await page.getByText('View 51 components', { exact: true }).click();
  await expect(page.locator('.publication-change')).toHaveCount(51);
  await expect(page.getByRole('button', { name: 'Publish revision 46' })).toBeInViewport();
  await page.goto('/publication-review.html?mode=unchanged');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(
    page.getByRole('heading', { name: 'Content matches the live version' }),
  ).toBeVisible();
  await expect(page.locator('.publication-change')).toHaveCount(0);
});
