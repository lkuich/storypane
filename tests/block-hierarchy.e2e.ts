import { expect, test, type Page } from '@playwright/test';
import { signInPage } from './auth';
import type { BlockDefinition, SchemaMigration, MigrationReview } from '@storypane/core';

const origin = 'http://127.0.0.1:3130';

async function workspace(page: Page) {
  await signInPage(page);
  const response = await page.request.post('/api/spaces', {
    headers: { Origin: origin },
    data: { name: `Hierarchy ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const space = (await response.json()) as { id: string };
  const headers = { Origin: origin, 'x-storypane-space-id': space.id };
  for (const name of ['Layout', 'Sections']) {
    const created = await page.request.post('/api/cms/definitions', {
      headers,
      data: {
        baseVersion: 0,
        schema: {
          name: name.toLowerCase(),
          displayName: name,
          kind: 'universal',
          fields: [{ name: 'body', label: 'Body', type: 'blocks' }],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
  }
  await page.goto(`/?space=${space.id}`);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Blocks', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Block library' })).toBeVisible();
  const definitions = async () =>
    (await (
      await page.request.get('/api/cms/definitions', { headers })
    ).json()) as BlockDefinition[];
  return { definitions, headers };
}

async function saveAndClose(page: Page, create = false) {
  const drawer = page.locator('dialog.schema-drawer');
  await drawer
    .getByRole('button', { name: create ? 'Create block' : 'Save to migration', exact: true })
    .click();
  await expect(drawer.getByText('Saved to active migration', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(drawer).not.toBeVisible();
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`organizes multilevel definitions and preserves allowed selections (${colorScheme})`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.emulateMedia({ colorScheme });
    const { definitions, headers } = await workspace(page);
    const drawer = page.locator('dialog.schema-drawer');
    await page
      .getByRole('button', { name: 'Create nested block under Layout', exact: true })
      .click();
    const layout = (await definitions()).find((item) => item.name === 'layout')!;
    await expect(drawer.getByRole('button', { name: 'Parent block', exact: true })).toContainText(
      'Layout (layout)',
    );
    await drawer.getByLabel('Display name', { exact: true }).fill('Feature');
    await saveAndClose(page, true);
    const child = (await definitions()).find((item) => item.name === 'feature')!;
    await expect(page.locator(`[data-definition-id="${child.id}"]`)).toHaveAttribute(
      'data-depth',
      '1',
    );

    await page.getByRole('button', { name: 'New block', exact: true }).click();
    await drawer.getByLabel('Display name', { exact: true }).fill('Detail');
    await drawer.getByRole('button', { name: 'Parent block', exact: true }).click();
    const parentOptions = drawer.getByRole('dialog', { name: 'Parent block options', exact: true });
    const parentSearch = parentOptions.getByRole('searchbox', {
      name: 'Search Parent block options',
    });
    await expect(parentSearch).toBeFocused();
    await parentSearch.fill('no-matching-parent');
    await expect(parentOptions.getByText('No matching options.', { exact: true })).toBeVisible();
    await parentSearch.fill('feature');
    await expect(parentOptions.getByRole('button', { name: /Feature \(feature\)/ })).toBeVisible();
    await parentSearch.press('Enter');
    await expect(parentOptions).not.toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Parent block', exact: true })).toContainText(
      'Feature (feature)',
    );
    await saveAndClose(page, true);
    const leaf = (await definitions()).find((item) => item.name === 'detail')!;
    await expect(page.locator(`[data-definition-id="${leaf.id}"]`)).toHaveAttribute(
      'data-depth',
      '2',
    );
    await page.getByRole('button', { name: 'Collapse Layout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Detail', exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search blocks', exact: true }).fill('Detail');
    await expect(page.getByRole('button', { name: 'Layout', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Feature', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Detail', exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search blocks', exact: true }).clear();
    await expect(page.getByRole('button', { name: 'Detail', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand Layout', exact: true }).click();

    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await drawer.getByRole('button', { name: 'Edit body', exact: true }).click();
    const restrictions = drawer.locator('.block-restrictions');
    await expect(restrictions.getByRole('button', { name: 'Nested', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(restrictions.getByRole('checkbox')).toHaveCount(1);
    await restrictions.getByRole('checkbox', { name: /Feature/ }).check();
    await restrictions.getByRole('button', { name: 'Blocks', exact: true }).click();
    await expect(restrictions.getByRole('checkbox', { name: /Feature/ })).toBeChecked();
    await restrictions.getByRole('checkbox', { name: /Sections/ }).check();
    await restrictions.getByRole('button', { name: 'Nested', exact: true }).click();
    await expect(restrictions).toContainText('2 selected');
    await expect(restrictions.getByRole('button', { name: 'Tags', exact: true })).toHaveCount(0);
    await saveAndClose(page);

    const sections = (await definitions()).find((item) => item.name === 'sections')!;
    const before = await (
      await page.request.get('/api/cms/migrations?workspace=true', { headers })
    ).json();
    await page.getByRole('button', { name: 'Sections', exact: true }).scrollIntoViewIfNeeded();
    await page
      .getByRole('button', { name: 'Drag Feature', exact: true })
      .dragTo(page.getByRole('button', { name: 'Sections', exact: true }));
    await expect
      .poll(
        async () => (await definitions()).find((item) => item.id === child.id)?.parentDefinitionId,
      )
      .toBe(sections.id);
    await expect(page.locator(`[data-definition-id="${leaf.id}"]`)).toHaveAttribute(
      'data-depth',
      '2',
    );
    const savedLayout = (await definitions()).find((item) => item.id === layout.id)!;
    expect(savedLayout.fields[0]).toMatchObject({ allowedDefinitionIds: [child.id, sections.id] });

    await page.getByRole('button', { name: 'Feature', exact: true }).click();
    await drawer.getByRole('tab', { name: 'Config', exact: true }).click();
    const parent = drawer.getByRole('button', { name: 'Parent block', exact: true });
    await parent.click();
    await expect(parentOptions.getByRole('button', { name: /Feature \(feature\)/ })).toHaveCount(0);
    await expect(parentOptions.getByRole('button', { name: /Detail \(detail\)/ })).toHaveCount(0);
    await parentSearch.press('Escape');
    await expect(parent).toBeFocused();
    await expect(drawer).toBeVisible();
    await expect(parent).toContainText('Sections (sections)');
    await parent.click();
    await expect(
      parentOptions.getByRole('button', { name: 'No parent', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `/tmp/storypane-parent-picker-${colorScheme}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        parentOptions.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= 0 &&
            bounds.right <= window.innerWidth &&
            element.scrollWidth <= element.clientWidth
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `/tmp/storypane-parent-picker-mobile-${colorScheme}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await parentOptions.getByRole('button', { name: 'No parent', exact: true }).click();
    await expect
      .poll(
        async () => (await definitions()).find((item) => item.id === child.id)?.parentDefinitionId,
      )
      .toBeNull();
    await expect(parent).toBeEnabled();
    await expect(
      drawer.getByRole('button', { name: 'Save to migration', exact: true }),
    ).toBeDisabled();
    await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
    expect(
      await (await page.request.get('/api/cms/migrations?workspace=true', { headers })).json(),
    ).toEqual(before);
    expect((await definitions()).find((item) => item.id === child.id)?.versionId).toBe(
      child.versionId,
    );
    await expect(page.locator(`[data-definition-id="${child.id}"]`)).toHaveAttribute(
      'data-depth',
      '0',
    );
    await expect(page.locator(`[data-definition-id="${leaf.id}"]`)).toHaveAttribute(
      'data-depth',
      '1',
    );
    await page.screenshot({ path: `/tmp/storypane-block-hierarchy-${colorScheme}.png` });

    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await drawer.getByRole('button', { name: 'Edit body', exact: true }).click();
    await expect(restrictions.getByRole('button', { name: 'Blocks', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(restrictions.getByRole('checkbox', { name: /Feature/ })).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => drawer.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
  });
}

test('keeps a failed move unchanged and supports dropping a subtree at the root', async ({
  page,
}) => {
  const { definitions } = await workspace(page);
  const layout = (await definitions()).find((item) => item.name === 'layout')!;
  const sections = (await definitions()).find((item) => item.name === 'sections')!;
  const route = `**/definitions/${sections.id}/parent`;
  await page.route(route, (request) =>
    request.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'stale_revision', message: 'The schema changed. Reload before saving.' },
      }),
    }),
  );
  await page
    .getByRole('button', { name: 'Drag Sections', exact: true })
    .dragTo(page.getByRole('button', { name: 'Layout', exact: true }));
  await expect(
    page.getByText('The schema changed. Reload before saving.', { exact: true }),
  ).toBeVisible();
  expect(
    (await definitions()).find((item) => item.id === sections.id)?.parentDefinitionId,
  ).toBeNull();
  await page.unroute(route);
  await page
    .getByRole('button', { name: 'Drag Sections', exact: true })
    .dragTo(page.getByRole('button', { name: 'Layout', exact: true }));
  await expect
    .poll(
      async () => (await definitions()).find((item) => item.id === sections.id)?.parentDefinitionId,
    )
    .toBe(layout.id);
  const handle = page.getByRole('button', { name: 'Drag Sections', exact: true });
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(
    (await handle.boundingBox())!.x + 40,
    (await handle.boundingBox())!.y + 10,
    { steps: 5 },
  );
  const root = page.getByText('Move to root · No parent', { exact: true });
  await root.hover();
  await page.mouse.up();
  await expect
    .poll(
      async () => (await definitions()).find((item) => item.id === sections.id)?.parentDefinitionId,
    )
    .toBeNull();
});

test('saves parent changes without a migration and preserves unsaved schema edits', async ({
  page,
}) => {
  const { definitions, headers } = await workspace(page);
  const active = (
    (await (
      await page.request.get('/api/cms/migrations?workspace=true', { headers })
    ).json()) as SchemaMigration[]
  ).find((item) => item.status === 'active')!;
  const review = (await (
    await page.request.get(`/api/cms/migrations/${active.id}/review`, { headers })
  ).json()) as MigrationReview;
  expect(review.blockers).toEqual([]);
  const deployed = await page.request.post(`/api/cms/migrations/${active.id}/deploy`, {
    headers,
    data: { reviewToken: review.token },
  });
  expect(deployed.ok(), await deployed.text()).toBe(true);
  await page.reload();
  await expect(page.getByText('All changes deployed', { exact: true })).toBeVisible();
  const before = await (
    await page.request.get('/api/cms/migrations?workspace=true', { headers })
  ).json();
  const initial = await definitions();
  const layout = initial.find((item) => item.name === 'layout')!,
    sections = initial.find((item) => item.name === 'sections')!;
  const drawer = page.locator('dialog.schema-drawer');
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click();
  await drawer.getByRole('button', { name: 'Parent block', exact: true }).click();
  await drawer
    .getByRole('dialog', { name: 'Parent block options', exact: true })
    .getByRole('button', { name: 'Layout (layout)', exact: true })
    .click();
  await expect
    .poll(
      async () => (await definitions()).find((item) => item.id === sections.id)?.parentDefinitionId,
    )
    .toBe(layout.id);
  await expect(drawer.getByRole('button', { name: 'Parent block', exact: true })).toBeEnabled();
  await expect(
    drawer.getByRole('button', { name: 'Save to migration', exact: true }),
  ).toBeDisabled();
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator(`[data-definition-id="${sections.id}"]`)).not.toContainText(
    'Pending migration',
  );
  await expect(page.getByText('All changes deployed', { exact: true })).toBeVisible();
  expect(
    await (await page.request.get('/api/cms/migrations?workspace=true', { headers })).json(),
  ).toEqual(before);
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await drawer.getByRole('tab', { name: 'Config', exact: true }).click();
  await drawer.getByLabel('Display name', { exact: true }).fill('Renamed sections');
  await drawer.getByRole('button', { name: 'Parent block', exact: true }).click();
  await drawer
    .getByRole('dialog', { name: 'Parent block options', exact: true })
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  await expect
    .poll(
      async () => (await definitions()).find((item) => item.id === sections.id)?.parentDefinitionId,
    )
    .toBeNull();
  await expect(drawer.getByLabel('Display name', { exact: true })).toHaveValue('Renamed sections');
  await expect(
    drawer.getByRole('button', { name: 'Save to migration', exact: true }),
  ).toBeEnabled();
  expect((await definitions()).find((item) => item.id === sections.id)?.displayName).toBe(
    'Sections',
  );
  expect(
    await (await page.request.get('/api/cms/migrations?workspace=true', { headers })).json(),
  ).toEqual(before);
  await saveAndClose(page);
  expect((await definitions()).find((item) => item.id === sections.id)?.displayName).toBe(
    'Renamed sections',
  );
});
