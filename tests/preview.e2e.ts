import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { BlokStore } from '@blok/db';
import type { Actor, DeliverySettings, LocaleSnapshot, Story, StoryLocale } from '@blok/core';
import { createBlokClient } from '../packages/sdk/src/index';
import { signInPage } from './auth';

const cmsUrl = 'http://127.0.0.1:3130', siteUrl = 'http://127.0.0.1:3131';
test.use({ actionTimeout:10000 });
const escapeHTML = (value:string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

test('a static app receives live drafts, selects blocks in the editor, and leaves public output unchanged', async ({ page, context }) => {
  test.setTimeout(90000);
  const db = new Pool({ connectionString:'postgresql://blok:blok@127.0.0.1:55432/blok' });
  let spaceId:string | undefined, server:Server | undefined;
  try {
    await signInPage(page);
    const created = await page.request.post('/api/spaces',{ headers:{ Origin:cmsUrl },data:{ name:`SDK check ${crypto.randomUUID()}` } });
    expect(created.status()).toBe(201); spaceId = (await created.json()).id;
    const session = await (await page.request.get(`/api/session?space=${spaceId}`)).json();
    const actor:Actor = { spaceId:spaceId!, userId:session.user.id,sessionId:session.sessionId,role:'admin' };
    await new BlokStore(db).seed(actor);
    const headers = { Origin:cmsUrl,'x-blok-space-id':spaceId! };
    const [story] = await (await page.request.get('/api/cms/stories',{ headers })).json() as Story[];
    const [locale] = await (await page.request.get(`/api/cms/stories/${story!.id}/locales`,{ headers })).json() as StoryLocale[];
    const base = `/api/cms/stories/${story!.id}/locales/${locale!.id}`;
    const snapshot = await (await page.request.get(base,{ headers })).json() as LocaleSnapshot;
    const publish = await page.request.post(`${base}/commands`,{ headers,data:{ type:'publishCheckpoint',mutationId:crypto.randomUUID(),expectedRevisions:{},leaseTokens:{},payload:{ checkpointId:snapshot.checkpointId } } });
    expect(publish.status(),await publish.text()).toBe(200);
    await page.goto(`/?space=${spaceId}&view=settings`);
    await page.getByLabel('Application preview URL',{ exact:true }).fill(`${siteUrl}/{slug}`);
    await page.getByLabel('Preview URL parameter',{ exact:true }).fill('review');
    await page.getByRole('button',{ name:'Save preview settings' }).click();
    await expect(page.getByText('Preview settings saved',{ exact:true })).toBeVisible();
    await page.getByLabel('Token name',{ exact:true }).fill('Public website');
    await page.getByRole('button',{ name:'Create token',exact:true }).click();
    const publishedToken = page.getByLabel('New token — copy it now',{ exact:true });
    await expect(publishedToken).toHaveValue(/^bl_pub_/);
    const delivery = createBlokClient({ url:cmsUrl,spaceId:spaceId!,token:await publishedToken.inputValue() });
    const initial = await delivery.getStory({ slug:'home' });
    await page.getByLabel('Token name',{ exact:true }).fill('Server preview');
    await page.getByRole('combobox',{ name:'Access',exact:true }).selectOption('preview');
    await page.getByRole('button',{ name:'Create token',exact:true }).click();
    await expect(publishedToken).toHaveValue(/^bl_preview_/);
    const preview = createBlokClient({ url:cmsUrl,spaceId:spaceId!,token:await publishedToken.inputValue() });
    const hero = snapshot.blocks.find(block => snapshot.definitions.find(definition => definition.versionId === block.schemaVersionId)?.name === 'hero')!;
    const footer = snapshot.blocks.find(block => snapshot.definitions.find(definition => definition.versionId === block.schemaVersionId)?.name === 'footer')!;
    // The HTTP server serves the same build-time HTML and JSON for every request.
    const html = (await readFile(new URL('./fixtures/preview-app.html',import.meta.url),'utf8'))
      .replace('__HTML__',`<section data-blok-id="${hero.id}" tabindex="0"><h1>${escapeHTML(String(hero.fields.title))}</h1></section><section data-blok-id="${footer.id}" tabindex="0">${escapeHTML(String(footer.fields.text))}</section>`)
      .replace('__INITIAL__',JSON.stringify({ story:initial,spaceId,cmsUrl }).replaceAll('<','\\u003c'));
    server = createServer(async (request,response) => {
      try {
        const pathname = new URL(request.url!,siteUrl).pathname;
        if (pathname === '/session') {
          if (request.method !== 'POST' || !request.headers.cookie?.split(';').some(cookie => cookie.trim() === 'fixture_preview=allowed')) { response.writeHead(401).end(); return; }
          const value = await preview.createPreviewSession({ id:story!.id });
          response.writeHead(200,{ 'Content-Type':'application/json','Cache-Control':'no-store' }).end(JSON.stringify(value)); return;
        }
        if (['/sdk/preview.js','/sdk/types.js'].includes(pathname)) {
          response.writeHead(200,{ 'Content-Type':'text/javascript' }).end(await readFile(new URL(`../packages/sdk/dist/${pathname.split('/').pop()}`,import.meta.url))); return;
        }
        response.writeHead(200,{ 'Content-Type':'text/html' }).end(html);
      } catch { response.writeHead(500).end('Fixture error'); }
    });
    await new Promise<void>((resolve,reject) => { server!.once('error',reject); server!.listen(3131,'127.0.0.1',resolve); });
    const visitor = await context.newPage(); await visitor.goto(`${siteUrl}/home`);
    await expect(visitor.getByRole('heading',{ level:1 })).toHaveText(String(hero.fields.title));
    await expect(visitor.locator('#status')).toHaveText('disabled');
    await page.getByRole('navigation',{ name:'Main navigation' }).getByRole('button',{ name:'Content',exact:true }).click();
    await page.getByRole('button',{ name:'Home',exact:true }).click();
    await page.getByRole('button',{ name:'Preview',exact:true }).click();
    const frame = page.frameLocator('iframe[title="Live application preview"]');
    await expect(frame.locator('#status')).toHaveText('connected');
    const outline = page.getByRole('complementary',{ name:'Block outline' });
    await outline.getByRole('button',{ name:'Hero',exact:true }).click();
    await page.getByRole('textbox',{ name:/^Title/ }).fill('Updated live without rebuilding');
    await expect(frame.getByRole('heading',{ level:1 })).toHaveText('Updated live without rebuilding');
    await expect(frame.locator(`[data-blok-id="${hero.id}"]`)).toHaveAttribute('data-blok-selected','');
    await frame.locator(`[data-blok-id="${footer.id}"]`).click();
    await expect(page.getByLabel('Footer text',{ exact:true })).toBeEditable();
    await expect(outline.getByRole('button',{ name:'Footer',exact:true })).toHaveAttribute('aria-current','true');
    expect(JSON.stringify((await delivery.getStory({ slug:'home' })).content)).not.toContain('Updated live');
    await visitor.reload(); await expect(visitor.getByRole('heading',{ level:1 })).toHaveText(String(hero.fields.title));
    // A URL flag alone does not authorize draft access outside the iframe.
    await visitor.goto(`${siteUrl}/home?review=1`);
    await expect(visitor.locator('#status')).toHaveText('Sign in to preview');
    await expect(visitor.getByRole('heading',{ level:1 })).toHaveText(String(hero.fields.title));
    // Standalone cookie preview obtains a scoped session from the app's authenticated server.
    await context.addCookies([{ name:'fixture_preview',value:'allowed',url:siteUrl }]);
    await visitor.goto(`${siteUrl}/home`);
    await expect(visitor.getByRole('heading',{ level:1 })).toHaveText('Updated live without rebuilding');
    await visitor.close();
    await page.getByRole('button',{ name:'Hide preview',exact:true }).click();
    await page.getByRole('navigation',{ name:'Main navigation' }).getByRole('button',{ name:'Content',exact:true }).click();
  } finally {
    await Promise.all(context.pages().map(current => current.close()));
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    if (spaceId) {
      // Delete only this test's local workspace, after closing its clients.
      const locales = '(SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)';
      const cleanup = await db.connect();
      await cleanup.query('BEGIN');
      try {
        for (const table of ['mutation_receipts','publications','checkpoints','block_drafts']) await cleanup.query(`DELETE FROM ${table} WHERE locale_id IN ${locales}`,[spaceId]);
        await cleanup.query('DELETE FROM stories WHERE space_id=$1',[spaceId]);
        await cleanup.query('DELETE FROM definition_versions WHERE definition_id IN (SELECT id FROM definitions WHERE space_id=$1)',[spaceId]);
        await cleanup.query('DELETE FROM definitions WHERE space_id=$1',[spaceId]);
        await cleanup.query('DELETE FROM spaces WHERE id=$1',[spaceId]);
        await cleanup.query('COMMIT');
      } catch (error) { await cleanup.query('ROLLBACK'); throw error; }
      finally { cleanup.release(); }
    }
    await db.end();
  }
});
