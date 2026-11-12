import { dismissRecommendedSetup } from './fixtures/recommended-setup';
import { expect, test } from '@playwright/test';
import type { ContentRelease, Story } from '@storypane/core';

const origin = process.env.STORYPANE_RELEASE_TEST_URL;
test.skip(!origin, 'Use a disposable release fixture with seeded pages and local authentication');
test('release approvals, drafts, moving, publishing now and cancellation work across responsive keyboard layouts', async ({
  page,
}) => {
  test.setTimeout(120000);
  if (!origin || !['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
    throw new Error('Release acceptance requires a disposable local installation');
  const space = '11111111-1111-4111-8111-111111111111';
  const headers = { 'x-storypane-space-id': space };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel('Email', { exact: true }).fill('editor@releases.test');
  await page.getByLabel('Password', { exact: true }).fill('release-browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  await page.goto(`${origin}/?space=${space}`);
  const previous = (await (
    await page.request.get(`${origin}/api/cms/releases`, { headers })
  ).json()) as ContentRelease[];
  for (const group of previous.filter((item) => ['scheduled', 'held'].includes(item.status))) {
    const removed = await page.request.delete(`${origin}/api/cms/releases/${group.id}`, {
      headers: { ...headers, Origin: origin },
      data: { requestId: crypto.randomUUID(), revision: group.revision },
    });
    expect(removed.ok()).toBe(true);
  }
  const stories = (await (
    await page.request.get(`${origin}/api/cms/stories`, { headers })
  ).json()) as Story[];
  const home = stories.find((story) => story.name === 'Home')!;
  const collection = stories.find((story) => story.name === 'Summer collection')!;
  const time = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
  const dialog = page.getByRole('dialog', { name: 'Review before publishing', exact: true });
  async function reviewStory(id: string) {
    await page.goto(`${origin}/?space=${space}&story=${id}`);
    await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
    await expect(dialog).toBeVisible();
  }
  await reviewStory(home.id);
  await dialog.getByRole('button', { name: 'Add to release', exact: true }).click();
  await dialog.getByLabel('Release name', { exact: true }).fill('Summer launch');
  await dialog.getByLabel('Timezone', { exact: true }).fill('UTC');
  await dialog.getByLabel('Release date and time', { exact: true }).fill(time);
  await dialog.getByRole('button', { name: 'Create release & schedule', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Scheduled release' })).toContainText(
    'Summer launch',
  );
  const groups = (await (
    await page.request.get(`${origin}/api/cms/releases`, { headers })
  ).json()) as ContentRelease[];
  const launch = groups.find(
    (group) => group.name === 'Summer launch' && group.status === 'scheduled',
  )!;
  await reviewStory(collection.id);
  await dialog.getByRole('button', { name: 'Add to release', exact: true }).click();
  await dialog.getByLabel('Release', { exact: true }).selectOption(launch.id);
  await dialog.getByRole('button', { name: 'Add to release', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await page.goto(`${origin}/?space=${space}&story=${home.id}`);
  await page
    .getByRole('textbox', { name: 'Page title', exact: true })
    .fill(`Our next campaign — draft ${Date.now()}`);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scheduled release' })).toContainText(
    'Newer draft edits are not included',
  );
  await page.getByRole('link', { name: 'View release' }).click();
  await expect(
    page.getByRole('region', { name: 'Summer launch', exact: true }).getByRole('link'),
  ).toHaveCount(2);
  await expect(
    page.getByText('Newer draft changes are not included', { exact: true }),
  ).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/releases-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.screenshot({ path: 'test-results/releases-docs.png', fullPage: true });
  await page.getByRole('button', { name: 'New release', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'New release', exact: true })).toBeVisible();
  await expect(page.getByLabel('Release name', { exact: true })).toBeFocused();
  for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'New release', exact: true })).toBeFocused();

  await reviewStory(home.id);
  await dialog.getByRole('button', { name: 'Update release', exact: true }).click();
  await dialog.getByRole('button', { name: 'Update release', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await reviewStory(home.id);
  await dialog.getByRole('button', { name: 'Update release', exact: true }).click();
  await dialog.getByLabel('Release', { exact: true }).selectOption('new');
  await dialog.getByLabel('Release name', { exact: true }).fill('Autumn launch');
  await dialog.getByLabel('Timezone', { exact: true }).fill('UTC');
  await dialog.getByLabel('Release date and time', { exact: true }).fill(time);
  await expect(dialog.getByText('This moves the page out of', { exact: false })).toContainText(
    'Summer launch',
  );
  await dialog.getByRole('button', { name: 'Move to release', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Scheduled release' })).toContainText(
    'Autumn launch',
  );
  await reviewStory(home.id);
  await dialog
    .getByRole('button', { name: 'Publish now & remove from release', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Scheduled release' })).not.toBeVisible();
  await page.goto(`${origin}/?space=${space}&view=releases&release=${launch.id}`);
  await expect(
    page.getByRole('region', { name: 'Summer launch', exact: true }).getByRole('link'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel release', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel release', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('This release was cancelled.')).toBeVisible();
  await page.reload();
  const final = (await (
    await page.request.get(`${origin}/api/cms/releases`, { headers })
  ).json()) as ContentRelease[];
  expect(final.find((group) => group.id === launch.id)?.status).toBe('cancelled');
  expect(
    final.find((group) => group.name === 'Autumn launch' && group.status === 'scheduled')?.items,
  ).toHaveLength(0);
  expect(errors).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await dismissRecommendedSetup(page);
});
