import { expect,test } from '@playwright/test';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { DeliverySettings,Lease,LocaleSnapshot,Story,StoryLocale } from '@storypane/core';
import { signInPage } from './auth';

const env = existsSync('apps/example-astro/.env') ? parseEnv(readFileSync('apps/example-astro/.env','utf8')) : undefined;
if (env) for (const name of ['URL','SPACE_ID','PREVIEW_TOKEN','DELIVERY_TOKEN']) env[`STORYPANE_${name}`] ??= env[`BLOK_${name}`]!;
test('Astro serves built publications and locales, hydrates drafts, selects nested blocks, and previews unpublished stories',async ({ page,context }) => {
  test.skip(!env,'Run pnpm example:setup and pnpm build:example to enable the Astro integration test.');
  test.setTimeout(90000);
  const site = 'http://127.0.0.1:3132', cms = 'http://127.0.0.1:3130';
  expect(env!.STORYPANE_URL).toBe(cms);
  const headers = { Origin:cms,'x-blok-space-id':env!.STORYPANE_SPACE_ID! };
  const errors:string[] = [];
  const visitor = await context.newPage();
  visitor.on('pageerror',error => errors.push(error.message));
  page.on('pageerror',error => errors.push(error.message));
  // The test runs against astro preview's built files, never the development server.
  const built = readFileSync('apps/example-astro/dist/home/index.html','utf8');
  const files = readdirSync('apps/example-astro/dist',{ recursive:true }).filter((path):path is string => typeof path === 'string' && /\.(html|js)$/.test(path));
  for (const file of files) {
    const text = readFileSync(`apps/example-astro/dist/${file}`,'utf8');
    expect(text).not.toContain(env!.STORYPANE_PREVIEW_TOKEN);
    expect(text).not.toContain(env!.STORYPANE_DELIVERY_TOKEN);
  }
  await visitor.goto(`${site}/home`);
  const publishedTitle = await visitor.getByRole('heading',{ level:1 }).innerText();
  expect(built).toContain(publishedTitle);
  await expect(visitor.getByRole('status')).toHaveCount(0);
  await visitor.screenshot({ path:'/tmp/storypane-astro-desktop.png',fullPage:true });
  await visitor.setViewportSize({ width:390,height:844 });
  await expect.poll(() => visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await visitor.screenshot({ path:'/tmp/storypane-astro-mobile.png',fullPage:true });
  await visitor.setViewportSize({ width:1440,height:1000 });
  await page.setViewportSize({ width:1600,height:1100 });
  await signInPage(page);
  const stories = await (await page.request.get('/api/cms/stories',{ headers })).json() as Story[];
  const home = stories.find(story => story.slug === 'home')!;
  const locales = await (await page.request.get(`/api/cms/stories/${home.id}/locales`,{ headers })).json() as StoryLocale[];
  const locale = locales.find(locale => locale.slug === '')!;
  const base = `/api/cms/stories/${home.id}/locales/${locale.id}`;
  const original = await (await page.request.get(base,{ headers })).json() as LocaleSnapshot;
  test.skip(original.leases.length > 0, 'An editor is actively working in the example story; do not compete for its leases.');
  const hero = original.blocks.find(block => original.definitions.find(definition => definition.versionId === block.schemaVersionId)?.name === 'hero')!;
  const settings = await (await page.request.get('/api/cms/delivery-settings',{ headers })).json() as DeliverySettings;
  const previewId = settings.defaultPreviewId ?? crypto.randomUUID();
  const previewSettings = (url:string) => ({ ...settings,defaultPreviewId:previewId,previewUrls:settings.previewUrls.length ? settings.previewUrls.map(item => item.id === previewId ? { ...item,url } : item) : [{ id:previewId,name:'Astro',url }] });
  let changed = false;
  try {
    // Exercise the actual statically built page inside the editor, not just the shell.
    const saved = await page.request.put('/api/cms/delivery-settings',{ headers,data:previewSettings(`${site}/{locale}/{slug}`) });
    expect(saved.ok()).toBe(true);
    await page.goto(`/?space=${env!.STORYPANE_SPACE_ID}`);
    await page.getByRole('button',{ name:'Home',exact:true }).click();
    await expect(page.getByRole('button',{ name:'Hide preview',exact:true })).toBeVisible();
    const frame = page.frameLocator('iframe[title="Live application preview"]');
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await page.screenshot({ path:'/tmp/storypane-editor-desktop.png',fullPage:true });
    await page.getByRole('region',{ name:'Block editor' }).getByRole('button',{ name:'Hero',exact:true }).click();
    const title = `Live Astro draft ${Date.now()}`;
    await page.getByRole('textbox',{ name:/^Title/ }).fill(title);
    changed = true;
    await expect(frame.getByRole('heading',{ level:1 })).toHaveText(title);
    await expect(frame.locator(`[data-blok-id="${hero.id}"]`)).toHaveAttribute('data-blok-selected','');
    await frame.locator('article[data-blok-id]').first().click();
    await expect(page.getByRole('heading',{ name:'Feature',exact:true })).toBeVisible();
    await expect(page.getByLabel('Category',{ exact:true })).toBeVisible();
    const path = page.getByRole('navigation',{ name:'Block path' });
    await expect(path.locator('.block-path-link')).toHaveText(['Page','Feature grid','Feature']);
    await path.getByRole('button',{ name:/Browse .* blocks in Feature grid/ }).click();
    const siblings = path.getByRole('group');
    await expect(siblings.getByRole('button')).toHaveCount(3);
    const featureTitles = original.blocks.filter(block => original.definitions.find(definition => definition.versionId === block.schemaVersionId)?.name === 'feature').sort((a,b) => a.position-b.position).map(block => String(block.fields.title));
    await expect(siblings.locator('small')).toHaveText(featureTitles);
    await page.screenshot({ path:'/tmp/storypane-editor-breadcrumbs.png',fullPage:true });
    await siblings.getByRole('button').nth(1).click();
    await expect(page.getByRole('textbox',{ name:'Title',exact:true })).toHaveValue(featureTitles[1]!);
    await page.setViewportSize({ width:390,height:844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path:'/tmp/storypane-editor-nested-mobile.png',fullPage:true });
    await page.setViewportSize({ width:1600,height:1100 });
    await path.getByRole('button',{ name:'Feature grid',exact:true }).click();
    await expect(page.getByRole('region',{ name:'Block editor' }).locator('.block-list-item')).toHaveCount(3);
    const french = locales.find(locale => locale.slug === 'fr')!;
    const frenchSnapshot = await (await page.request.get(`/api/cms/stories/${home.id}/locales/${french.id}`,{ headers })).json() as LocaleSnapshot;
    const frenchHero = frenchSnapshot.blocks.find(block => frenchSnapshot.definitions.find(definition => definition.versionId === block.schemaVersionId)?.name === 'hero')!;
    await page.getByRole('tab',{ name:`${french.name} ${french.slug}`,exact:true }).click();
    await expect(page.getByRole('button',{ name:'Hide preview',exact:true })).toBeVisible();
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect(frame.getByRole('heading',{ level:1 })).toHaveText(String(frenchHero.fields.title));
    expect(new URL(page.url()).searchParams.get('locale')).toBe('fr');
    await page.getByRole('tab',{ name:'Default',exact:true }).click();
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect(frame.getByRole('heading',{ level:1 })).toHaveText(title);

    await visitor.reload();
    await expect(visitor.getByRole('heading',{ level:1 })).toHaveText(publishedTitle);
    expect(readFileSync('apps/example-astro/dist/home/index.html','utf8')).toBe(built);
    await visitor.goto(`${site}/fr/home`);
    await expect(visitor.getByRole('heading',{ level:1 })).toHaveText('Faites place à la suite.');
    // The shell can preview a story that has never been published or built.
    await page.request.put('/api/cms/delivery-settings',{ headers,data:previewSettings(`${site}/preview?slug={slug}&locale={locale}`) });
    await page.goto(`/?space=${env!.STORYPANE_SPACE_ID}`);
    await page.getByRole('button',{ name:'Work in progress',exact:true }).click();
    await expect(page.getByRole('button',{ name:'Hide preview',exact:true })).toBeVisible();
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect(frame.getByRole('heading',{ level:1 })).toHaveText('Make room for what’s next.');
    expect((await visitor.request.get(`${site}/work-in-progress`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    // Restore the example's original draft and preview settings; never publish test edits.
    await page.goto(`/?space=${env!.STORYPANE_SPACE_ID}`);
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
