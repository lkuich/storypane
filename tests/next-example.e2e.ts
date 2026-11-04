import { expect,test } from '@playwright/test';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import type { DeliverySettings } from '@storypane/core';
import type { StorypaneStory } from '../packages/sdk/src/types';
import type { StorypaneContentType } from '../apps/example-astro/src/types/storypane';

const configured = existsSync('apps/example-next/.env') && existsSync('apps/example-astro/.env');
test('Next.js renders publications and authenticates live previews, including unpublished stories and selected footers',async ({ page,context }) => {
  test.skip(!configured,'Run pnpm example:setup:next and pnpm build:example:next first.');
  test.setTimeout(90000);
  const env = parseEnv(readFileSync('apps/example-astro/.env','utf8'));
  const cms = env.STORYPANE_URL ?? env.BLOK_URL!,spaceId = env.STORYPANE_SPACE_ID ?? env.BLOK_SPACE_ID!;
  const site = 'http://127.0.0.1:3133';
  expect(cms).toBe('http://127.0.0.1:3130');
  const database = process.env.DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok';
  expect(['127.0.0.1','localhost']).toContain(new URL(database).hostname);
  const pool = new Pool({ connectionString:database });
  const settings:DeliverySettings = await pool.query('SELECT preview_urls AS "previewUrls",default_preview_id AS "defaultPreviewId",preview_parameter AS "previewParameter" FROM spaces WHERE id=$1',[spaceId]).then(result => result.rows[0]).finally(() => pool.end());
  const target = settings.previewUrls.find(target => new URL(target.url).origin === site)!;
  expect(target?.name).toBe('Local Next.js');
  expect(settings.previewUrls.find(target => target.id === settings.defaultPreviewId)?.url).toContain(':3132/');
  const errors:string[]=[];
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(site);
  await expect(page).toHaveURL(`${site}/home`);
  const title = await page.getByRole('heading',{ level:1 }).innerText();
  expect(readFileSync('apps/example-next/.next/server/app/home.html','utf8')).toContain(title);
  await expect(page.getByRole('status')).toHaveCount(0);
  for (const image of await page.locator('.hero-image').all()) {
    await expect.poll(() => image.evaluate((element:HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await page.screenshot({ path:'/tmp/storypane-next-desktop.png',fullPage:true });
  await page.setViewportSize({ width:390,height:844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:'/tmp/storypane-next-mobile.png',fullPage:true });
  await page.goto(`${site}/fr/home`);
  await expect(page.getByRole('heading',{ level:1 })).toHaveText('Faites place à la suite.');
  await expect(page.locator('[lang="fr"]')).toBeVisible();
  expect((await page.request.get(`${site}/work-in-progress`)).status()).toBe(404);
  expect((await page.request.get(`${site}/media/not-a-published-asset`)).status()).toBe(404);
  await page.goto(`${site}/preview?slug=work-in-progress`);
  await expect(page.getByRole('status')).toContainText('Open a story in Storypane');
  await expect(page.locator('[data-blok-id]')).toHaveCount(0);

  await context.grantPermissions(['local-network-access'],{ origin:cms });
  await page.setViewportSize({ width:1400,height:1000 });
  for (const [slug,locale] of [['home',''],['home','fr'],['work-in-progress','']]) {
    const response = await page.request.post(`${cms}/api/delivery/preview?space=${spaceId}`,{ headers:{ Authorization:`Bearer ${env.STORYPANE_PREVIEW_TOKEN ?? env.BLOK_PREVIEW_TOKEN}` },data:{ slug,locale,previewId:target.id } });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    const parentUrl = `${cms}/__next-example-test/${slug}/${locale}`;
    const src = target.url.replace('{slug}',encodeURIComponent(slug!)).replace('{locale}',encodeURIComponent(locale!));
    const payloads:StorypaneStory<StorypaneContentType>[]=[];
    page.on('websocket',socket => {
      if (new URL(socket.url()).pathname !== '/api/preview/live') return;
      socket.on('framereceived',event => {
        const message = JSON.parse(String(event.payload));
        if (message.type === 'content') payloads.push(message.story);
      });
    });
    await page.route(parentUrl,route => route.fulfill({ contentType:'text/html',body:`<!doctype html><html><head><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style></head><body><iframe title="Live application preview" src="${src}"></iframe><script>const session=${JSON.stringify(session)};window.addEventListener('message',event=>{if(event.origin!==${JSON.stringify(site)}||event.source!==document.querySelector('iframe').contentWindow)return;if(event.data?.type==='blok:ready')event.source.postMessage({type:'blok:init',session},event.origin);if(event.data?.type==='blok:click')document.body.dataset.selected=event.data.blockId;});</script></body></html>` }));
    await page.goto(parentUrl);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect.poll(() => payloads.length).toBeGreaterThan(0);
    const story = payloads.at(-1)!;
    expect(story.slug).toBe(slug);
    expect(story.locale).toBe(locale);
    if (story.content.component === 'page') {
      const hero = story.content.body.find(block => block.component === 'hero');
      if (hero?.component === 'hero') await expect(frame.getByRole('heading',{ level:1 })).toHaveText(hero.title);
      const footerId = story.content.footer,footer = story.references?.find(item => item.id === footerId);
      if (footer?.content.component === 'footer') {
        await expect(frame.locator('.site-footer')).toContainText(String(footer.content.text));
        await expect(frame.locator('.footer-credit')).toContainText('Next.js');
      }
    }
    const block = frame.locator('[data-blok-id]').last(),blockId = await block.getAttribute('data-blok-id');
    await block.click();
    await expect(page.locator('body')).toHaveAttribute('data-selected',blockId!);
    await expect(block).toHaveAttribute('data-blok-selected','');
    if (slug === 'home' && !locale) await page.screenshot({ path:'/tmp/storypane-next-live-preview.png',fullPage:true });
  }
  for (const dir of ['.next/static','.next/server/app']) for (const file of readdirSync(`apps/example-next/${dir}`,{ recursive:true }).filter((file):file is string => typeof file === 'string' && /\.(js|html|rsc)$/.test(file))) {
    const contents = readFileSync(`apps/example-next/${dir}/${file}`,'utf8');
    for (const name of ['STORYPANE_DELIVERY_TOKEN','STORYPANE_PREVIEW_TOKEN','BLOK_DELIVERY_TOKEN','BLOK_PREVIEW_TOKEN']) if (env[name]) expect(contents.includes(env[name])).toBe(false);
  }
  expect(errors).toEqual([]);
});
