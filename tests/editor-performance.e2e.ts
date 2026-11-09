import { test as base, expect, type Browser } from '@playwright/test';
import { reviewInstallation } from './fixtures/review-installation';
const test = base.extend<{ installation: Awaited<ReturnType<typeof reviewInstallation>> }>({
  installation: [
    async ({ browserName: _ }, runWithFixture) => {
      const installation = await reviewInstallation();
      try {
        await runWithFixture(installation);
      } finally {
        await installation.close();
      }
    },
    { timeout: 60000 },
  ],
});
async function signIn(
  browser: Browser,
  installation: Awaited<ReturnType<typeof reviewInstallation>>,
  person: 'writer' | 'admin' = 'writer',
) {
  const context = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 1440, height: 1000 },
  });
  const response = await context.request.post('/api/auth/sign-in/email', {
    headers: { origin: installation.origin },
    data: { email: installation.people[person].email, password: installation.password },
  });
  expect(response.ok()).toBe(true);
  return { context, page: await context.newPage() };
}
const headers = (installation: Awaited<ReturnType<typeof reviewInstallation>>) => ({
  origin: installation.origin,
  'x-storypane-space-id': installation.spaceId,
});

test('block navigation paints before release completes, handles rapid selection, and saves before leaving', async ({
  browser,
  installation,
}) => {
  const { context, page } = await signIn(browser, installation);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = true;
  await page.route('**/leases', async (route) => {
    if (hold && route.request().method() === 'DELETE') await released;
    await route.continue();
  });
  try {
    await page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}`);
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeEditable();
    await page.locator('.block-list-item .entity-title').filter({ hasText: 'Hero' }).click();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeDisabled();
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Page', exact: true })
      .click();
    await page.locator('.block-list-item .entity-title').filter({ hasText: 'Footer' }).click();
    await expect(page.getByRole('textbox', { name: 'Footer text', exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Footer', exact: true })
      .click();
    hold = false;
    release();
    const footer = page.getByRole('textbox', { name: 'Footer text', exact: true });
    await expect(footer).toBeEditable();
    await expect
      .poll(
        async () =>
          (
            await installation.db.query(
              'SELECT block_id FROM edit_leases WHERE user_id=$1 AND expires_at>now()',
              [installation.people.writer.id],
            )
          ).rows.length,
      )
      .toBe(1);
    await footer.fill('Saved before navigating');
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Page', exact: true })
      .click();
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeVisible();
    await page.locator('.block-list-item .entity-title').filter({ hasText: 'Footer' }).click();
    await expect(footer).toHaveValue('Saved before navigating');
    await expect(footer).toBeEditable();
    expect(
      (
        await installation.db.query(
          "SELECT fields->>'text' AS text FROM block_drafts WHERE locale_id=$1 AND fields->>'text'=$2",
          [installation.localeId, 'Saved before navigating'],
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    hold = false;
    release();
    await context.close();
  }
});

test('a delayed snapshot cannot revoke a newly confirmed block lease', async ({
  browser,
  installation,
}) => {
  const { context, page } = await signIn(browser, installation);
  let releaseSnapshot!: () => void;
  let captured!: () => void;
  const snapshotHeld = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  const snapshotCaptured = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let held = false;
  try {
    await page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}`);
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeEditable();
    await page.waitForLoadState('networkidle');
    await page.route(
      `**/stories/${installation.storyId}/locales/${installation.localeId}`,
      async (route) => {
        if (held) return route.continue();
        held = true;
        const response = await route.fetch();
        captured();
        await snapshotHeld;
        await route.fulfill({ response });
      },
    );
    await page.route('**/leases', async (route) => {
      if (route.request().method() === 'POST') await snapshotCaptured;
      await route.continue();
    });
    await page.locator('.block-list-item .entity-title').filter({ hasText: 'Hero' }).click();
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await expect(title).toBeEditable();
    const delivered = page.waitForResponse((response) =>
      response.url().endsWith(`/locales/${installation.localeId}`),
    );
    releaseSnapshot();
    await delivered;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(title).toBeEditable();
    await title.fill('Lease remains usable');
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Page', exact: true })
      .click();
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeVisible();
    expect(
      (
        await installation.db.query(
          "SELECT id FROM block_drafts WHERE locale_id=$1 AND fields->>'title'=$2",
          [installation.localeId, 'Lease remains usable'],
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    releaseSnapshot();
    captured();
    await context.close();
  }
});

test('personal hover previews persist, stay lazy, and do not rerender on unrelated lease snapshots', async ({
  browser,
  installation,
}, info) => {
  const { context, page } = await signIn(browser, installation);
  const previewId = crypto.randomUUID();
  await installation.db.query(
    'UPDATE spaces SET preview_urls=$2,default_preview_id=$3 WHERE id=$1',
    [
      installation.spaceId,
      JSON.stringify([{ id: previewId, name: 'Test app', url: 'http://127.0.0.1:3159/{slug}' }]),
      previewId,
    ],
  );
  let documents = 0;
  await page.route('http://127.0.0.1:3159/**', (route) => {
    documents++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>Component preview<script>
      window.renders=0;
      addEventListener('message',event=>{
        if(event.data.type==='storypane:init')parent.postMessage({type:'storypane:status',status:'connected'},event.origin);
        if(event.data.type==='storypane:component'){window.renders++;parent.postMessage({type:'storypane:component-rendered',found:true},event.origin);}
      });
      parent.postMessage({type:'storypane:ready',spaceId:${JSON.stringify(installation.spaceId)},id:${JSON.stringify(installation.storyId)},componentPreview:true},${JSON.stringify(installation.origin)});
    </script></body></html>`,
    });
  });
  const settingsUrl = `/?space=${installation.spaceId}&view=settings&section=delivery`;
  const storyUrl = `/?space=${installation.spaceId}&story=${installation.storyId}`;
  try {
    await page.goto(settingsUrl);
    const toggle = page.getByRole('checkbox', { name: 'Content editor', exact: true });
    await expect(toggle).toBeChecked();
    await toggle.focus();
    await toggle.press('Space');
    await page.getByRole('button', { name: 'Save preview settings', exact: true }).click();
    await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
    await page.reload();
    await expect(toggle).not.toBeChecked();
    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page
      .locator('.block-preview-setting')
      .screenshot({ path: info.outputPath('preview-setting.png') });
    await page.goto(storyUrl);
    await page.getByRole('button', { name: 'Hide preview', exact: true }).click();
    const withoutHover = documents;
    const hero = page.locator('.block-list-item .entity-title').filter({ hasText: 'Hero' });
    await hero.hover();
    await page.waitForTimeout(500);
    await expect(page.locator('.block-hover-preview')).toHaveCount(0);
    expect(documents).toBe(withoutHover);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('iframe[title="Live application preview"]')).toBeVisible();
    await expect.poll(() => documents).toBe(withoutHover + 1);
    await page.goto(settingsUrl);
    await toggle.check();
    await page.getByRole('button', { name: 'Save preview settings', exact: true }).click();
    await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
    await page.goto(storyUrl);
    await page.getByRole('button', { name: 'Hide preview', exact: true }).click();
    const before = documents;
    await hero.hover();
    await page.mouse.move(1400, 80);
    await page.waitForTimeout(450);
    expect(documents).toBe(before);
    await hero.hover();
    const frame = page.frameLocator('iframe[title="Block preview"]');
    await expect(frame.locator('body')).toContainText('Component preview');
    await expect
      .poll(() =>
        page
          .locator('iframe[title="Block preview"]')
          .evaluate((element: HTMLIFrameElement) => (element.contentWindow ? true : false)),
      )
      .toBe(true);
    const previewFrame = page.frames().find((f) => f.url().startsWith('http://127.0.0.1:3159/'))!;
    await expect
      .poll(() => previewFrame.evaluate(() => (window as unknown as { renders: number }).renders))
      .toBeGreaterThan(0);
    const renders = await previewFrame.evaluate(
      () => (window as unknown as { renders: number }).renders,
    );
    const snapshot = await (
      await context.request.get(
        `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}`,
        { headers: headers(installation) },
      )
    ).json();
    const footer = snapshot.blocks.find((b: { fields: Record<string, unknown> }) => b.fields.text);
    const lease = await (
      await context.request.post(
        `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}/leases`,
        { headers: headers(installation), data: { blockId: footer.id } },
      )
    ).json();
    await page.waitForTimeout(500);
    expect(
      await previewFrame.evaluate(() => (window as unknown as { renders: number }).renders),
    ).toBe(renders);
    expect(documents).toBe(before + 1);
    await context.request.delete(
      `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}/leases`,
      { headers: headers(installation), data: { blockId: footer.id, token: lease.token } },
    );
  } finally {
    await context.close();
  }
});

test('rich text loads on demand and remains editable with saved formatting', async ({
  browser,
  installation,
}) => {
  await installation.db.query(
    `UPDATE definition_versions SET schema=jsonb_set(schema,'{fields}',(schema->'fields') || $1::jsonb) WHERE schema->>'name'='footer'`,
    [
      JSON.stringify([
        {
          id: crypto.randomUUID(),
          name: 'details',
          label: 'Details',
          type: 'text',
          format: 'richtext',
        },
      ]),
    ],
  );
  const { context, page } = await signIn(browser, installation);
  const chunks: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') chunks.push(request.url());
  });
  try {
    await page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}`);
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeEditable();
    const initialChunks = chunks.length;
    await page.locator('.block-list-item .entity-title').filter({ hasText: 'Footer' }).click();
    const details = page.getByRole('textbox', { name: 'Details', exact: true });
    await expect(details).toHaveAttribute('contenteditable', 'true');
    expect(chunks.length).toBeGreaterThan(initialChunks);
    const loadedChunks = chunks.length;
    await details.fill('Rich text still works');
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Page', exact: true })
      .click();
    await page.locator('.block-list-item .entity-title').filter({ hasText: 'Footer' }).click();
    await expect(details).toContainText('Rich text still works');
    await expect(details).toHaveAttribute('contenteditable', 'true');
    await details.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await expect(details.locator('strong')).toContainText('Rich text still works');
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Page', exact: true })
      .click();
    await page.locator('.block-list-item .entity-title').filter({ hasText: 'Footer' }).click();
    await expect(details.locator('strong')).toContainText('Rich text still works');
    expect(chunks).toHaveLength(loadedChunks);
  } finally {
    await context.close();
  }
});

test('Blocks table previews are lazy, keyboard accessible, and independently configurable', async ({
  browser,
  installation,
}) => {
  const previewId = crypto.randomUUID();
  await installation.db.query(
    'UPDATE spaces SET preview_urls=$2,default_preview_id=$3 WHERE id=$1',
    [
      installation.spaceId,
      JSON.stringify([{ id: previewId, name: 'Test app', url: 'http://127.0.0.1:3159/{slug}' }]),
      previewId,
    ],
  );
  await installation.db.query(
    `UPDATE definition_versions SET schema=jsonb_set(schema,'{previewData}',$1::jsonb) WHERE schema->>'name'='hero'`,
    [JSON.stringify({ title: 'Sample hero' })],
  );
  const { context, page } = await signIn(browser, installation);
  let documents = 0;
  await page.route('http://127.0.0.1:3159/**', (route) => {
    documents++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>Waiting<script>
        addEventListener('message',event=>{
          if(event.data.type==='storypane:component'){
            document.body.dataset.title=event.data.block.title;
            parent.postMessage({type:'storypane:component-rendered',found:true},event.origin);
          }
        });
        parent.postMessage({type:'storypane:ready',spaceId:${JSON.stringify(installation.spaceId)},slug:location.pathname.slice(1),componentPreview:true},${JSON.stringify(installation.origin)});
      </script></body></html>`,
    });
  });
  try {
    await page.goto(`/?space=${installation.spaceId}&view=blocks`);
    const hero = page.getByRole('button', { name: 'Hero', exact: true });
    await expect(hero).toBeVisible();
    await expect
      .poll(async () =>
        (
          await page.request.get('/api/cms/delivery-settings', { headers: headers(installation) })
        ).ok(),
      )
      .toBe(true);
    expect(documents).toBe(0);
    await hero.hover();
    const tooltip = page.getByRole('tooltip', { name: 'Block preview' });
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Sample content');
    const frame = page.frameLocator('iframe[title="Block preview"]');
    await expect(frame.locator('body')).toHaveAttribute('data-title', 'Sample hero');
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await hero.focus();
      await expect(tooltip).toBeVisible();
      await expect(hero).toHaveAttribute('aria-describedby', /.+/);
      const bounds = (await tooltip.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
      await hero.blur();
    }
    await page.goto(`/?space=${installation.spaceId}&view=settings&section=delivery`);
    await page.getByRole('checkbox', { name: 'Blocks table', exact: true }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'Content editor', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Add block pane', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Save preview settings', exact: true }).click();
    await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
    await page.goto(`/?space=${installation.spaceId}&view=blocks`);
    await expect(hero).toBeVisible();
    const before = documents;
    await hero.hover();
    await page.waitForTimeout(500);
    await expect(tooltip).toHaveCount(0);
    expect(documents).toBe(before);
  } finally {
    await context.close();
  }
});

test('mobile editor uses a header hamburger and a compact accessible toolbar', async ({
  browser,
  installation,
}, info) => {
  const { context, page } = await signIn(browser, installation, 'admin');
  try {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}`);
      await expect(page.getByRole('region', { name: 'Block editor' })).toBeVisible();
      const menu = page.getByRole('button', { name: 'Toggle navigation', exact: true });
      const header = page.locator('.app-header');
      await expect(
        header.getByRole('button', { name: 'Toggle navigation', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.app-sidebar')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const name of [
        'History',
        'Hide preview',
        'Reviews & comments',
        'Review & publish',
        'Story actions',
      ]) {
        const action = page.getByRole('button', { name, exact: true });
        await expect(action).toBeVisible();
        const bounds = (await action.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      const preview = page.getByRole('button', { name: 'Hide preview', exact: true });
      expect((await preview.boundingBox())!.width).toBeLessThanOrEqual(44);
      const actions = await page.locator('.story-actions').boundingBox();
      expect(actions!.height).toBeLessThan(100);
      await page.screenshot({ path: info.outputPath(`editor-mobile-${width}.png`) });
      await menu.focus();
      await menu.press('Enter');
      const navigation = page.getByRole('dialog', { name: 'Navigation', exact: true });
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await navigation.getByRole('button', { name: 'Settings', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(navigation).toBeHidden();
      await expect(menu).toBeFocused();
      await menu.click();
      await page.mouse.click(width - 8, 100);
      await expect(navigation).toBeHidden();
      await menu.click();
      await navigation.getByRole('button', { name: 'Content', exact: true }).click();
      await expect(navigation).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeHidden();
    await expect(page.locator('.app-sidebar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle navigation', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
});
