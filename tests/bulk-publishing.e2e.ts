import { expect, test, type Page } from '@playwright/test';
import { signInPage } from './auth';
import type { StoryAction, PublicationReference } from '@storypane/core';

const names = [
  'Development',
  'Patient Models',
  'Why Medical Aesthetics',
  'the threadlifting course (online only!)',
  'Botox Certification in Kelowna: Everything You Need to Know',
  'Kerri Bogle',
];
const stories = names.map((name, index) => ({
  id: `30000000-0000-4000-8000-00000000000${index}`,
  name,
  slug: `story-${index}`,
  folderId: null,
  pinned: false,
  createdAt: '2026-11-05T10:00:00Z',
  updatedAt: '2026-11-05T10:00:00Z',
  publicationStatus: 'draft',
  localeCount: 2,
  pendingLocaleCount: 2,
}));
const localesFor = (index: number) =>
  ['', 'ca'].map((slug, offset) => ({
    id: `40000000-0000-4000-8000-0000000000${index}${offset}`,
    checkpointId: `50000000-0000-4000-8000-0000000000${index}${offset}`,
    publicationId: null,
    name: slug ? 'English (Canada)' : 'Default',
    slug,
    urlSlug: `blog/${'a-long-story-path-'.repeat(4)}${index}`,
    revision: 2,
  }));

async function fixture(
  page: Page,
  mode: 'partial' | 'partial-unavailable' | 'network' | 'reference' | 'changed-reference',
  action: 'publish' | 'delete' = 'publish',
) {
  const requests: { items: { storyId: string; input: StoryAction }[] }[] = [];
  await page.route('**/api/cms/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cms/stories') return route.fulfill({ json: stories });
    if (path === '/api/cms/folders') return route.fulfill({ json: [] });
    if (path === '/api/cms/stories/bulk') {
      const request = route.request().postDataJSON();
      requests.push(request);
      if (mode === 'network' && requests.length === 1)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'unavailable',
              message: 'The response was interrupted. Retry to confirm the result.',
            },
          },
        });
      return route.fulfill({
        json: request.items.map((item: { storyId: string }) =>
          mode.startsWith('partial') && requests.length === 1 && item.storyId === stories[5].id
            ? {
                storyId: item.storyId,
                error: {
                  code: mode === 'partial-unavailable' ? 'unavailable' : 'invalid',
                  message: 'Resolve validation errors before publishing',
                },
              }
            : {
                storyId: item.storyId,
                result: {
                  story: stories.find((story) => story.id === item.storyId),
                  localeIds: [],
                },
              },
        ),
      });
    }
    const index = stories.findIndex((story) => path.includes(story.id));
    if (index !== -1 && path.endsWith('/review'))
      return route.fulfill({
        json: { story: stories[index], locales: localesFor(index), incomingReferences: [] },
      });
    if (index !== -1 && (path.includes('/publication-review/') || path.includes('/checkpoints/'))) {
      const locale = localesFor(index).find((locale) => path.endsWith(locale.checkpointId))!;
      const references: PublicationReference[] =
        (mode === 'reference' || mode === 'changed-reference') && index === 0 && !locale.slug
          ? [
              {
                storyId: stories[5].id,
                storyName: mode === 'changed-reference' ? 'Changed footer' : 'Draft footer',
                localeId: localesFor(5)[0].id,
                localeName: 'Default',
                checkpointId: localesFor(5)[0].checkpointId,
                publicationId:
                  mode === 'changed-reference' ? '60000000-0000-4000-8000-000000000001' : null,
                revision: 2,
                canPublish: mode === 'changed-reference',
                usages: [
                  { localeId: locale.id, storyName: names[0], field: 'Footer', canOmit: true },
                ],
              },
            ]
          : [];
      return route.fulfill({
        json: {
          id: locale.checkpointId,
          revision: 2,
          content: { title: names[index] },
          snapshot: { story: stories[index], locale, access: { publish: true } },
          references,
        },
      });
    }
    return route.continue();
  });
  await signInPage(page);
  await page.getByRole('checkbox', { name: 'Select up to 50 visible stories' }).check();
  await page
    .getByRole('group', { name: 'Selected story actions' })
    .getByRole('button', { name: action === 'publish' ? 'Publish' : 'Delete', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: action === 'publish' ? 'Publish 6 stories' : 'Delete 6 stories',
    exact: true,
  });
  await expect(dialog.locator('.story-action-review')).toHaveCount(6);
  return { dialog, requests };
}

test('bulk publishing groups successes, shows actionable failures, and reviews only failed stories', async ({
  page,
}, testInfo) => {
  const { dialog, requests } = await fixture(page, 'partial');
  await expect(dialog.locator('.story-action-review[open]')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText('12 locales selected');
  await page.screenshot({ path: testInfo.outputPath('bulk-review-desktop.png') });
  const first = dialog.locator('.story-action-review').filter({ hasText: names[0] });
  await first.locator('summary').click();
  await first
    .getByRole('checkbox', { name: 'Development: English (Canada)', exact: true })
    .uncheck();
  await expect(dialog.getByRole('status')).toContainText('11 locales selected');
  await first
    .getByRole('button', { name: 'View saved revision for Development: Default', exact: true })
    .click();
  const revision = page.getByRole('dialog', { name: 'Saved revision 2', exact: true });
  await expect(revision).toContainText('Development');
  await revision.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await dialog.getByRole('button', { name: 'Publish 6 stories', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('1 story needs attention');
  await expect(dialog.getByRole('status')).toContainText('5 published');
  await expect(dialog.locator('.story-action-review')).toHaveCount(1);
  await expect(
    dialog.getByText('Resolve validation errors before publishing', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('link', { name: 'Open Kerri Bogle in English (Canada) (new tab)' }),
  ).toHaveAttribute(
    'href',
    `/?story=${stories[5].id}&locale=ca&space=11111111-1111-4111-8111-111111111111`,
  );
  await expect(
    dialog.getByRole('button', { name: 'Retry same selections', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('bulk-results-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole('button', { name: 'Review 1 failed story', exact: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole('heading', { name: 'Publish 6 stories', exact: true }),
  ).toBeInViewport();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('bulk-results-mobile.png') });
  await dialog.locator('.story-action-completed > summary').click();
  await expect(dialog.locator('.story-action-completed li')).toHaveCount(5);
  await dialog.getByRole('button', { name: 'Review 1 failed story', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Publish 1 story', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('status')).toContainText('5 published');
  await dialog.getByRole('button', { name: 'Publish 1 story', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].items).toHaveLength(6);
  expect(requests[1].items.map((item) => item.storyId)).toEqual([stories[5].id]);
  expect(requests[1].items[0].input.requestId).not.toBe(requests[0].items[5].input.requestId);
});

test('an interrupted response keeps the exact request for a safe retry', async ({ page }) => {
  const { dialog, requests } = await fixture(page, 'network');
  await dialog.getByRole('button', { name: 'Publish 6 stories', exact: true }).click();
  await expect(
    dialog.getByText('The response was interrupted. Retry to confirm the result.'),
  ).toBeVisible();
  await dialog.locator('.story-action-review > summary').first().click();
  await expect(
    dialog.getByRole('checkbox', { name: 'Development: Default', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Retry same selections', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test('unresolved linked stories expand automatically and block publishing until reviewed', async ({
  page,
}) => {
  const { dialog } = await fixture(page, 'reference');
  await expect(dialog.locator('.story-action-review[open]')).toHaveCount(1);
  await expect(
    dialog.getByRole('button', { name: 'Publish 6 stories', exact: true }),
  ).toBeDisabled();
  const linked = dialog.getByRole('region', { name: 'Linked stories with unpublished content' });
  await expect(linked).toBeVisible();
  await linked
    .getByRole('combobox', { name: 'Action for Draft footer (Default)' })
    .selectOption('omit');
  await expect(
    dialog.getByRole('button', { name: 'Publish 6 stories', exact: true }),
  ).toBeEnabled();
});

test('a partial service failure retries only failed stories with their original request IDs', async ({
  page,
}) => {
  const { dialog, requests } = await fixture(page, 'partial-unavailable');
  await dialog.getByRole('button', { name: 'Publish 6 stories', exact: true }).click();
  await dialog.getByRole('button', { name: 'Retry failed selections', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].items).toEqual([requests[0].items[5]]);
});

test('shared bulk deletion keeps its confirmation and grouped result behavior', async ({
  page,
}) => {
  const { dialog, requests } = await fixture(page, 'partial', 'delete');
  await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('5 deleted');
  await dialog.locator('.story-action-completed > summary').click();
  await expect(dialog.locator('.story-action-completed li')).toHaveCount(5);
  await dialog.getByRole('button', { name: 'Review 1 failed story', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests[1].items).toHaveLength(1);
  expect(requests[1].items[0].input.action).toBe('delete');
});

for (const action of ['publish', 'omit'] as const) {
  test(`changed linked stories require an explicit ${action} choice and carry the reviewed publication`, async ({
    page,
  }, testInfo) => {
    const { dialog, requests } = await fixture(page, 'changed-reference');
    const linked = dialog.getByRole('region', { name: 'Linked stories with unpublished content' });
    await expect(linked.getByText('Unpublished changes', { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Publish 6 stories', exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('changed-linked-story.png') });
    await linked
      .getByRole('combobox', { name: 'Action for Changed footer (Default)' })
      .selectOption(action);
    await dialog.getByRole('button', { name: 'Publish 6 stories', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const input = requests[0].items[0].input;
    expect(input.action).toBe('publish');
    if (input.action === 'publish')
      expect(input.locales[0].referenceChoices).toEqual([
        {
          localeId: localesFor(5)[0].id,
          checkpointId: localesFor(5)[0].checkpointId,
          publicationId: '60000000-0000-4000-8000-000000000001',
          action,
        },
      ]);
  });
}
