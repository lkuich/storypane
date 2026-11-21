import { reviewInstallation } from './fixtures/review-installation';
import { dismissRecommendedSetup } from './fixtures/recommended-setup';
import { expect, test } from '@playwright/test';
import type { ContentRelease, Story } from '@storypane/core';

const origin = process.env.STORYPANE_RELEASE_TEST_URL;
test('release approvals, drafts, moving, publishing now and cancellation work across responsive keyboard layouts', async ({
  page,
}) => {
  test.skip(!origin, 'Use a disposable release fixture with seeded pages and local authentication');
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
  for (const group of previous.filter((item) =>
    ['draft', 'scheduled', 'held'].includes(item.status),
  )) {
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

test('publishing review creates a Now release with the approved page', async ({ page }, info) => {
  const installation = await reviewInstallation();
  try {
    const login = await page.request.post(`${installation.origin}/api/auth/sign-in/email`, {
      headers: { origin: installation.origin },
      data: { email: installation.people.admin.email, password: installation.password },
    });
    expect(login.ok()).toBe(true);
    await page.goto(
      `${installation.origin}/?space=${installation.spaceId}&story=${installation.storyId}`,
    );
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
    const dialog = page.getByRole('dialog', { name: 'Review before publishing' });
    const form = dialog.getByRole('form', { name: 'Choose a release' });
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const review = page.getByRole('button', { name: 'Review & publish', exact: true });
      await expect(review).toBeEnabled();
      await review.press('Enter');
      const add = dialog.getByRole('button', { name: 'Add to release', exact: true });
      await expect(add).toBeEnabled();
      await add.press('Enter');
      await expect(form.getByLabel('Release', { exact: true })).toBeFocused();
      const name = form.getByLabel('Release name');
      const schedule = form.getByRole('radio', { name: 'Schedule' });
      const now = form.getByRole('radio', { name: 'Now' });
      const date = form.getByLabel('Release date and time');
      await expect(schedule).toBeChecked();
      await expect(form.getByRole('button', { name: 'Create release & schedule' })).toBeDisabled();
      await date.fill('2099-03-15T09:00');
      await name.fill('Home launch');
      await page.keyboard.press('Tab');
      await expect(schedule).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(now).toBeChecked();
      await expect(date).toBeHidden();
      await expect(form.getByLabel('Timezone')).toBeHidden();
      await page.keyboard.press('ArrowLeft');
      await expect(date).toHaveValue('2099-03-15T09:00');
      await page.keyboard.press('ArrowRight');
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const submit = form.getByRole('button', { name: 'Create & release now' });
      await expect(submit).toBeEnabled();
      await form.screenshot({
        path: info.outputPath(`review-now-${width}.png`),
        animations: 'disabled',
      });
      if (width === 1440) {
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      } else {
        await submit.press('Enter');
        await expect(dialog).toBeHidden();
      }
    }
    const response = await page.request.get(`${installation.origin}/api/cms/releases`, {
      headers: { 'x-storypane-space-id': installation.spaceId },
    });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject([
      {
        name: 'Home launch',
        immediate: true,
        items: [{ storyId: installation.storyId, checkpointRevision: 1 }],
      },
    ]);
  } finally {
    await installation.close();
  }
});

test('release timing and draft contents work across responsive keyboard layouts', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const installation = await reviewInstallation();
  try {
    const login = await page.request.post(installation.origin + '/api/auth/sign-in/email', {
      headers: { origin: installation.origin },
      data: { email: installation.people.admin.email, password: installation.password },
    });
    expect(login.ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(installation.origin + '/?view=releases&space=' + installation.spaceId);
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
    const newRelease = page.getByRole('button', { name: 'New release', exact: true });
    const dialog = page.getByRole('dialog', { name: 'New release', exact: true });
    const draft = dialog.getByRole('radio', { name: 'Draft', exact: true });
    const scheduled = dialog.getByRole('radio', { name: 'Schedule', exact: true });
    const now = dialog.getByRole('radio', { name: 'Now', exact: true });
    const date = dialog.getByLabel('Release date and time');
    await newRelease.press('Enter');
    const name = dialog.getByLabel('Release name');
    await expect(name).toBeFocused();
    await name.fill('On approval');
    await page.keyboard.press('Tab');
    await expect(draft).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(scheduled).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Schedule release' })).toBeDisabled();
    await date.fill('2099-03-15T09:00');
    await dialog.screenshot({ path: info.outputPath('schedule-mobile-dark.png') });
    await scheduled.press('ArrowRight');
    await expect(now).toBeChecked();
    await expect(date).toBeHidden();
    await page.keyboard.press('ArrowLeft');
    await expect(date).toHaveValue('2099-03-15T09:00');
    await scheduled.press('ArrowRight');
    await dialog.getByRole('button', { name: 'Release now' }).press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('region', { name: 'On approval', exact: true })).toContainText(
      'No pages added yet',
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await newRelease.press('Enter');
    await expect(draft).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(newRelease).toBeFocused();
    await newRelease.press('Enter');
    await name.fill('Summer launch');
    await dialog.screenshot({ path: info.outputPath('draft-desktop-dark.png') });
    await page.keyboard.press('Enter');
    const detail = page.getByRole('region', { name: 'Summer launch', exact: true });
    await expect(page.getByRole('button', { name: 'Drafts', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(detail).toContainText('No publication time set');
    await detail.getByRole('button', { name: 'Add content' }).press('Enter');
    const releaseId = new URL(page.url()).searchParams.get('release');
    expect(releaseId).toBeTruthy();
    await page.getByRole('button', { name: 'Home', exact: true }).press('Enter');
    const review = page.getByRole('dialog', { name: 'Review before publishing' });
    const reviewAction = page.getByRole('button', { name: 'Review & publish', exact: true });
    await expect(reviewAction).toBeEnabled();
    await reviewAction.press('Enter');
    const add = review.getByRole('button', { name: 'Add to release', exact: true });
    await expect(add).toBeEnabled();
    await add.press('Enter');
    await expect(review.getByRole('combobox', { name: 'Release', exact: true })).toHaveValue(
      releaseId!,
    );
    await expect(add).toBeEnabled();
    await add.press('Enter');
    const banner = page.getByRole('region', { name: 'Draft release', exact: true });
    await expect(banner).toContainText('Summer launch');
    await banner.getByRole('link', { name: 'View release' }).press('Enter');
    await expect(detail.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(detail.getByText(/Default · Approved revision \d+/)).toBeVisible();

    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 1440)
        await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`draft-contents-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await detail.getByRole('button', { name: 'Set publication' }).press('Enter');
      const plan = page.getByRole('dialog', { name: 'Plan publication' });
      await plan.getByLabel('Timezone', { exact: true }).fill('UTC');
      await plan.getByLabel('Release date and time').fill('2099-03-15T09:00');
      expect(await plan.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      if (width === 320) await page.keyboard.press('Escape');
      else await plan.getByRole('button', { name: 'Schedule release' }).press('Enter');
    }
    await expect(page.getByRole('button', { name: 'Upcoming', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(detail).toContainText('Scheduled');
    await expect(detail.getByText(/Approved revision \d+/)).toBeVisible();
  } finally {
    await installation.close();
  }
});
