import { expect, test, type APIRequestContext } from '@playwright/test';
import type { PublicationSchedule, Story, StoryActionResult, StoryLocale } from '@storypane/core';
import { signInPage } from './auth';
const headers = { Origin: 'http://127.0.0.1:3130' };
async function duplicate(request: APIRequestContext, name: string) {
  const list = await request.get('/api/cms/stories');
  expect(list.ok()).toBeTruthy();
  const stories = (await list.json()) as Story[];
  const response = await request.post(`/api/cms/stories/${stories[0].id}/duplicate`, {
    headers,
    data: {
      requestId: crypto.randomUUID(),
      folderId: null,
      name,
      slug: `lifecycle-${crypto.randomUUID()}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as StoryActionResult;
}
test('bulk review keeps a stale item selected while the successful item can be restored', async ({
  page,
}) => {
  await signInPage(page);
  const first = await duplicate(page.request, `First ${Date.now()}`),
    second = await duplicate(page.request, `Second ${Date.now()}`);
  await page.reload();
  await page.getByRole('checkbox', { name: `Select ${first.story.name}`, exact: true }).check();
  await page.getByRole('checkbox', { name: `Select ${second.story.name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete 2 stories', exact: true });
  await expect(dialog.getByRole('heading', { name: first.story.name, exact: true })).toBeVisible();
  const moved = await page.request.put(`/api/cms/stories/${first.story.id}/location`, {
    headers,
    data: { folderId: null, slug: `changed-${crypto.randomUUID()}`, localeSlugs: {} },
  });
  expect(moved.ok()).toBeTruthy();
  await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(dialog.getByText(/The story changed/)).toBeVisible();
  await expect(dialog.getByText(`${second.story.name}: Completed`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: `Select ${first.story.name}`, exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Deleted stories', exact: true }).click();
  await page.getByRole('checkbox', { name: `Select ${second.story.name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm restore', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: `Restore ${second.story.name}`, exact: true }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Show active stories', exact: true }).click();
  await expect(page.getByRole('button', { name: second.story.name, exact: true })).toBeVisible();
});
test('review schedules an explicit UTC revision and cancellation remains visible after reload', async ({
  page,
}) => {
  await signInPage(page);
  const copied = await duplicate(page.request, `Schedule ${Date.now()}`);
  await page.reload();
  await page.getByRole('button', { name: copied.story.name, exact: true }).click();
  await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review before publishing', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Schedule this revision', exact: true }),
  ).not.toBeVisible();
  await dialog.getByRole('button', { name: 'More publishing options', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Schedule this revision', exact: true }),
  ).not.toBeVisible();
  await dialog.getByRole('button', { name: 'More publishing options', exact: true }).click();
  await dialog.getByRole('button', { name: 'Schedule this revision', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Publish revision/ })).not.toBeVisible();
  await expect(dialog.getByLabel('Local date and time', { exact: true })).toBeFocused();
  const time = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await dialog.getByLabel('Timezone', { exact: true }).fill('UTC');
  await dialog.getByLabel('Local date and time', { exact: true }).fill(time);
  await dialog.getByRole('button', { name: 'Schedule publication', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/Scheduled · revision/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Scheduled · revision/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel schedule', exact: true }).click();
  await expect(page.getByText(/Scheduled · revision/)).not.toBeVisible();
  const locales = (await (
    await page.request.get(`/api/cms/stories/${copied.story.id}/locales`)
  ).json()) as StoryLocale[];
  const schedules = (await (
    await page.request.get(`/api/cms/stories/${copied.story.id}/locales/${locales[0].id}/schedules`)
  ).json()) as PublicationSchedule[];
  expect(schedules[0]).toMatchObject({
    status: 'cancelled',
    timezone: 'UTC',
    dueAt: `${time}:00.000Z`,
  });
});
