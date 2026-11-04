import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { StorypaneStore } from '@storypane/db';
import { signInApi, signInPage, authState } from './auth';
import type {
  Actor,
  LocaleSnapshot,
  Space,
  SpaceLocale,
  Story,
  StoryLocale,
} from '@storypane/core';

const origin = 'http://127.0.0.1:3130';
const defaultSpace = '11111111-1111-4111-8111-111111111111';

test('manage spaces centrally, persist settings, and keep the selected workspace isolated', async ({
  page,
  playwright,
}) => {
  const title = `Space check ${crypto.randomUUID().slice(0, 8)}`;
  const peer = await playwright.request.newContext({
    storageState: authState('editor'),
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  let spaceId: string | undefined;
  try {
    await signInPage(page);
    const [existing] = (await (await page.request.get('/api/cms/stories')).json()) as Story[];
    const [locale] = (await (
      await page.request.get(`/api/cms/stories/${existing!.id}/locales`)
    ).json()) as StoryLocale[];
    await page.getByRole('button', { name: 'All spaces', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create space', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a space' });
    await dialog.getByLabel('Space name', { exact: true }).fill(title);
    await dialog.getByLabel(/^Description/).fill('A separate content workspace');
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/spaces'),
    );
    await dialog.getByRole('button', { name: 'Create space', exact: true }).click();
    const result = await created;
    expect(result.status()).toBe(201);
    spaceId = ((await result.json()) as Space).id;
    await expect(dialog).not.toBeVisible();
    const card = page.getByRole('article', { name: title, exact: true });
    await expect(card).toContainText('0 stories');
    await expect(card).toContainText('1 member');
    await card.getByRole('link', { name: `Open ${title}` }).click();
    await expect(page).toHaveURL(`${origin}/?space=${spaceId}`);
    await expect(page.getByRole('button', { name: existing!.name, exact: true })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    const scope = { 'x-blok-space-id': spaceId };
    expect(await (await page.request.get('/api/cms/stories', { headers: scope })).json()).toEqual(
      [],
    );
    expect(
      await (await page.request.get('/api/cms/definitions', { headers: scope })).json(),
    ).toEqual([]);
    expect(
      (
        await page.request.get(
          `/api/cms/stories/${existing!.id}/locales/${locale!.id}?space=${spaceId}`,
        )
      ).status(),
    ).toBe(404);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Assets', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Your library starts here' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Space settings' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Space members' })).toContainText(
      'admin@blok.local',
    );
    await expect(page.getByRole('table', { name: 'Space members' })).not.toContainText(
      'editor@blok.local',
    );
    await page.getByLabel('Space name', { exact: true }).fill(`${title} updated`);
    await page.getByLabel(/^Description/).fill('Updated project description');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Space name', { exact: true })).toHaveValue(`${title} updated`);
    await expect(page.getByLabel(/^Description/)).toHaveValue('Updated project description');
    await page.getByLabel('Space name', { exact: true }).fill('Unsaved name');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'All spaces', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Space settings' })).toBeVisible();
    await page.getByLabel('Space name', { exact: true }).fill(`${title} updated`);
    await page.getByRole('button', { name: 'All spaces', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search spaces' }).fill(title);
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('article')).toContainText('Updated project description');

    await signInApi(peer, 'editor');
    expect(
      ((await (await peer.get('/api/spaces')).json()) as Space[]).map((space) => space.id),
    ).not.toContain(spaceId);
    expect((await peer.get(`/api/cms/space?space=${spaceId}`)).status()).toBe(403);
    expect(
      (
        await peer.put('/api/cms/space', {
          data: { name: 'Unauthorized' },
          headers: { 'x-blok-space-id': defaultSpace },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post('/api/spaces', {
          headers: { Origin: 'https://untrusted.example' },
          data: { name: 'Rejected' },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await peer.dispose();
    // Only remove the empty workspace created by this test on the local preview database.
    if (spaceId) {
      const db = new Pool({ connectionString: 'postgresql://blok:blok@127.0.0.1:55432/blok' });
      try {
        await db.query(
          'DELETE FROM spaces WHERE id=$1 AND name=ANY($2::text[]) AND NOT EXISTS(SELECT 1 FROM stories WHERE space_id=$1)',
          [spaceId, [title, `${title} updated`]],
        );
      } finally {
        await db.end();
      }
    }
  }
});

test('editors see settings without admin controls', async ({ page }) => {
  await signInPage(page, 'editor');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByLabel('Space name', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save changes' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Add locale', exact: true })).not.toBeVisible();
  expect(
    (
      await page.request.post('/api/cms/locales', {
        headers: { Origin: origin },
        data: { name: 'Unauthorized', slug: 'no' },
      })
    ).status(),
  ).toBe(403);
  await expect(page.getByRole('table', { name: 'Space members' })).toContainText(
    'editor@blok.local',
  );
});

test('space locales appear on stories and rename without replacing their content', async ({
  page,
}) => {
  test.setTimeout(90000);
  const db = new Pool({ connectionString: 'postgresql://blok:blok@127.0.0.1:55432/blok' });
  let spaceId: string | undefined;
  try {
    await signInPage(page);
    const created = await page.request.post('/api/spaces', {
      headers: { Origin: origin },
      data: { name: `Locale check ${crypto.randomUUID()}` },
    });
    expect(created.status()).toBe(201);
    spaceId = (await created.json()).id;
    const session = await (await page.request.get(`/api/session?space=${spaceId}`)).json();
    await new StorypaneStore(db).seed({
      spaceId: spaceId!,
      userId: session.user.id,
      sessionId: session.sessionId,
      role: 'admin',
    } satisfies Actor);
    const headers = { Origin: origin, 'x-blok-space-id': spaceId! };
    await page.goto(`/?space=${spaceId}&view=settings`);
    const section = page.getByRole('region', { name: 'Space locales' });
    await expect(section).toContainText('Empty slug');
    await section.getByRole('button', { name: 'Add locale', exact: true }).click();
    const add = page.getByRole('dialog', { name: 'Add a locale' });
    await add.getByLabel('Locale name', { exact: true }).fill('French');
    await add.getByLabel('Locale slug', { exact: true }).fill('fr');
    await add.getByRole('button', { name: 'Add locale', exact: true }).click();
    await expect(add).not.toBeVisible();
    await page.reload();
    await expect(section.getByRole('row').filter({ hasText: 'French' })).toContainText('/fr');
    const configured = (
      (await (await page.request.get('/api/cms/locales', { headers })).json()) as SpaceLocale[]
    ).find((locale) => locale.slug === 'fr')!;
    await section.getByRole('button', { name: 'Add locale', exact: true }).click();
    await add.getByLabel('Locale name', { exact: true }).fill('Duplicate');
    await add.getByLabel('Locale slug', { exact: true }).fill('fr');
    await add.getByRole('button', { name: 'Add locale', exact: true }).click();
    await expect(add).toContainText('already exists');
    page.once('dialog', (dialog) => dialog.accept());
    await add.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Content', exact: true })
      .click();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('tab', { name: 'French fr', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Block editor' }).locator('.block-list-item'),
    ).toHaveCount(0);
    await page.getByRole('textbox', { name: /^Page title/ }).fill('Bonjour');
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    const [story] = (await (
      await page.request.get('/api/cms/stories', { headers })
    ).json()) as Story[];
    const locale = (
      (await (
        await page.request.get(`/api/cms/stories/${story!.id}/locales`, { headers })
      ).json()) as StoryLocale[]
    ).find((locale) => locale.spaceLocaleId === configured.id)!;
    const base = `/api/cms/stories/${story!.id}/locales/${locale.id}`;
    const before = (await (await page.request.get(base, { headers })).json()) as LocaleSnapshot;
    await page.getByRole('button', { name: 'Manage locales', exact: true }).click();
    await section.getByRole('button', { name: 'Edit French', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit locale' });
    await edit.getByLabel('Locale name', { exact: true }).fill('Français');
    await edit.getByLabel('Locale slug', { exact: true }).fill('fr-CA');
    await edit.getByRole('button', { name: 'Save locale', exact: true }).click();
    await expect(edit).not.toBeVisible();
    await expect(
      section.getByRole('button', { name: 'Remove Français', exact: true }),
    ).toBeDisabled();
    const after = (await (await page.request.get(base, { headers })).json()) as LocaleSnapshot;
    expect(after.blocks).toEqual(before.blocks);
    expect(after.locale).toEqual({ ...before.locale, name: 'Français', slug: 'fr-CA' });
    await page.screenshot({ path: '/tmp/storypane-space-locales.png', fullPage: true });
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Content', exact: true })
      .click();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('tab', { name: 'Français fr-CA', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /^Page title/ })).toHaveValue('Bonjour');
    expect(
      (await (
        await page.request.get(`/api/cms/stories/${story!.id}/locales`, { headers })
      ).json()) as StoryLocale[],
    ).toHaveLength(2);
    await page.getByRole('button', { name: 'Manage locales', exact: true }).click();
    await section.getByRole('button', { name: 'Add locale', exact: true }).click();
    await add.getByLabel('Locale name', { exact: true }).fill('Unused');
    await add.getByLabel('Locale slug', { exact: true }).fill('unused');
    await add.getByRole('button', { name: 'Add locale', exact: true }).click();
    await expect(add).not.toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await section.getByRole('button', { name: 'Remove Unused', exact: true }).click();
    await expect(section.getByRole('row').filter({ hasText: 'Unused' })).toHaveCount(0);
  } finally {
    await page.close();
    if (spaceId) {
      const connection = await db.connect();
      try {
        await connection.query('BEGIN');
        for (const table of ['mutation_receipts', 'publications', 'checkpoints', 'block_drafts'])
          await connection.query(
            `DELETE FROM ${table} WHERE locale_id IN (SELECT l.id FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE s.space_id=$1)`,
            [spaceId],
          );
        await connection.query('DELETE FROM stories WHERE space_id=$1', [spaceId]);
        await connection.query(
          'DELETE FROM definition_versions WHERE definition_id IN (SELECT id FROM definitions WHERE space_id=$1)',
          [spaceId],
        );
        await connection.query('DELETE FROM definitions WHERE space_id=$1', [spaceId]);
        await connection.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        // eslint-disable-next-line no-unsafe-finally -- Cleanup failures must fail the test rather than leave fixtures silently.
        throw error;
      } finally {
        connection.release();
      }
    }
    await db.end();
  }
});
