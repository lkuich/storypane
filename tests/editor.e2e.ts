import { signInPage as login } from './auth';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type {
  BlockDefinition,
  CommitResult,
  Lease,
  LocaleSnapshot,
  Story,
  StoryLocale,
  SpaceLocale,
} from '@storypane/core';

const origin = 'http://127.0.0.1:3130';
async function json<T>(request: APIRequestContext, path: string, body?: unknown): Promise<T> {
  const response =
    body === undefined
      ? await request.get(`/api/cms${path}`)
      : await request.post(`/api/cms${path}`, { headers: { Origin: origin }, data: body });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}
async function fixture(request: APIRequestContext) {
  const definitions = await json<BlockDefinition[]>(request, '/definitions');
  const name = `Editor check ${Date.now()}`;
  const story = await json<Story>(request, '/stories', {
    name,
    slug: `editor-${Date.now()}`,
    definitionId: definitions.find((d) => d.name === 'page')!.id,
  });
  const [locale] = await json<StoryLocale[]>(request, `/stories/${story.id}/locales`);
  const base = `/stories/${story.id}/locales/${locale.id}`;
  let snapshot = await json<LocaleSnapshot>(request, base);
  const root = snapshot.locale.rootBlockId;
  const lease = await json<Lease>(request, `${base}/leases`, { blockId: root });
  for (const kind of ['hero', 'footer']) {
    const result = await json<CommitResult>(request, `${base}/commands`, {
      type: 'insertBlock',
      mutationId: crypto.randomUUID(),
      expectedRevisions: { [root]: snapshot.blocks.find((b) => b.id === root)!.revision },
      leaseTokens: { [root]: lease.token },
      payload: {
        parentId: root,
        parentField: 'body',
        definitionId: definitions.find((d) => d.name === kind)!.id,
      },
    });
    snapshot = result.snapshot;
  }
  expect(
    (
      await request.delete(`/api/cms${base}/leases`, {
        headers: { Origin: origin },
        data: { blockId: root, token: lease.token },
      })
    ).ok(),
  ).toBeTruthy();
  return { story, base, snapshot };
}

test('two editors work on separate blocks, autosave, publish a fixed checkpoint, and recover after offline', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const admin = await browser.newContext();
  const peer = await browser.newContext();
  try {
    const page = await admin.newPage();
    const other = await peer.newPage();
    await login(page, 'admin');
    await login(other, 'editor');
    const { story, base } = await fixture(admin.request);
    await page.reload();
    await other.reload();
    await page.getByRole('button', { name: story.name, exact: true }).click();
    await page
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Hero', exact: true })
      .click();
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeEditable();
    await page.getByRole('textbox', { name: /^Title/ }).fill('A hero saved automatically');
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    await other.getByRole('button', { name: story.name, exact: true }).click();
    await other
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Hero', exact: true })
      .click();
    await expect(
      other.getByText('Another editor is working on this block. Other blocks are available.'),
    ).toBeVisible();
    await expect(other.getByRole('textbox', { name: /^Title/ })).toBeDisabled();
    await other.getByRole('button', { name: 'Outline', exact: true }).click();
    await expect(
      other
        .getByRole('complementary', { name: 'Block outline' })
        .getByRole('button', { name: 'Reorder Hero', exact: true }),
    ).toBeDisabled();
    await other
      .getByRole('complementary', { name: 'Block outline' })
      .getByRole('button', { name: 'Footer', exact: true })
      .click();
    await expect(other.getByLabel('Footer text', { exact: true })).toBeEditable();
    await other.getByLabel('Footer text', { exact: true }).fill('Footer before review');
    await expect(other.getByText('All changes saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review & publish' }).click();
    const review = page.getByRole('dialog', { name: 'Review before publishing' });
    await expect(review.locator('pre')).toContainText('Footer before review');
    await other
      .getByLabel('Footer text', { exact: true })
      .fill('Footer after review stays a draft');
    await expect(other.getByText('All changes saved', { exact: true })).toBeVisible();
    await review.getByRole('button', { name: /Publish revision/ }).click();
    await expect(review).not.toBeVisible();
    const published = await json<{ content: unknown }>(admin.request, `${base}/published`);
    expect(JSON.stringify(published.content)).toContain('Footer before review');
    expect(JSON.stringify(published.content)).not.toContain('Footer after review');
    expect(JSON.stringify((await json<LocaleSnapshot>(admin.request, base)).blocks)).toContain(
      'Footer after review stays a draft',
    );
    await page.getByRole('textbox', { name: /^Title/ }).fill('Recover this unsent hero');
    await admin.setOffline(true);
    await expect(page.getByText('Offline · edits preserved', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await expect(
      page
        .getByRole('complementary', { name: 'Block outline' })
        .getByRole('button', { name: 'Reorder Hero', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) => key.startsWith('storypane:drafts:')),
      ),
    ).toBeTruthy();
    await admin.setOffline(false);
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeEditable({ timeout: 20_000 });
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    await expect
      .poll(async () => JSON.stringify((await json<LocaleSnapshot>(admin.request, base)).blocks))
      .toContain('Recover this unsent hero');
  } finally {
    await admin.close();
    await peer.close();
  }
});

test('add from a child block and reorder siblings with drag handles and the keyboard', async ({
  page,
}) => {
  await login(page, 'admin');
  const { story, base, snapshot } = await fixture(page.request);
  const children = (value: LocaleSnapshot) =>
    value.blocks
      .filter(
        (block) => block.parentId === value.locale.rootBlockId && block.parentField === 'body',
      )
      .sort((a, b) => a.position - b.position)
      .map((block) => block.id);
  const [heroId, footerId] = children(snapshot);
  await page.reload();
  await page.getByRole('button', { name: story.name, exact: true }).click();
  const outline = page.getByRole('complementary', { name: 'Block outline' });
  await page
    .getByRole('region', { name: 'Block editor' })
    .getByRole('button', { name: 'Footer', exact: true })
    .click();
  await expect(page.getByLabel('Footer text', { exact: true })).toBeEditable();
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await outline.getByRole('button', { name: 'Add block', exact: true }).click();
  const insert = page.getByRole('dialog', { name: 'Add a block' });
  await insert.getByRole('button', { name: 'Add Hero', exact: true }).click();
  await expect(insert).not.toBeVisible();
  const added = await json<LocaleSnapshot>(page.request, base);
  expect(children(added)).toHaveLength(3);
  const newId = children(added)[2];
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(outline.getByRole('button', { name: 'Hero', exact: true })).toHaveCount(2);

  await outline.getByRole('button', { name: 'Reorder Footer', exact: true }).dragTo(
    outline
      .locator('.tree-row')
      .filter({ has: page.getByRole('button', { name: 'Hero', exact: true }) })
      .first(),
    { steps: 10, targetPosition: { x: 20, y: 4 } },
  );
  await expect
    .poll(async () => children(await json<LocaleSnapshot>(page.request, base)))
    .toEqual([footerId, heroId, newId]);
  await expect(outline.getByRole('button', { name: 'Reorder Footer', exact: true })).toBeEnabled();
  await outline.getByRole('button', { name: 'Reorder Footer', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => children(await json<LocaleSnapshot>(page.request, base)))
    .toEqual([heroId, footerId, newId]);
  await expect(
    page.getByRole('dialog', { name: 'Story outline', exact: true }).getByRole('status'),
  ).toHaveText('Footer moved to position 2 of 3.');

  await outline.getByRole('button', { name: 'Page', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Block editor' });
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toBeEditable();
  const lastRow = panel.locator('.block-list-item').last();
  await lastRow.scrollIntoViewIfNeeded();
  const bounds = await lastRow.boundingBox();
  await panel
    .getByRole('button', { name: 'Reorder Hero', exact: true })
    .first()
    .dragTo(lastRow, { steps: 10, targetPosition: { x: 20, y: bounds!.height - 4 } });
  await expect
    .poll(async () => children(await json<LocaleSnapshot>(page.request, base)))
    .toEqual([footerId, newId, heroId]);
  await page.reload();
  await expect(page.getByRole('heading', { name: story.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(outline.locator('.tree-item')).toHaveText(['Page', 'Footer', 'Hero', 'Hero']);
  expect(children(await json<LocaleSnapshot>(page.request, base))).toEqual([
    footerId,
    newId,
    heroId,
  ]);
});

test('copies the selected block and pastes an independent copy into a block list', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await login(page, 'admin');
  const { story, base, snapshot } = await fixture(page.request);
  await page.goto(`/?space=11111111-1111-4111-8111-111111111111&story=${story.id}`);
  const editor = page.getByRole('region', { name: 'Block editor' });
  await editor.getByRole('button', { name: 'Hero', exact: true }).click();
  await expect(editor.getByLabel('Title', { exact: true })).toBeEditable();
  await editor.getByLabel('Title', { exact: true }).fill('Copy my current content');
  await editor.getByRole('button', { name: 'Copy block', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Block path' })
    .getByRole('button', { name: 'Page', exact: true })
    .click();
  await editor.getByRole('button', { name: 'Paste block', exact: true }).click();
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Copy my current content');
  const result = await json<LocaleSnapshot>(page.request, base);
  const pasted = result.blocks.find(
    (block) => !snapshot.blocks.some((source) => source.id === block.id),
  )!;
  expect(pasted.fields.title).toBe('Copy my current content');
  expect(pasted.parentId).toBe(result.locale.rootBlockId);
  expect(result.blocks).toHaveLength(snapshot.blocks.length + 1);
  await expect(page).toHaveURL(new RegExp(`block=${pasted.id}`));
  await editor.getByLabel('Title', { exact: true }).fill('Only the copy changes');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const after = await json<LocaleSnapshot>(page.request, base);
  expect(
    after.blocks.filter((block) => block.fields.title === 'Copy my current content'),
  ).toHaveLength(1);
});

test('browser Back returns to the filtered content list and Forward restores the selected block', async ({
  page,
}) => {
  await login(page, 'admin');
  const { story, snapshot } = await fixture(page.request);
  const listUrl = `/?space=11111111-1111-4111-8111-111111111111&q=${encodeURIComponent(story.name)}`;
  await page.goto(listUrl);
  await page.getByRole('button', { name: story.name, exact: true }).click();
  const editor = page.getByRole('region', { name: 'Block editor' });
  await editor.getByRole('button', { name: 'Hero', exact: true }).click();
  const hero = snapshot.blocks.find(
    (block) =>
      snapshot.definitions.find((def) => def.versionId === block.schemaVersionId)?.name === 'hero',
  )!;
  await expect(page).toHaveURL(new RegExp(`block=${hero.id}`));
  await page.goBack();
  await expect(page.getByRole('button', { name: story.name, exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('q')).toBe(story.name);
  expect(new URL(page.url()).searchParams.has('story')).toBe(false);
  await page.goForward();
  await expect(editor.getByRole('heading', { name: 'Hero', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`block=${hero.id}`));
});

test('locale imports copy blocks independently and restoration keeps history', async ({ page }) => {
  await login(page, 'admin');
  const { story, base } = await fixture(page.request);
  const configured =
    (await json<SpaceLocale[]>(page.request, '/locales')).find((locale) => locale.slug === 'fr') ??
    (await json<SpaceLocale>(page.request, '/locales', { name: 'French', slug: 'fr' }));
  await page.reload();
  await page.getByRole('button', { name: story.name, exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toBeEditable();
  await page
    .getByRole('tab', { name: `${configured.name} ${configured.slug}`, exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toBeEditable();
  await page.getByRole('button', { name: 'Import from Default', exact: true }).click();
  const imports = page.getByRole('dialog', { name: 'Import from Default' });
  await imports.getByRole('checkbox').nth(0).check();
  await imports.getByRole('checkbox').nth(1).check();
  await imports.getByRole('button', { name: 'Import 2 selected' }).click();
  await expect(imports).not.toBeVisible();
  const locales = await json<StoryLocale[]>(page.request, `/stories/${story.id}/locales`);
  const frenchBase = `/stories/${story.id}/locales/${locales.find((l) => l.slug === 'fr')!.id}`;
  const french = await json<LocaleSnapshot>(page.request, frenchBase);
  const original = await json<LocaleSnapshot>(page.request, base);
  expect(french.blocks).toHaveLength(3);
  expect(
    french.blocks.every((b) => !original.blocks.some((other) => other.id === b.id)),
  ).toBeTruthy();
  await page
    .getByRole('region', { name: 'Block editor' })
    .getByRole('button', { name: 'Hero', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: /^Title/ })).toBeEditable();
  await page.getByRole('textbox', { name: /^Title/ }).fill('Bonjour le monde');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  expect(JSON.stringify((await json<LocaleSnapshot>(page.request, base)).blocks)).not.toContain(
    'Bonjour le monde',
  );
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Story history' });
  page.once('dialog', (dialog) => void dialog.accept());
  await history
    .locator('.history-item')
    .nth(1)
    .getByRole('button', { name: 'This block', exact: true })
    .click();
  await expect(history).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Title/ })).not.toHaveValue('Bonjour le monde');
  const restored = await json<LocaleSnapshot>(page.request, frenchBase);
  expect(restored.revision).toBeGreaterThan(french.revision + 1);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(history.locator('.history-item').first()).toContainText('restore block');
});

test.describe('editor navigation', () => {
  test.use({ hasTouch: true, viewport: { width: 1600, height: 1000 } });
  test('rail expansion preserves the canvas, breadcrumbs drill down, and the outline is optional', async ({
    page,
  }) => {
    await login(page, 'admin');
    const { story } = await fixture(page.request);
    await page.reload();
    await page.getByRole('button', { name: story.name, exact: true }).click();
    const sidebar = page.getByRole('complementary', { name: 'Workspace', exact: true });
    const editor = page.getByRole('region', { name: 'Block editor' });
    await expect(editor).toBeVisible();
    await expect(sidebar).toHaveAttribute('data-expanded', 'false');
    await expect(page.getByRole('complementary', { name: 'Block outline' })).not.toBeVisible();
    const x = (await editor.boundingBox())!.x;
    await sidebar.hover();
    await expect(sidebar).toHaveAttribute('data-expanded', 'true');
    expect((await editor.boundingBox())!.x).toBe(x);
    await page.getByRole('heading', { name: story.name, exact: true }).hover();
    await expect(sidebar).toHaveAttribute('data-expanded', 'false');
    await sidebar.getByRole('button', { name: 'Settings', exact: true }).focus();
    await expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(sidebar).toHaveAttribute('data-expanded', 'false');
    await expect(sidebar.getByRole('button', { name: 'Toggle navigation' })).toBeFocused();
    await page.keyboard.press('Enter');
    await sidebar.getByRole('button', { name: 'Pin navigation', exact: true }).click();
    await editor.hover();
    await expect(sidebar).toHaveAttribute('data-expanded', 'true');
    expect((await editor.boundingBox())!.x).toBeGreaterThan(x);
    await sidebar.getByRole('button', { name: 'Unpin navigation', exact: true }).click();
    await expect(sidebar).toHaveAttribute('data-expanded', 'false');
    expect((await editor.boundingBox())!.x).toBe(x);

    await editor.getByRole('button', { name: 'Hero', exact: true }).click();
    const path = page.getByRole('navigation', { name: 'Block path' });
    await expect(path.locator('.block-path-link')).toHaveText(['Page', 'Hero']);
    const browse = path.getByRole('button', { name: 'Browse Body blocks in Page' });
    await browse.click();
    await expect(path.getByRole('group', { name: 'Body blocks' }).getByRole('button')).toHaveCount(
      2,
    );
    await page.keyboard.press('Escape');
    await expect(browse).toBeFocused();
    await expect(browse).toHaveAttribute('aria-expanded', 'false');
    await browse.click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Footer text', { exact: true })).toBeEditable();
    await expect(browse).toBeFocused();
    await expect(path.getByRole('button', { name: 'Footer', exact: true })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await path.getByRole('button', { name: 'Page', exact: true }).click();
    await expect(editor.locator('.block-list-item')).toHaveCount(2);
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Story outline', exact: true });
    await expect(drawer.locator('.tree-item')).toHaveText(['Page', 'Hero', 'Footer']);
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Outline', exact: true })).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await sidebar.getByRole('button', { name: 'Toggle navigation' }).tap();
    await expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await page.locator('#main-content').tap({ position: { x: 300, y: 10 } });
    await expect(sidebar).toHaveAttribute('data-expanded', 'false');
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(64);
    await page.screenshot({ path: '/tmp/storypane-editor-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Hero', exact: true }).click();
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Title/ })).toBeEditable();
  });
});

test('story URLs restore the locale and slow locale loads keep the current editor visible', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await login(page, 'admin');
  const { story, base } = await fixture(page.request);
  const configured =
    (await json<SpaceLocale[]>(page.request, '/locales')).find((locale) => locale.slug === 'fr') ??
    (await json<SpaceLocale>(page.request, '/locales', { name: 'French', slug: 'fr' }));
  const french = await json<StoryLocale>(page.request, `/stories/${story.id}/locales`, {
    spaceLocaleId: configured.id,
  });
  const frenchBase = `/stories/${story.id}/locales/${french.id}`;
  const deepLink = `/?space=11111111-1111-4111-8111-111111111111&story=${story.id}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseConnection!: () => void;
  const connecting = new Promise<void>((resolve) => {
    releaseConnection = resolve;
  });
  let reads = 0;
  await page.route(`**/api/cms${base}`, async (route) => {
    if (++reads === 2) await connecting;
    await route.continue();
  });
  await page.goto(deepLink);
  await expect(page.locator('.save-status')).toHaveText('Connecting…');
  await expect(page.getByRole('heading', { name: story.name, exact: true })).toBeVisible();
  await expect(page.locator('.notice--warning')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toBeDisabled();
  releaseConnection();
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toBeEditable();
  await page
    .getByRole('textbox', { name: /^Page title/ })
    .fill('Keep this default content visible');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide preview', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Application preview' })).toBeVisible();

  let releaseLocale!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseLocale = resolve;
  });
  let requested = false;
  await page.route(`**/api/cms${frenchBase}`, async (route) => {
    requested = true;
    await waiting;
    await route.continue();
  });
  await page
    .getByRole('tab', { name: `${configured.name} ${configured.slug}`, exact: true })
    .click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.locator('.story-heading h1')).toHaveText(story.name);
  await expect(page.locator('.editor-fields input').first()).toHaveValue(
    'Keep this default content visible',
  );
  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.preview-panel')).toBeVisible();
  await expect(page.locator('.loading-state:visible')).toHaveCount(0);
  await expect(page.locator('.notice--warning')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('locale')).toBe(false);
  releaseLocale();
  await expect(
    page.getByRole('tab', { name: `${configured.name} ${configured.slug}`, exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Hide preview', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toBeEditable();
  await page.getByRole('textbox', { name: /^Page title/ }).fill('Contenu français');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('locale')).toBe('fr');
  await page.reload();
  await expect(page.getByRole('heading', { name: story.name, exact: true })).toBeVisible();
  await expect(
    page.getByRole('tab', { name: `${configured.name} ${configured.slug}`, exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toHaveValue('Contenu français');
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toBeEditable();

  await page.getByRole('textbox', { name: /^Page title/ }).fill('Preserve this unsent locale edit');
  await context.setOffline(true);
  await expect(page.getByText('Offline · edits preserved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Default', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Your edits are still unsaved. Resolve them before leaving this story.' }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get('locale')).toBe('fr');
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toHaveValue(
    'Preserve this unsent locale edit',
  );
  await context.setOffline(false);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // A failed destination load must not blank the existing form or change its URL.
  await page.unroute(`**/api/cms${base}`);
  await page.route(`**/api/cms${base}`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'unavailable', message: 'Locale temporarily unavailable' } },
    }),
  );
  await page.getByRole('tab', { name: 'Default', exact: true }).click();
  await expect(page.getByText('Locale temporarily unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toHaveValue(
    'Preserve this unsent locale edit',
  );
  expect(new URL(page.url()).searchParams.get('locale')).toBe('fr');
  await page.unroute(`**/api/cms${base}`);
  await page.getByRole('tab', { name: 'Default', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Page title/ })).toHaveValue(
    'Keep this default content visible',
  );
  expect(new URL(page.url()).searchParams.has('locale')).toBe(false);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Content', exact: true })
    .click();
  expect(new URL(page.url()).searchParams.has('story')).toBe(false);
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  await page.goto(
    '/?space=11111111-1111-4111-8111-111111111111&story=00000000-0000-4000-8000-000000000000',
  );
  await expect(page.getByText('Story not found in this space', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to content', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
