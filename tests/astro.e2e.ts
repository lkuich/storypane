import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import type {
  DeliverySettings,
  UserDeliverySettings,
  Lease,
  LocaleSnapshot,
  Story,
  StoryLocale,
} from '@storypane/core';
import type { PreviewSession, StorypaneStory } from '../packages/sdk/src/types';
import type { StorypaneContentType } from '../apps/example-astro/src/types/storypane';
import { signInPage } from './auth';

const env = existsSync('apps/example-astro/.env')
  ? parseEnv(readFileSync('apps/example-astro/.env', 'utf8'))
  : undefined;

test('Astro publication and preview contract', async ({ page, context }) => {
  test.skip(
    !env,
    'Run pnpm --filter @storypane/example-astro setup and pnpm --filter @storypane/example-astro build first.',
  );
  test.setTimeout(90000);
  const cms = env!.STORYPANE_URL!,
    spaceId = env!.STORYPANE_SPACE_ID!,
    site = 'http://127.0.0.1:3132';
  expect(cms).toBe('http://127.0.0.1:3130');
  expect(env!.STORYPANE_PREVIEW_TOKEN).toBeTruthy();
  const database =
    process.env.DATABASE_URL ?? 'postgresql://storypane:storypane@127.0.0.1:55432/storypane';
  expect(['localhost', '127.0.0.1']).toContain(new URL(database).hostname);
  const pool = new Pool({ connectionString: database });
  const settings: DeliverySettings = await pool
    .query('SELECT preview_urls AS "previewUrls" FROM spaces WHERE id=$1', [spaceId])
    .then((result) => result.rows[0])
    .finally(() => pool.end());
  const target = settings.previewUrls.find((target) => new URL(target.url).origin === site)!;
  expect(target).toBeTruthy();
  expect(new URL(target.url).pathname).toBe('/preview');

  const errors: string[] = [],
    sockets: { closed: boolean }[] = [],
    payloads: StorypaneStory<StorypaneContentType>[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/api/preview/live') return;
    const state = { closed: false };
    sockets.push(state);
    socket.on('close', () => {
      state.closed = true;
    });
    socket.on('framereceived', (event) => {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'content') payloads.push(message.story);
    });
  });
  await page.goto(`${site}/home?storypane_preview=1`);
  const title = await page.getByRole('heading', { level: 1 }).innerText();
  const built = readFileSync('apps/example-astro/dist/home/index.html', 'utf8');
  expect(built).toContain(title);
  expect(built).not.toContain('<astro-island');
  await expect(page.locator('astro-island')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(sockets).toHaveLength(0);
  for (const image of await page.locator('.hero-image').all()) {
    await expect
      .poll(() =>
        image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await expect(page.locator('.hero-art[aria-hidden]')).toBeHidden();
    await image.evaluate((image: HTMLImageElement) => {
      image.src = '/media/missing-image';
    });
    await expect(image).toBeHidden();
    await expect(page.locator('.hero-art[aria-hidden]')).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.goto(`${site}/fr/home`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Faites place à la suite.');
  expect((await page.request.get(`${site}/work-in-progress`)).status()).toBe(404);
  await page.goto(`${site}/preview?slug=work-in-progress`);
  await expect(page.getByRole('status')).toContainText('Open a story in Storypane');
  await expect(page.locator('[data-storypane-id]')).toHaveCount(0);

  await context.grantPermissions(['local-network-access'], { origin: cms });
  const sessions: PreviewSession[] = [];
  for (const [slug, locale] of [
    ['home', ''],
    ['home', 'fr'],
    ['work-in-progress', ''],
  ]) {
    const response = await page.request.post(`${cms}/api/delivery/preview?space=${spaceId}`, {
      headers: { Authorization: `Bearer ${env!.STORYPANE_PREVIEW_TOKEN}` },
      data: { slug, locale, previewId: target.id },
    });
    expect(response.ok()).toBe(true);
    sessions.push(await response.json());
  }
  const parentUrl = `${cms}/__astro-example-test`;
  await page.route(parentUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><iframe title="Preview" src="${site}/preview?slug=home" style="width:100%;height:95vh;border:0"></iframe><script>
      const sessions=${JSON.stringify(sessions)};
      window.addEventListener('message', event => {
        const frame=document.querySelector('iframe');
        if(event.origin!==${JSON.stringify(site)} || event.source!==frame.contentWindow) return;
        if(event.data?.type==='storypane:ready') {
          const session=sessions.find(s => s.slug===event.data.slug && s.locale===event.data.locale);
          if(session) event.source.postMessage({type:'storypane:init',session},event.origin);
        }
        if(event.data?.type==='storypane:click') document.body.dataset.selected=event.data.blockId;
      });
    </script></body></html>`,
    }),
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(parentUrl);
  const frame = page.frameLocator('iframe'),
    previewFrame = page.frames().find((frame) => frame.url().startsWith(`${site}/preview`))!;
  for (const [index, [slug, locale]] of [
    ['home', ''],
    ['home', 'fr'],
    ['work-in-progress', ''],
  ].entries()) {
    if (index) {
      const previous = sockets.at(-1)!;
      await previewFrame.evaluate(
        ({ slug, locale }) => {
          window.history.pushState(null, '', `/preview?slug=${slug}&locale=${locale}`);
        },
        { slug, locale },
      );
      await expect.poll(() => previous.closed).toBe(true);
    }
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect.poll(() => payloads.at(-1)?.slug).toBe(slug);
    await expect.poll(() => payloads.at(-1)?.locale).toBe(locale);
    const story = payloads.at(-1)!;
    await expect(frame.locator(`div[lang="${locale || 'en'}"]`)).toBeVisible();
    if (story.content.component === 'page') {
      const hero = story.content.body.find((block) => block.component === 'hero');
      if (hero?.component === 'hero')
        await expect(frame.getByRole('heading', { level: 1 })).toHaveText(hero.title);
      const footerId = story.content.footer,
        footer = story.references?.find((item) => item.id === footerId);
      if (footer?.content.component === 'footer') {
        await expect(frame.locator('.site-footer')).toContainText(String(footer.content.text));
        await expect(frame.locator('.footer-credit')).toContainText('Astro');
      }
    }
    const block = frame.locator('[data-storypane-id]').last(),
      blockId = await block.getAttribute('data-storypane-id');
    await block.click();
    await expect(page.locator('body')).toHaveAttribute('data-selected', blockId!);
    await expect(block).toHaveAttribute('data-storypane-selected', '');
  }
  await previewFrame.evaluate(() => window.history.replaceState(null, '', '/preview'));
  await expect(frame.locator('[data-storypane-id]')).toHaveCount(0);
  await expect(frame.getByRole('status')).toContainText('Open a story in Storypane');
  await expect.poll(() => sockets.every((socket) => socket.closed)).toBe(true);
  await previewFrame.evaluate(() => window.history.back());
  await expect(frame.getByRole('status')).toHaveText('Live preview');
  await expect(frame.locator('[lang="fr"]')).toBeVisible();
  await previewFrame.evaluate(() => window.history.pushState(null, '', '/preview'));
  await expect(frame.locator('[data-storypane-id]')).toHaveCount(0);
  await expect.poll(() => sockets.every((socket) => socket.closed)).toBe(true);

  for (const file of readdirSync('apps/example-astro/dist', { recursive: true })) {
    if (typeof file !== 'string' || !/\.(js|html)$/.test(file)) continue;
    const text = readFileSync(`apps/example-astro/dist/${file}`, 'utf8');
    for (const name of ['STORYPANE_DELIVERY_TOKEN', 'STORYPANE_PREVIEW_TOKEN'])
      if (env![name]) expect(text.includes(env![name])).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('Astro editor integration updates drafts, selects nested blocks, and previews unpublished stories', async ({
  page,
  context,
}) => {
  test.skip(
    !env,
    'Run pnpm --filter @storypane/example-astro setup and pnpm --filter @storypane/example-astro build to enable the Astro integration test.',
  );
  test.setTimeout(90000);
  const site = 'http://127.0.0.1:3132',
    cms = 'http://127.0.0.1:3130';
  expect(env!.STORYPANE_URL).toBe(cms);
  const headers = { Origin: cms, 'x-storypane-space-id': env!.STORYPANE_SPACE_ID! };
  const errors: string[] = [];
  const visitor = await context.newPage();
  visitor.on('pageerror', (error) => errors.push(error.message));
  page.on('pageerror', (error) => errors.push(error.message));
  // The test runs against astro preview's built files, never the development server.
  const built = readFileSync('apps/example-astro/dist/home/index.html', 'utf8');
  const files = readdirSync('apps/example-astro/dist', { recursive: true }).filter(
    (path): path is string => typeof path === 'string' && /\.(html|js)$/.test(path),
  );
  for (const file of files) {
    const text = readFileSync(`apps/example-astro/dist/${file}`, 'utf8');
    expect(text).not.toContain(env!.STORYPANE_PREVIEW_TOKEN);
    expect(text).not.toContain(env!.STORYPANE_DELIVERY_TOKEN);
  }
  await visitor.goto(`${site}/home`);
  const publishedTitle = await visitor.getByRole('heading', { level: 1 }).innerText();
  expect(built).toContain(publishedTitle);
  await expect(visitor.getByRole('status')).toHaveCount(0);
  await visitor.screenshot({ path: '/tmp/storypane-astro-desktop.png', fullPage: true });
  await visitor.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await visitor.screenshot({ path: '/tmp/storypane-astro-mobile.png', fullPage: true });
  await visitor.setViewportSize({ width: 1440, height: 1000 });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await signInPage(page);
  const stories = (await (
    await page.request.get('/api/cms/stories', { headers })
  ).json()) as Story[];
  const home = stories.find((story) => story.slug === 'home')!;
  const locales = (await (
    await page.request.get(`/api/cms/stories/${home.id}/locales`, { headers })
  ).json()) as StoryLocale[];
  const locale = locales.find((locale) => locale.slug === '')!;
  const base = `/api/cms/stories/${home.id}/locales/${locale.id}`;
  const original = (await (await page.request.get(base, { headers })).json()) as LocaleSnapshot;
  test.skip(
    original.leases.length > 0,
    'An editor is actively working in the example story; do not compete for its leases.',
  );
  const hero = original.blocks.find(
    (block) =>
      original.definitions.find((definition) => definition.versionId === block.schemaVersionId)
        ?.name === 'hero',
  )!;
  const { personalDefaultPreviewId, ...settings } = (await (
    await page.request.get('/api/cms/delivery-settings', { headers })
  ).json()) as UserDeliverySettings;
  const previewId = personalDefaultPreviewId ?? settings.defaultPreviewId ?? crypto.randomUUID();
  const previewSettings = (url: string) => ({
    ...settings,
    defaultPreviewId: previewId,
    previewUrls: settings.previewUrls.length
      ? settings.previewUrls.map((item) => (item.id === previewId ? { ...item, url } : item))
      : [{ id: previewId, name: 'Astro', url }],
  });
  let changed = false;
  try {
    // Draft subscriptions live exclusively on the dedicated preview route.
    const saved = await page.request.put('/api/cms/delivery-settings', {
      headers,
      data: previewSettings(`${site}/preview?slug={slug}&locale={locale}`),
    });
    expect(saved.ok()).toBe(true);
    await page.goto(`/?space=${env!.STORYPANE_SPACE_ID}`);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide preview', exact: true })).toBeVisible();
    const frame = page.frameLocator('iframe[title="Live application preview"]');
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await page.screenshot({ path: '/tmp/storypane-editor-desktop.png', fullPage: true });
    await page
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Hero', exact: true })
      .click();
    const title = `Live Astro draft ${Date.now()}`;
    await page.getByRole('textbox', { name: /^Title/ }).fill(title);
    changed = true;
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(frame.locator(`[data-storypane-id="${hero.id}"]`)).toHaveAttribute(
      'data-storypane-selected',
      '',
    );
    await frame.locator('article[data-storypane-id]').first().click();
    await expect(page.getByRole('heading', { name: 'Feature', exact: true })).toBeVisible();
    await expect(page.getByLabel('Category', { exact: true })).toBeVisible();
    const path = page.getByRole('navigation', { name: 'Block path' });
    await expect(path.locator('.block-path-link')).toHaveText(['Page', 'Feature grid', 'Feature']);
    await path.getByRole('button', { name: /Browse .* blocks in Feature grid/ }).click();
    const siblings = path.getByRole('group');
    await expect(siblings.getByRole('button')).toHaveCount(3);
    const featureTitles = original.blocks
      .filter(
        (block) =>
          original.definitions.find((definition) => definition.versionId === block.schemaVersionId)
            ?.name === 'feature',
      )
      .sort((a, b) => a.position - b.position)
      .map((block) => String(block.fields.title));
    await expect(siblings.locator('small')).toHaveText(featureTitles);
    await page.screenshot({ path: '/tmp/storypane-editor-breadcrumbs.png', fullPage: true });
    await siblings.getByRole('button').nth(1).click();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      featureTitles[1]!,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: '/tmp/storypane-editor-nested-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await path.getByRole('button', { name: 'Feature grid', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Block editor' }).locator('.block-list-item'),
    ).toHaveCount(3);
    const french = locales.find((locale) => locale.slug === 'fr')!;
    const frenchSnapshot = (await (
      await page.request.get(`/api/cms/stories/${home.id}/locales/${french.id}`, { headers })
    ).json()) as LocaleSnapshot;
    const frenchHero = frenchSnapshot.blocks.find(
      (block) =>
        frenchSnapshot.definitions.find(
          (definition) => definition.versionId === block.schemaVersionId,
        )?.name === 'hero',
    )!;
    await page.getByRole('tab', { name: `${french.name} ${french.slug}`, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide preview', exact: true })).toBeVisible();
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(
      String(frenchHero.fields.title),
    );
    expect(new URL(page.url()).searchParams.get('locale')).toBe('fr');
    await page.getByRole('tab', { name: 'Default', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText(title);

    await visitor.reload();
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(publishedTitle);
    expect(readFileSync('apps/example-astro/dist/home/index.html', 'utf8')).toBe(built);
    await visitor.goto(`${site}/fr/home`);
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Faites place à la suite.');
    // The shell can preview a story that has never been published or built.
    await page.goto(`/?space=${env!.STORYPANE_SPACE_ID}`);
    await page.getByRole('button', { name: 'Work in progress', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide preview', exact: true })).toBeVisible();
    await expect(frame.getByRole('status')).toHaveText('Live preview');
    await expect(frame.getByRole('heading', { level: 1 })).toHaveText('Make room for what’s next.');
    expect((await visitor.request.get(`${site}/work-in-progress`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    // Restore the example's original draft and preview settings; never publish test edits.
    await page.goto(`/?space=${env!.STORYPANE_SPACE_ID}`);
    if (changed) {
      const current = (await (await page.request.get(base, { headers })).json()) as LocaleSnapshot;
      const block = current.blocks.find((block) => block.id === hero.id)!;
      const grant = await page.request.post(`${base}/leases`, {
        headers,
        data: { blockId: hero.id },
      });
      expect(grant.ok()).toBe(true);
      const lease = (await grant.json()) as Lease;
      const restored = await page.request.post(`${base}/commands`, {
        headers,
        data: {
          type: 'saveBlock',
          mutationId: crypto.randomUUID(),
          expectedRevisions: { [hero.id]: block.revision },
          leaseTokens: { [hero.id]: lease.token },
          payload: { blockId: hero.id, fields: hero.fields },
        },
      });
      expect(restored.ok()).toBe(true);
      await page.request.delete(`${base}/leases`, {
        headers,
        data: { blockId: hero.id, token: lease.token },
      });
    }
    await page.request.put('/api/cms/delivery-settings', { headers, data: settings });
    await visitor.close();
  }
});
