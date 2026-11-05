import { expect, test } from '@playwright/test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { StorypaneStore } from '@storypane/db';
import type { Actor, DeliverySettings, LocaleSnapshot, Story, StoryLocale } from '@storypane/core';
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
  const db = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://storypane:storypane@127.0.0.1:55432/storypane',
  });
  let spaceId: string | undefined;
  const servers: Server[] = [];
  try {
    await signInPage(page);
    const created = await page.request.post('/api/spaces', {
      headers: { Origin: cmsUrl },
      data: { name: `SDK check ${crypto.randomUUID()}` },
    });
    expect(created.status()).toBe(201);
    spaceId = (await created.json()).id;
    const session = await (await page.request.get(`/api/session?space=${spaceId}`)).json();
    const actor: Actor = {
      spaceId: spaceId!,
      userId: session.user.id,
      sessionId: session.sessionId,
      role: 'admin',
    };
    await new StorypaneStore(db).seed(actor);
    const headers = { Origin: cmsUrl, 'x-storypane-space-id': spaceId! };
    const [story] = (await (
      await page.request.get('/api/cms/stories', { headers })
    ).json()) as Story[];
    const [locale] = (await (
      await page.request.get(`/api/cms/stories/${story!.id}/locales`, { headers })
    ).json()) as StoryLocale[];
    const base = `/api/cms/stories/${story!.id}/locales/${locale!.id}`;
    const snapshot = (await (await page.request.get(base, { headers })).json()) as LocaleSnapshot;
    const store = new StorypaneStore(db);
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
      .fill('http://127.0.0.1:3133/{slug}?locale={locale}');
    await page.getByRole('button', { name: 'Add preview URL', exact: true }).click();
    const localRow = page.getByRole('group', { name: 'Preview URL 2', exact: true });
    await localRow.getByLabel('Preview name', { exact: true }).fill('Local');
    await localRow
      .getByLabel('Application preview URL', { exact: true })
      .fill(`${siteUrl}/{slug}?locale={locale}`);
    await localRow.getByRole('radio').check();
    await page.getByLabel('Preview URL parameter', { exact: true }).fill('review');
    await page.getByRole('button', { name: 'Save preview settings' }).click();
    await expect(page.getByText('Preview settings saved', { exact: true })).toBeVisible();
    const settings = (await (
      await page.request.get('/api/cms/delivery-settings', { headers })
    ).json()) as DeliverySettings;
    expect(settings.defaultPreviewId).toBe(settings.previewUrls[1].id);
    await page.reload();
    await expect(localRow.getByRole('radio')).toBeChecked();
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
    await page.getByLabel('Token name', { exact: true }).fill('Public website');
    await page.getByRole('button', { name: 'Create token', exact: true }).click();
    const publishedToken = page.getByLabel('New token — copy it now', { exact: true });
    await expect(publishedToken).toHaveValue(/^bl_pub_/);
    const delivery = createStorypaneClient({
      url: cmsUrl,
      spaceId: spaceId!,
      token: await publishedToken.inputValue(),
    });
    const initial = await delivery.getStory({ slug: 'home' });
    await page.getByLabel('Token name', { exact: true }).fill('Server preview');
    await page.getByRole('combobox', { name: 'Access', exact: true }).selectOption('preview');
    await page.getByRole('button', { name: 'Create token', exact: true }).click();
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
            previewId: settings.previewUrls[request.socket.localPort === 3133 ? 0 : 1].id,
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
    for (const port of [3131, 3133]) {
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
    await expect(switcher).toHaveValue(settings.defaultPreviewId!);
    await expect(page.locator('iframe')).toHaveAttribute('src', `${siteUrl}/home?locale=&review=1`);
    await expect(frame.locator('#status')).toHaveText('connected');
    const editor = page.getByRole('region', { name: 'Block editor' });
    await editor.getByRole('button', { name: 'Hero', exact: true }).click();
    await page.getByRole('textbox', { name: /^Title/ }).fill('Updated live without rebuilding');
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(
      'Updated live without rebuilding',
    );
    await expect(frame.locator(`[data-storypane-id="${hero.id}"]`)).toHaveAttribute(
      'data-storypane-selected',
      '',
    );
    await switcher.selectOption({ label: 'Staging' });
    await expect(frame.locator('#status')).toHaveText('connected');
    await expect(page.locator('iframe')).toHaveAttribute(
      'src',
      'http://127.0.0.1:3133/home?locale=&review=1',
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
    await expect(page.locator('iframe')).toHaveAttribute(
      'src',
      'http://127.0.0.1:3133/home?locale=fr&review=1',
    );
    await expect(frame.locator('#status')).toHaveText('connected');
    await page.getByRole('tab', { name: 'Default', exact: true }).click();
    await expect(page.locator('iframe')).toHaveAttribute(
      'src',
      'http://127.0.0.1:3133/home?locale=&review=1',
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
    if (spaceId) {
      // Delete only this test's local workspace, after closing its clients.
      const locales =
        '(SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)';
      const cleanup = await db.connect();
      await cleanup.query('BEGIN');
      try {
        for (const table of ['mutation_receipts', 'publications', 'checkpoints', 'block_drafts'])
          await cleanup.query(`DELETE FROM ${table} WHERE locale_id IN ${locales}`, [spaceId]);
        await cleanup.query('DELETE FROM stories WHERE space_id=$1', [spaceId]);
        await cleanup.query(
          'DELETE FROM definition_versions WHERE definition_id IN (SELECT id FROM definitions WHERE space_id=$1)',
          [spaceId],
        );
        await cleanup.query('DELETE FROM definitions WHERE space_id=$1', [spaceId]);
        await cleanup.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
        await cleanup.query('COMMIT');
      } catch (error) {
        await cleanup.query('ROLLBACK');
        // eslint-disable-next-line no-unsafe-finally -- Cleanup failures must fail the test rather than leave fixtures silently.
        throw error;
      } finally {
        cleanup.release();
      }
    }
    await db.end();
  }
});
