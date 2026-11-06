import { expect, test } from '@playwright/test';
import type { BlockDefinition, Space } from '@storypane/core';

test('block columns, references and row actions work with nesting, permissions and keyboard navigation', async ({
  page,
}, info) => {
  const space: Space = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Development',
    description: '',
    environment: 'dev',
    schemaReadOnly: false,
    role: 'admin',
    roleName: 'Admin',
    permissions: ['content:read', 'schemas:write', 'settings:write'],
    createdAt: '2026-11-01T00:00:00Z',
    storyCount: 1,
    memberCount: 1,
  };
  const make = (id: string, displayName: string, parentDefinitionId?: string): BlockDefinition => ({
    id,
    name: displayName.toLowerCase(),
    displayName,
    parentDefinitionId,
    kind: 'nestable',
    fields: [],
    version: 1,
    versionId: `version-${id}`,
    createdAt: space.createdAt,
  });
  const alpha = make('alpha', 'Alpha'),
    zulu = make('zulu', 'Zulu');
  let definitions = [zulu, make('child', 'Child', alpha.id), alpha];
  const counts: Record<string, number> = { [alpha.id]: 12, [zulu.id]: 2 };
  let referenceRequests = 0,
    failReferences = false,
    failDelete = false;
  let releaseCounts: (() => void) | undefined;
  let countGate: Promise<void> | undefined;
  const deletions: unknown[] = [],
    unexpected: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (route) =>
    route.fulfill({
      json: {
        sessionId: 'block-library-test',
        user: { id: 'tester', name: 'Tester', email: 'tester@example.test' },
        space,
      },
    }),
  );
  await page.route('**/api/spaces', (route) => route.fulfill({ json: [space] }));
  await page.route('**/api/cms/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/cms', '');
    if (path === '/options' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.source.type).toBe('inline');
      return route.fulfill({ json: { items: body.source.items } });
    }
    if (path === '/definitions/reference-counts') {
      referenceRequests++;
      if (countGate) await countGate;
      return failReferences
        ? route.fulfill({ status: 503, json: { error: { message: 'Counts unavailable' } } })
        : route.fulfill({ json: counts });
    }
    if (route.request().method() === 'DELETE') {
      deletions.push({ path, body: route.request().postDataJSON() });
      if (failDelete)
        return route.fulfill({
          status: 409,
          json: { error: { message: 'A story now references this block' } },
        });
      definitions = definitions.filter((item) => `/definitions/${item.id}` !== path);
      return route.fulfill({ json: { ok: true } });
    }
    if (/^\/definitions\/[^/]+\/references$/.test(path)) {
      const total = counts[path.split('/')[2]] ?? 0;
      return route.fulfill({
        json: {
          total,
          nextCursor: null,
          items: total
            ? [
                {
                  storyId: 'story',
                  storyName: 'Home',
                  locales: [
                    {
                      localeId: 'default',
                      localeName: 'Default',
                      localeSlug: '',
                      path: 'home',
                      blockId: 'instance',
                      draft: true,
                      published: true,
                    },
                  ],
                },
              ]
            : [],
        },
      });
    }
    const responses: Record<string, unknown> = {
      '/definitions': definitions,
      '/datasources': [],
      '/migrations': [],
      '/migrations/environment': {
        environment: space.environment,
        schemaReadOnly: space.schemaReadOnly,
        production: null,
        behind: false,
        pending: [],
      },
      '/space': { ...space, members: [] },
      '/roles': [],
      '/assets/uploads': { items: [] },
      '/locales': [],
      '/invitations': [],
      '/delivery-tokens': [],
      '/management-tokens': [],
      '/delivery-settings': {
        previewUrls: [],
        defaultPreviewId: null,
        previewParameter: 'storypane_preview',
        personalDefaultPreviewId: null,
      },
      '/webhooks': { configured: false, endpoints: [] },
      '/public-media': { enabled: false },
    };
    if (route.request().method() === 'GET' && path in responses)
      return route.fulfill({ json: responses[path] });
    unexpected.push(`${route.request().method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected request' } } });
  });
  await page.goto(`/?space=${space.id}&view=blocks`);
  const rows = page.locator('tr[data-definition-id]');
  const order = () =>
    rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-definition-id')));
  const checkbox = page.getByRole('checkbox', { name: 'Show references' });
  await expect(rows).toHaveCount(3);
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole('columnheader', { name: 'Sort by References' })).toHaveCount(0);
  expect(referenceRequests).toBe(0);
  expect(await order()).toEqual(['alpha', 'child', 'zulu']);
  await page.getByRole('button', { name: 'Sort by Block', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('columnheader', { name: 'Sort by Block', exact: true }),
  ).toHaveAttribute('aria-sort', 'descending');
  expect(await order()).toEqual(['zulu', 'alpha', 'child']);

  countGate = new Promise<void>((resolve) => {
    releaseCounts = resolve;
  });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(page.getByLabel('Loading reference count')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Sort by References' })).toBeDisabled();
  releaseCounts!();
  countGate = undefined;
  await expect(
    page.getByRole('button', { name: 'View 12 story references for Alpha' }),
  ).toBeVisible();
  const sortReferences = page.getByRole('button', { name: 'Sort by References' });
  await sortReferences.click();
  expect(await order()).toEqual(['zulu', 'alpha', 'child']);
  await sortReferences.focus();
  await page.keyboard.press('Enter');
  expect(await order()).toEqual(['alpha', 'child', 'zulu']);
  await page.getByRole('button', { name: 'Collapse Alpha' }).click();
  expect(await order()).toEqual(['alpha', 'zulu']);
  await page.getByRole('searchbox', { name: 'Search blocks' }).fill('child');
  expect(await order()).toEqual(['alpha', 'child']);
  await page.getByRole('searchbox', { name: 'Search blocks' }).fill('');
  await page.getByRole('button', { name: 'Expand Alpha' }).click();

  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await checkbox.focus();
      await expect(checkbox).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const edit = page.getByRole('button', { name: 'Edit Alpha', exact: true });
      await edit.focus();
      await expect(edit).toBeFocused();
      await page.screenshot({ path: info.outputPath(`library-${theme}-${width}.png`) });
    }
  }
  await page.getByRole('button', { name: 'View 12 story references for Alpha' }).click();
  const drawer = page.getByRole('dialog', { name: "Edit 'alpha'", exact: true });
  await expect(drawer.getByRole('tab', { name: 'References (12)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    drawer.getByRole('link', { name: 'Open Home · Default in a new tab' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();

  failReferences = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('Reference counts could not be loaded');
  await expect(page.getByLabel('Reference count unavailable')).toHaveCount(3);
  await expect(sortReferences).toBeDisabled();
  failReferences = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(sortReferences).toBeEnabled();
  await checkbox.uncheck();
  await expect(
    page.getByRole('columnheader', { name: 'Sort by Block', exact: true }),
  ).toHaveAttribute('aria-sort', 'ascending');
  const requestsWhenHidden = referenceRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Edit Alpha', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('tab', { name: 'Fields', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  expect(referenceRequests).toBe(requestsWhenHidden);

  await page.getByRole('button', { name: 'Delete Alpha', exact: true }).click();
  const usedDelete = page.getByRole('dialog', { name: 'Delete “Alpha”?', exact: true });
  await expect(usedDelete).toContainText(
    'This block cannot be deleted while stories still reference it',
  );
  await expect(
    usedDelete.getByRole('button', { name: 'Delete block', exact: true }),
  ).toBeDisabled();
  await usedDelete.getByRole('button', { name: 'View references', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: 'References (12)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  expect(deletions).toEqual([]);

  const childDelete = page.getByRole('dialog', { name: 'Delete “Child”?', exact: true });
  await page.getByRole('button', { name: 'Delete Child', exact: true }).click();
  await childDelete.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete Child', exact: true })).toBeFocused();
  expect(deletions).toEqual([]);
  await page.keyboard.press('Enter');
  failDelete = true;
  await childDelete.getByRole('button', { name: 'Delete block', exact: true }).click();
  await expect(childDelete.getByRole('alert')).toContainText('A story now references this block');
  await expect(rows).toHaveCount(3);
  failDelete = false;
  await childDelete.getByRole('button', { name: 'Delete block', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  expect(deletions).toEqual(
    Array(2).fill({
      path: '/definitions/child',
      body: { expectedVersionId: 'version-child', baseVersion: 0 },
    }),
  );

  space.schemaReadOnly = true;
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Edit Alpha', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete Alpha', exact: true })).toHaveCount(0);
  await expect(checkbox).not.toBeChecked();
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
