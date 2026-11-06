import { expect, test } from '@playwright/test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { getInstallation } from '@storypane/db/installation';
import type {
  Actor,
  UserDeliverySettings,
  LocaleSnapshot,
  Story,
  StoryLocale,
} from '@storypane/core';
import { createStorypaneClient } from '../packages/sdk/src/index';
import { signInPage } from './auth';

const cmsUrl = 'http://127.0.0.1:3130',
  siteUrl = 'http://127.0.0.1:3131';
test.use({ actionTimeout: 10000 });
const escapeHTML = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

test('a static app receives live drafts, selects blocks in the editor, and leaves public output unchanged', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const installation = getInstallation();
  const provisioningURL = installation.options.provisioningURL;
  if (!provisioningURL || !['localhost', '127.0.0.1'].includes(new URL(provisioningURL).hostname))
    throw new Error('Preview tests require disposable local database provisioning');
  let selected: Awaited<ReturnType<typeof installation.acquire>> | undefined;
  const spaceId = crypto.randomUUID();
  const servers: Server[] = [];
  try {
    await signInPage(page);
    const created = await page.request.post('/api/spaces', {
      headers: { Origin: cmsUrl },
      data: { id: spaceId, name: `SDK check ${spaceId}`, mode: 'create' },
    });
    expect(created.status(), await created.text()).toBe(201);
    selected = await installation.acquire(spaceId);
    const store = selected.store;
    const session = await (await page.request.get(`/api/session?space=${spaceId}`)).json();
    const actor: Actor = {
      spaceId: spaceId!,
      userId: session.user.id,
      sessionId: session.sessionId,
      role: 'admin',
    };
    await store.seed(actor);
    await page.goto(`/?space=${spaceId}&view=blocks`);
    await page.getByRole('button', { name: 'Hero', exact: true }).click();
    const schemaDrawer = page.locator('dialog.schema-drawer');
    await schemaDrawer.getByRole('tab', { name: 'Config', exact: true }).click();
    const sampleInput = schemaDrawer.getByLabel('Picker preview data (JSON)', { exact: true });
    await sampleInput.fill('{bad json');
    await schemaDrawer.getByRole('button', { name: 'Save to migration', exact: true }).click();
    await expect(schemaDrawer.getByRole('alert')).toContainText('Preview data must be valid JSON');
    await sampleInput.fill(JSON.stringify({ title: 'A populated picker sample.' }));
    await sampleInput.press('ControlOrMeta+s');
    await expect(schemaDrawer.getByRole('status')).toContainText('Saved to active migration');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Hero', exact: true }).click();
    await schemaDrawer.getByRole('tab', { name: 'Config', exact: true }).click();
    expect(JSON.parse(await sampleInput.inputValue())).toEqual({
      title: 'A populated picker sample.',
    });
    await page.keyboard.press('Escape');
    const migration = (await store.listMigrations(actor)).find((item) => item.status === 'active')!;
    const review = await store.reviewMigration(actor, migration.id);
    await store.deployMigration(actor, migration.id, review.token);
    const headers = { Origin: cmsUrl, 'x-storypane-space-id': spaceId! };
    const [story] = (await (
      await page.request.get('/api/cms/stories', { headers })
    ).json()) as Story[];
    const [locale] = (await (
      await page.request.get(`/api/cms/stories/${story!.id}/locales`, { headers })
    ).json()) as StoryLocale[];
    const base = `/api/cms/stories/${story!.id}/locales/${locale!.id}`;
    const snapshot = (await (await page.request.get(base, { headers })).json()) as LocaleSnapshot;
    const french = await store.createSpaceLocale(actor, { name: 'French', slug: 'fr' });
    await store.createLocale(actor, story.id, { spaceLocaleId: french.id });
    const publish = await page.request.post(`${base}/commands`, {
      headers,
      data: {
        type: 'publishCheckpoint',
        mutationId: crypto.randomUUID(),
        expectedRevisions: {},
        leaseTokens: {},
        payload: { checkpointId: snapshot.checkpointId },
      },
    });
    expect(publish.status(), await publish.text()).toBe(200);
    await page.goto(`/?space=${spaceId}&view=settings&section=delivery`);
    await page.getByRole('button', { name: 'Add preview URL', exact: true }).click();
    const stagingRow = page.getByRole('group', { name: 'Preview URL 1', exact: true });
    await stagingRow.getByLabel('Preview name', { exact: true }).fill('Staging');
    await stagingRow
      .getByLabel('Application preview URL', { exact: true })
      .fill('http://127.0.0.1:3153/{slug}?locale={locale}');
    await page.getByRole('button', { name: 'Add preview URL', exact: true }).click();
    const localRow = page.getByRole('group', { name: 'Preview URL 2', exact: true });
    await localRow.getByLabel('Preview name', { exact: true }).fill('Local');
    await localRow
      .getByLabel('Application preview URL', { exact: true })
      .fill(`${siteUrl}/{slug}?locale={locale}`);
    await localRow.getByRole('radio').check();
    await page.getByLabel('Preview URL parameter', { exact: true }).fill('review');
    const personalDefault = page.getByRole('combobox', { name: 'My default preview', exact: true });
    await personalDefault.selectOption({ label: 'Staging' });
    await page.getByRole('button', { name: 'Save preview settings' }).click();
    await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
    const settings = (await (
      await page.request.get('/api/cms/delivery-settings', { headers })
    ).json()) as UserDeliverySettings;
    expect(settings.defaultPreviewId).toBe(settings.previewUrls[1].id);
    expect(settings.personalDefaultPreviewId).toBe(settings.previewUrls[0].id);
    await page.reload();
    await expect(localRow.getByRole('radio')).toBeChecked();
    await expect(personalDefault).toHaveValue(settings.personalDefaultPreviewId!);
    await page
      .locator('.delivery-settings')
      .screenshot({ path: '/tmp/storypane-preview-urls-settings.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page
      .locator('.delivery-settings')
      .screenshot({ path: '/tmp/storypane-preview-urls-settings-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator('.delivery-settings')
      .getByLabel('Token name', { exact: true })
      .fill('Public website');
    await page
      .locator('.delivery-settings')
      .getByRole('button', { name: 'Create token', exact: true })
      .click();
    const publishedToken = page.getByLabel('New token — copy it now', { exact: true });
    await expect(publishedToken).toHaveValue(/^bl_pub_/);
    const delivery = createStorypaneClient({
      url: cmsUrl,
      spaceId: spaceId!,
      token: await publishedToken.inputValue(),
    });
    const initial = await delivery.getStory({ slug: 'home' });
    await page
      .locator('.delivery-settings')
      .getByLabel('Token name', { exact: true })
      .fill('Server preview');
    await page.getByRole('combobox', { name: 'Access', exact: true }).selectOption('preview');
    await page
      .locator('.delivery-settings')
      .getByRole('button', { name: 'Create token', exact: true })
      .click();
    await expect(publishedToken).toHaveValue(/^bl_preview_/);
    const preview = createStorypaneClient({
      url: cmsUrl,
      spaceId: spaceId!,
      token: await publishedToken.inputValue(),
    });
    const hero = snapshot.blocks.find(
      (block) =>
        snapshot.definitions.find((definition) => definition.versionId === block.schemaVersionId)
          ?.name === 'hero',
    )!;
    const footer = snapshot.blocks.find(
      (block) =>
        snapshot.definitions.find((definition) => definition.versionId === block.schemaVersionId)
          ?.name === 'footer',
    )!;
    // The HTTP server serves the same build-time HTML and JSON for every request.
    const html = (await readFile(new URL('./fixtures/preview-app.html', import.meta.url), 'utf8'))
      .replace(
        '__HTML__',
        `<section data-storypane-id="${hero.id}" tabindex="0"><h1>${escapeHTML(String(hero.fields.title))}</h1></section><section data-storypane-id="${footer.id}" tabindex="0">${escapeHTML(String(footer.fields.text))}</section>`,
      )
      .replace(
        '__INITIAL__',
        JSON.stringify({ story: initial, spaceId, cmsUrl }).replaceAll('<', '\\u003c'),
      );
    const serve = async (request: IncomingMessage, response: ServerResponse) => {
      try {
        const pathname = new URL(request.url!, siteUrl).pathname;
        if (pathname === '/session') {
          if (
            request.method !== 'POST' ||
            !request.headers.cookie
              ?.split(';')
              .some((cookie) => cookie.trim() === 'fixture_preview=allowed')
          ) {
            response.writeHead(401).end();
            return;
          }
          const value = await preview.createPreviewSession({
            id: story!.id,
            previewId: settings.previewUrls[request.socket.localPort === 3153 ? 0 : 1].id,
          });
          response
            .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            .end(JSON.stringify(value));
          return;
        }
        if (['/sdk/preview.js', '/sdk/types.js', '/sdk/migration-warning.js'].includes(pathname)) {
          response
            .writeHead(200, { 'Content-Type': 'text/javascript' })
            .end(
              await readFile(
                new URL(`../packages/sdk/dist/${pathname.split('/').pop()}`, import.meta.url),
              ),
            );
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
      } catch {
        response.writeHead(500).end('Fixture error');
      }
    };
    for (const port of [3131, 3153]) {
      const server = createServer(serve);
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
    }
    const visitor = await context.newPage();
    await visitor.goto(`${siteUrl}/home`);
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(String(hero.fields.title));
    await expect(visitor.locator('#status')).toHaveText('disabled');
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Content', exact: true })
      .click();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide preview', exact: true })).toBeVisible();
    const frame = page.frameLocator('iframe[title="Live application preview"]');
    const switcher = page.getByRole('combobox', { name: 'Preview URL', exact: true });
    await expect(switcher).toHaveValue(settings.personalDefaultPreviewId!);
    await expect(page.locator('iframe[title="Live application preview"]')).toHaveAttribute(
      'src',
      'http://127.0.0.1:3153/home?locale=&review=1',
    );
    await expect(frame.locator('#status')).toHaveText('connected');
    await switcher.selectOption(settings.defaultPreviewId!);
    await expect(page.locator('iframe[title="Live application preview"]')).toHaveAttribute(
      'src',
      `${siteUrl}/home?locale=&review=1`,
    );
    await expect(frame.locator('#status')).toHaveText('connected');
    const sizes = page.getByRole('group', { name: 'Preview size', exact: true });
    const liveIframe = page.locator('iframe[title="Live application preview"]');
    await expect(sizes.getByRole('button', { name: 'Desktop', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.setViewportSize({ width: 2560, height: 1000 });
    await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBeGreaterThan(1440);
    const desktopWidth = await frame.locator('html').evaluate(() => innerWidth);
    await expect
      .poll(() =>
        liveIframe.evaluate(
          (iframe) =>
            Math.abs(
              iframe.getBoundingClientRect().width -
                iframe.parentElement!.getBoundingClientRect().width,
            ) < 1,
        ),
      )
      .toBe(true);
    const dropdownBounds = (await switcher.boundingBox())!;
    const sizeBounds = (await sizes.boundingBox())!;
    expect(sizeBounds.x).toBeGreaterThan(dropdownBounds.x + dropdownBounds.width);
    expect(Math.abs(sizeBounds.y - dropdownBounds.y)).toBeLessThan(2);
    await page.getByRole('region', { name: 'Application preview' }).screenshot({
      path: '/tmp/storypane-preview-controls-desktop.png',
    });
    await frame.locator('body').evaluate((body) => (body.dataset.resizeCheck = 'preserved'));
    await sizes.getByRole('button', { name: 'Mobile', exact: true }).focus();
    for (const [name, width] of [
      ['Mobile', 390],
      ['Tablet', 768],
      ['Desktop', desktopWidth],
    ] as const) {
      await expect(sizes.getByRole('button', { name, exact: true })).toBeFocused();
      await page.keyboard.press('Space');
      await expect(sizes.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBe(width);
      expect(
        await frame.locator('html').evaluate(() => matchMedia('(min-width: 1024px)').matches),
      ).toBe(width >= 1024);
      await expect(frame.locator('body')).toHaveAttribute('data-resize-check', 'preserved');
      await expect(frame.locator('#status')).toHaveText('connected');
      await page.keyboard.press('Tab');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        liveIframe.evaluate(
          (iframe) =>
            Math.abs(
              iframe.getBoundingClientRect().width -
                iframe.parentElement!.getBoundingClientRect().width,
            ) < 1,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => frame.locator('html').evaluate(() => innerWidth))
      .toBeLessThanOrEqual(390);
    const mobileDropdown = (await switcher.boundingBox())!;
    const mobileButtons = (await sizes.boundingBox())!;
    expect(mobileButtons.x).toBeGreaterThan(mobileDropdown.x + mobileDropdown.width);
    expect(Math.abs(mobileButtons.y - mobileDropdown.y)).toBeLessThan(2);
    await expect
      .poll(async () => {
        const bounds = await liveIframe.boundingBox();
        return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390;
      })
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('region', { name: 'Application preview' }).screenshot({
      path: '/tmp/storypane-desktop-preview-on-mobile.png',
    });
    await sizes.getByRole('button', { name: 'Mobile', exact: true }).click();
    await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBe(390);
    await expect(frame.locator('body')).toHaveAttribute('data-resize-check', 'preserved');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await sizes.getByRole('button', { name: 'Tablet', exact: true }).click();
    await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBe(768);
    const editor = page.getByRole('region', { name: 'Block editor' });
    const heroButton = editor.getByRole('button', { name: 'Hero', exact: true });
    const hoverPreview = page.locator('.block-hover-preview');
    const blockFrame = page.frameLocator('iframe[title="Block preview"]');
    let previewSessions = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/preview'))
        previewSessions++;
    });
    await heroButton.hover();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(450);
    await expect(hoverPreview).toHaveCount(0);
    expect(previewSessions).toBe(0);
    await heroButton.hover();
    await expect(hoverPreview).toBeVisible();
    await expect(
      hoverPreview.getByRole('group', { name: 'Preview size', exact: true }),
    ).toHaveCount(0);
    await expect(blockFrame.getByRole('heading', { level: 1 })).toHaveText(
      String(hero.fields.title),
    );
    await expect(blockFrame.locator('[data-storypane-id]')).toHaveCount(1);
    await expect(blockFrame.locator('header')).toBeHidden();
    await hoverPreview.hover();
    await expect(hoverPreview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hoverPreview).toHaveCount(0);
    await expect(page.locator('iframe[title="Block preview"]')).toHaveCount(0);
    await editor.getByRole('button', { name: 'Add block', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add a block', exact: true });
    await picker.getByRole('searchbox', { name: 'Search blocks' }).focus();
    await page.keyboard.press('Tab');
    await expect(picker.getByRole('button', { name: 'Add Footer', exact: true })).toBeFocused();
    await expect(
      picker.getByRole('button', { name: 'Add Footer', exact: true }),
    ).not.toHaveAttribute('data-preview-definition');
    await page.waitForTimeout(450);
    await expect(hoverPreview).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(picker.getByRole('button', { name: 'Add Hero', exact: true })).toBeFocused();
    await expect(blockFrame.getByRole('heading', { level: 1 })).toHaveText(
      'A populated picker sample.',
    );
    await expect(blockFrame.locator('[data-storypane-id]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(hoverPreview).toHaveCount(0);
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.getByRole('button', { name: 'Add block', exact: true }).click();
    await picker.getByRole('searchbox', { name: 'Search blocks' }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(picker.getByRole('button', { name: 'Add Hero', exact: true })).toBeFocused();
    await expect(blockFrame.getByRole('heading', { level: 1 })).toHaveText(
      'A populated picker sample.',
    );
    await expect(blockFrame.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await hoverPreview.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight
        );
      }),
    ).toBe(true);
    await page.screenshot({ path: '/tmp/storypane-block-preview-mobile.png' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(picker).not.toBeVisible();
    expect(
      ((await (await page.request.get(base, { headers })).json()) as LocaleSnapshot).blocks,
    ).toHaveLength(snapshot.blocks.length);
    await page.setViewportSize({ width: 1280, height: 720 });
    await editor.getByRole('button', { name: 'Hero', exact: true }).click();
    await page.getByRole('textbox', { name: /^Title/ }).fill('Updated live without rebuilding');
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(
      'Updated live without rebuilding',
      { timeout: 20000 },
    );
    await expect(frame.locator(`[data-storypane-id="${hero.id}"]`)).toHaveAttribute(
      'data-storypane-selected',
      '',
    );
    await switcher.selectOption(settings.previewUrls[0].id);
    await expect(frame.locator('#status')).toHaveText('connected');
    await expect(page.locator('iframe[title="Live application preview"]')).toHaveAttribute(
      'src',
      'http://127.0.0.1:3153/home?locale=&review=1',
    );
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(
      'Updated live without rebuilding',
    );
    await expect(frame.locator(`[data-storypane-id="${hero.id}"]`)).toHaveAttribute(
      'data-storypane-selected',
      '',
    );
    await page.getByRole('button', { name: 'Reload preview', exact: true }).click();
    await expect(frame.locator('#status')).toHaveText('connected');
    await page.getByRole('button', { name: 'Hide preview', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(switcher).toHaveValue(settings.previewUrls[0].id);
    await expect(frame.locator('#status')).toHaveText('connected');
    await page.getByRole('tab', { name: 'French fr', exact: true }).click();
    await expect(switcher).toHaveValue(settings.previewUrls[0].id);
    await expect(page.locator('iframe[title="Live application preview"]')).toHaveAttribute(
      'src',
      'http://127.0.0.1:3153/home?locale=fr&review=1',
    );
    await expect(frame.locator('#status')).toHaveText('connected');
    await page.getByRole('tab', { name: 'Default', exact: true }).click();
    await expect(page.locator('iframe[title="Live application preview"]')).toHaveAttribute(
      'src',
      'http://127.0.0.1:3153/home?locale=&review=1',
    );
    await expect(frame.locator('#status')).toHaveText('connected');
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(
      'Updated live without rebuilding',
    );
    await page
      .getByRole('region', { name: 'Application preview' })
      .screenshot({ path: '/tmp/storypane-preview-url-switcher.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page
      .getByRole('region', { name: 'Application preview' })
      .screenshot({ path: '/tmp/storypane-preview-url-switcher-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await frame.locator(`[data-storypane-id="${footer.id}"]`).click();
    await expect(page.getByLabel('Footer text', { exact: true })).toBeEditable();
    await expect(
      page
        .getByRole('navigation', { name: 'Block path' })
        .getByRole('button', { name: 'Footer', exact: true }),
    ).toHaveAttribute('aria-current', 'location');
    expect(JSON.stringify((await delivery.getStory({ slug: 'home' })).content)).not.toContain(
      'Updated live',
    );
    await visitor.reload();
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(String(hero.fields.title));
    // A URL flag alone does not authorize draft access outside the iframe.
    await visitor.goto(`${siteUrl}/home?review=1`);
    await expect(visitor.locator('#status')).toHaveText('Sign in to preview');
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(String(hero.fields.title));
    // Standalone cookie preview obtains a scoped session from the app's authenticated server.
    await context.addCookies([{ name: 'fixture_preview', value: 'allowed', url: siteUrl }]);
    await visitor.goto(`${siteUrl}/home`);
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(
      'Updated live without rebuilding',
    );
    await visitor.close();
    await page.getByRole('button', { name: 'Hide preview', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Content', exact: true })
      .click();
    await page.goto(`/?space=${spaceId}&view=settings&section=delivery`);
    await page.getByRole('button', { name: 'Remove preview 2', exact: true }).click();
    await expect(stagingRow.getByRole('radio')).toBeChecked();
    await page.getByRole('button', { name: 'Save preview settings', exact: true }).click();
    await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove preview 1', exact: true }).click();
    await page.getByRole('button', { name: 'Save preview settings', exact: true }).click();
    await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('No preview URLs configured yet.', { exact: true })).toBeVisible();
  } finally {
    await Promise.all(context.pages().map((current) => current.close()));
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await selected?.close();
    // This UUID was generated by this test; never remove an existing workspace.
    const provisioner = new Pool({ connectionString: provisioningURL });
    try {
      const name = `sp_${spaceId.replaceAll('-', '')}`;
      await installation.pool.query('DELETE FROM preview_routes WHERE space_id=$1', [spaceId]);
      await installation.pool.query('DELETE FROM space_connections WHERE id=$1', [spaceId]);
      await provisioner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await provisioner.query(`DROP ROLE IF EXISTS "${name}"`);
    } finally {
      await provisioner.end();
      await installation.pool.end();
    }
  }
});
