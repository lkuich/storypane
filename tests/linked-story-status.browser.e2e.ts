import { expect, test } from '@playwright/test';
import type { PublicationStatus } from '@storypane/core';

const options = (values: string[], status: PublicationStatus) => ({
  items: values.map((value) => ({
    value,
    label: value === 'footer' ? 'Footer' : 'Navigation',
    publication: { status, localeName: 'Default', localeSlug: 'ca' },
  })),
});

for (const type of ['option', 'options', 'link']) {
  test(`${type} reference status refreshes on publication without navigation, focus, or polling`, async ({
    page,
  }) => {
    let status: PublicationStatus = 'draft';
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.route('**/api/cms/options', (route) =>
      route.fulfill({ json: options(route.request().postDataJSON().values, status) }),
    );
    await page.goto(`/references.html?space=fixture&locale=ca&type=${type}`);
    const badges = page.locator(
      type === 'options'
        ? '.option-story-list .publication-status'
        : '.option-control .publication-status',
    );
    await expect(badges).toHaveText(type === 'options' ? ['Draft', 'Draft'] : ['Draft']);
    const reference = await page.getByLabel('Stored reference').textContent();
    status = 'published';
    await page.getByRole('button', { name: 'Apply publication' }).click();
    await expect(badges).toHaveText(
      type === 'options' ? ['Published', 'Published'] : ['Published'],
      { timeout: 3000 },
    );
    await expect(page.getByLabel('Stored reference')).toHaveText(reference!);
  });
}

test('an in-flight draft status response cannot overwrite the completed publication', async ({
  page,
}) => {
  let status: PublicationStatus = 'draft';
  let hold = false;
  let release: (() => void) | undefined;
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.route('**/api/cms/options', async (route) => {
    const response = options(route.request().postDataJSON().values, status);
    if (hold) {
      hold = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.fulfill({ json: response }).catch(() => {}); // The obsolete fetch is aborted on publication.
  });
  await page.goto('/references.html?space=fixture&locale=ca');
  const badge = page.locator('.option-control .publication-status');
  await expect(badge).toHaveText('Draft');
  hold = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => !!release).toBe(true);
  status = 'published';
  await page.getByRole('button', { name: 'Apply publication' }).click();
  await expect(badge).toHaveText('Published', { timeout: 3000 });
  release!();
  await expect(badge).toHaveText('Published');
});

test('reorders selected stories by drag and keyboard and removes individual references', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.route('**/api/cms/options', (route) =>
    route.fulfill({ json: options(route.request().postDataJSON().values, 'published') }),
  );
  await page.goto('/references.html?space=fixture&locale=ca&type=options');
  const handle = page.getByRole('button', { name: /^Reorder Footer,/ });
  const stored = page.getByLabel('Stored reference');
  await handle.dragTo(page.getByRole('listitem').nth(1));
  await expect(stored).toHaveText('["navigation","footer"]');
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect(stored).toHaveText('["footer","navigation"]');
  await expect(handle).toBeFocused();
  const remove = page.getByRole('button', { name: 'Remove Footer' });
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(stored).toHaveText('["navigation"]');
  await expect(page.getByRole('button', { name: 'Remove Navigation' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(stored).toHaveText('[]');
  await expect(page.getByRole('button', { name: 'Footer', exact: true })).toBeFocused();
});
