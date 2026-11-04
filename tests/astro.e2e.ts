import { expect,test } from '@playwright/test';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { DeliverySettings,Lease,LocaleSnapshot,Story,StoryLocale } from '@blok/core';
import { signInPage } from './auth';

const env = existsSync('apps/example-astro/.env') ? parseEnv(readFileSync('apps/example-astro/.env','utf8')) : undefined;
test('Astro serves built publications and locales, hydrates drafts, selects nested blocks, and previews unpublished stories',async ({ page,context }) => {
  test.skip(!env,'Run pnpm example:setup and pnpm build:example to enable the Astro integration test.');
  test.setTimeout(90000);
  const site = 'http://127.0.0.1:3132', cms = 'http://127.0.0.1:3130';
  expect(env!.BLOK_URL).toBe(cms);
  const headers = { Origin:cms,'x-blok-space-id':env!.BLOK_SPACE_ID! };
  const errors:string[] = [];
  const visitor = await context.newPage();
  visitor.on('pageerror',error => errors.push(error.message));
  page.on('pageerror',error => errors.push(error.message));
  // The test runs against astro preview's built files, never the development server.
  const built = readFileSync('apps/example-astro/dist/home/index.html','utf8');
  const files = readdirSync('apps/example-astro/dist',{ recursive:true }).filter((path):path is string => typeof path === 'string' && /\.(html|js)$/.test(path));
  for (const file of files) {
    const text = readFileSync(`apps/example-astro/dist/${file}`,'utf8');
    expect(text).not.toContain(env!.BLOK_PREVIEW_TOKEN);
    expect(text).not.toContain(env!.BLOK_DELIVERY_TOKEN);
  }
  await visitor.goto(`${site}/home`);
  const publishedTitle = await visitor.getByRole('heading',{ level:1 }).innerText();
  expect(built).toContain(publishedTitle);
  await expect(visitor.getByRole('status')).toHaveCount(0);
  await visitor.screenshot({ path:'/tmp/blok-astro-desktop.png',fullPage:true });
  await visitor.setViewportSize({ width:390,height:844 });
  await expect.poll(() => visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await visitor.screenshot({ path:'/tmp/blok-astro-mobile.png',fullPage:true });
  await visitor.setViewportSize({ width:1440,height:1000 });
  await signInPage(page);
  const stories = await (await page.request.get('/api/cms/stories',{ headers })).json() as Story[];
  const home = stories.find(story => story.slug === 'home')!;
  const locales = await (await page.request.get(`/api/cms/stories/${home.id}/locales`,{ headers })).json() as StoryLocale[];
  const locale = locales.find(locale => locale.slug === '')!;
  const base = `/api/cms/stories/${home.id}/locales/${locale.id}`;
  const original = await (await page.request.get(base,{ headers })).json() as LocaleSnapshot;
  const hero = original.blocks.find(block => original.definitions.find(definition => definition.versionId === block.schemaVersionId)?.name === 'hero')!;
  const settings = await (await page.request.get('/api/cms/delivery-settings',{ headers })).json() as DeliverySettings;
  let changed = false;
  try {
    // Exercise the actual statically built page inside the editor, not just the shell.
    const saved = await page.request.put('/api/cms/delivery-settings',{ headers,data:{ ...settings,previewUrl:`${site}/{locale}/{slug}` } });
    expect(saved.ok()).toBe(true);
    await page.goto(`/?space=${env!.BLOK_SPACE_ID}`);
    await page.getByRole('button',{ name:'Home',exact:true }).click();
    await page.getByRole('button',{ name:'Preview',exact:true }).click();
    const frame = page.frameLocator('iframe[title="Live application preview"]');
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    const outline = page.getByRole('complementary',{ name:'Block outline' });
    await outline.getByRole('button',{ name:'Hero',exact:true }).click();
    changed = true;
    const title = `Live Astro draft ${Date.now()}`;
    await page.getByRole('textbox',{ name:/^Title/ }).fill(title);
    await expect(frame.getByRole('heading',{ level:1 })).toHaveText(title);
    await expect(frame.locator(`[data-blok-id="${hero.id}"]`)).toHaveAttribute('data-blok-selected','');
    await frame.locator('article[data-blok-id]').first().click();
    await expect(page.getByRole('heading',{ name:'Feature',exact:true })).toBeVisible();
    await expect(page.getByLabel('Category',{ exact:true })).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole('heading',{ level:1 })).toHaveText(publishedTitle);
    expect(readFileSync('apps/example-astro/dist/home/index.html','utf8')).toBe(built);
    await visitor.goto(`${site}/fr/home`);
    await expect(visitor.getByRole('heading',{ level:1 })).toHaveText('Faites place à la suite.');
    // The shell can preview a story that has never been published or built.
    await page.request.put('/api/cms/delivery-settings',{ headers,data:{ ...settings,previewUrl:`${site}/preview?slug={slug}&locale={locale}` } });
    await page.goto(`/?space=${env!.BLOK_SPACE_ID}`);
    await page.getByRole('button',{ name:'Work in progress',exact:true }).click();
    await page.getByRole('button',{ name:'Preview',exact:true }).click();
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect(frame.getByRole('heading',{ level:1 })).toHaveText('Make room for what’s next.');
    expect((await visitor.request.get(`${site}/work-in-progress`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    // Restore the example's original draft and preview settings; never publish test edits.
    await page.goto(`/?space=${env!.BLOK_SPACE_ID}`);
    if (changed) {
      const current = await (await page.request.get(base,{ headers })).json() as LocaleSnapshot;
      const block = current.blocks.find(block => block.id === hero.id)!;
      const grant = await page.request.post(`${base}/leases`,{ headers,data:{ blockId:hero.id } });
      expect(grant.ok()).toBe(true);
      const lease = await grant.json() as Lease;
      const restored = await page.request.post(`${base}/commands`,{ headers,data:{ type:'saveBlock',mutationId:crypto.randomUUID(),expectedRevisions:{ [hero.id]:block.revision },leaseTokens:{ [hero.id]:lease.token },payload:{ blockId:hero.id,fields:hero.fields } } });
      expect(restored.ok()).toBe(true);
      await page.request.delete(`${base}/leases`,{ headers,data:{ blockId:hero.id,token:lease.token } });
    }
    await page.request.put('/api/cms/delivery-settings',{ headers,data:settings });
    await visitor.close();
  }
});
