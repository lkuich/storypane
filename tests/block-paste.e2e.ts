import { expect, test } from '@playwright/test';
import type {
  BlockDefinition,
  CommitResult,
  Lease,
  LocaleSnapshot,
  SchemaMigration,
} from '@storypane/core';
import { signInPage } from './auth';
import { Pool } from 'pg';
import { getInstallation } from '@storypane/db/installation';

test.use({ actionTimeout: 10000 });

test('inserts and pastes between siblings and clears the clipboard, including the manual fallback', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  const installation = getInstallation();
  const provisioningURL = installation.options.provisioningURL;
  if (!provisioningURL || !['localhost', '127.0.0.1'].includes(new URL(provisioningURL).hostname))
    throw new Error('Clipboard tests require disposable local database provisioning');
  const spaceId = crypto.randomUUID();
  const origin = 'http://127.0.0.1:3130';
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await signInPage(page);
    const created = await page.request.post('/api/spaces', {
      headers: { Origin: origin },
      data: { id: spaceId, name: `Block paste ${spaceId.slice(0, 8)}`, mode: 'create' },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const space = await created.json();
    const headers = { Origin: origin, 'x-storypane-space-id': space.id };
    async function authenticatedHeaders() {
      const token = await page.evaluate(() =>
        (
          window as typeof window & {
            Clerk?: {
              session?: { getToken: (options: { skipCache: boolean }) => Promise<string | null> };
            };
          }
        ).Clerk?.session?.getToken({ skipCache: true }),
      );
      return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
    }
    const get = async (path: string) => {
      const response = await page.request.get(`/api/cms${path}`, {
        headers: await authenticatedHeaders(),
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post(`/api/cms${path}`, {
        headers: await authenticatedHeaders(),
        data,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const definitions: BlockDefinition[] = [];
    for (const name of ['page', 'hero', 'footer']) {
      definitions.push(
        await post('/definitions', {
          baseVersion: 0,
          schema: {
            name,
            displayName: name[0].toUpperCase() + name.slice(1),
            kind: name === 'page' ? 'content-type' : 'nestable',
            fields:
              name === 'page'
                ? [{ name: 'body', label: 'Body', type: 'blocks', maxItems: 5 }]
                : [{ name: 'title', label: 'Title', type: 'text', format: 'singleline' }],
          },
        }),
      );
    }
    const migrations: SchemaMigration[] = await get('/migrations?workspace=true');
    const active = migrations.find((item) => item.status === 'active')!;
    const review = await get(`/migrations/${active.id}/review`);
    await post(`/migrations/${active.id}/deploy`, { reviewToken: review.token });
    const story = await post('/stories', {
      name: 'Clipboard test',
      slug: 'clipboard-test',
      definitionId: definitions[0].id,
    });
    const [locale] = await get(`/stories/${story.id}/locales`);
    const base = `/stories/${story.id}/locales/${locale.id}`;
    let snapshot: LocaleSnapshot = await get(base);
    const root = snapshot.locale.rootBlockId;
    const lease: Lease = await post(`${base}/leases`, { blockId: root });
    for (const definition of definitions.slice(1)) {
      const result: CommitResult = await post(`${base}/commands`, {
        type: 'insertBlock',
        mutationId: crypto.randomUUID(),
        expectedRevisions: { [root]: snapshot.blocks.find((block) => block.id === root)!.revision },
        leaseTokens: { [root]: lease.token },
        payload: { parentId: root, parentField: 'body', definitionId: definition.id },
      });
      snapshot = result.snapshot;
    }
    expect(
      (
        await page.request.delete(`/api/cms${base}/leases`, {
          headers,
          data: { blockId: root, token: lease.token },
        })
      ).ok(),
    ).toBe(true);
    const original = snapshot.blocks
      .filter((block) => block.parentId === root)
      .sort((a, b) => a.position - b.position);
    await page.evaluate(() => navigator.clipboard.writeText('Ordinary copied text'));
    await page.goto(`/?space=${space.id}&story=${story.id}`);
    const editor = page.getByRole('region', { name: 'Block editor' });
    await expect(editor.getByRole('button', { name: 'Add block', exact: true })).toBeEnabled({
      timeout: 20000,
    });
    const pasteButtons = editor.getByRole('button', { name: /^Paste block/ });
    await expect(pasteButtons).toHaveCount(0);
    const addRow = editor.locator('.block-list-add');
    const picker = page.getByRole('dialog', { name: 'Add a block', exact: true });
    await addRow.click({ position: { x: 4, y: 4 } });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const rowBounds = (await addRow.boundingBox())!;
    await addRow.click({ position: { x: rowBounds.width - 4, y: rowBounds.height - 4 } });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.getByRole('button', { name: 'Add block', exact: true }).focus();
    await page.screenshot({ path: testInfo.outputPath('add-row-mobile-focus.png') });
    await page.keyboard.press('Enter');
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const addBetween = editor.getByRole('button', { name: 'Add block before Footer', exact: true });
    await addBetween.locator('..').hover();
    await expect(addBetween).toHaveCSS('opacity', '1');
    await addBetween.focus();
    await page.keyboard.press('Enter');
    await picker.getByRole('button', { name: 'Add Hero', exact: true }).click();
    await expect(picker).not.toBeVisible();
    const inserted: LocaleSnapshot = await get(base);
    const beforePaste = inserted.blocks
      .filter((block) => block.parentId === root)
      .sort((a, b) => a.position - b.position);
    expect(beforePaste.map((block) => block.definitionId)).toEqual([
      definitions[1].id,
      definitions[1].id,
      definitions[2].id,
    ]);
    expect(beforePaste[0].id).toBe(original[0].id);
    expect(beforePaste[2].id).toBe(original[1].id);
    expect(beforePaste[1].id).not.toBe(original[0].id);
    const copy = editor.getByRole('button', { name: 'Copy Hero', exact: true }).first();
    await copy.click();
    await expect(pasteButtons).toHaveCount(4);
    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    await editor.getByRole('button', { name: 'Clear clipboard', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('');
    await expect(pasteButtons).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Clear clipboard', exact: true })).toHaveCount(
      0,
    );
    await page.waitForTimeout(2200);
    await expect(pasteButtons).toHaveCount(0);
    await copy.click();
    await expect(pasteButtons).toHaveCount(4);
    for (const invalid of [
      '',
      '{"type":"storypane/block"}',
      JSON.stringify({ ...JSON.parse(copiedText), spaceId: crypto.randomUUID() }),
      JSON.stringify({ ...JSON.parse(copiedText), migrationVersion: 0 }),
    ]) {
      await page.evaluate((text) => navigator.clipboard.writeText(text), invalid);
      await expect(pasteButtons).toHaveCount(0);
      await copy.click();
      await expect(pasteButtons).toHaveCount(4);
    }
    await page
      .getByRole('button', { name: 'Copy page id for Clipboard test', exact: true })
      .click();
    await expect(pasteButtons).toHaveCount(0);
    await copy.click();
    const between = editor.getByRole('button', { name: 'Paste block before Footer', exact: true });
    await between.focus();
    await between.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('paste-between-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await between.focus();
    await between.scrollIntoViewIfNeeded();
    await expect
      .poll(() => editor.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('paste-between-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await between.focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByLabel('Title', { exact: true })).toBeEditable();
    const pasted: LocaleSnapshot = await get(base);
    const children = pasted.blocks
      .filter((block) => block.parentId === root)
      .sort((a, b) => a.position - b.position);
    expect(children.map((block) => block.definitionId)).toEqual([
      definitions[1].id,
      definitions[1].id,
      definitions[1].id,
      definitions[2].id,
    ]);
    expect(children[0].id).toBe(original[0].id);
    expect(children[1].id).toBe(beforePaste[1].id);
    expect(children[3].id).toBe(original[1].id);
    expect(beforePaste.some((block) => block.id === children[2].id)).toBe(false);
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Page', exact: true })
      .click();
    await expect(between).toBeEnabled();
    await page.evaluate(() => {
      Object.defineProperty(navigator.permissions, 'query', {
        configurable: true,
        value: async () => ({ state: 'prompt' }),
      });
      Object.defineProperty(navigator.clipboard, 'readText', {
        configurable: true,
        value: async () => {
          throw new Error('Clipboard read unavailable');
        },
      });
    });
    await copy.click();
    await between.focus();
    await page.keyboard.press('Enter');
    const fallback = page.getByRole('dialog', { name: 'Paste block into Body', exact: true });
    await fallback.getByLabel('Copied block', { exact: true }).fill(copiedText);
    await fallback.getByRole('button', { name: 'Paste block', exact: true }).click();
    await expect(fallback).not.toBeVisible();
    const after: LocaleSnapshot = await get(base);
    expect(
      after.blocks
        .filter((block) => block.parentId === root)
        .sort((a, b) => a.position - b.position)
        .map((block) => block.definitionId),
    ).toEqual([
      definitions[1].id,
      definitions[1].id,
      definitions[1].id,
      definitions[1].id,
      definitions[2].id,
    ]);
    await page
      .getByRole('navigation', { name: 'Block path' })
      .getByRole('button', { name: 'Page', exact: true })
      .click();
    await expect(addBetween).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'Add block', exact: true })).toBeDisabled();
    await addRow.click({ position: { x: 4, y: 4 }, force: true });
    await expect(picker).not.toBeVisible();
    await expect(pasteButtons).toHaveCount(0);
    await editor.getByRole('button', { name: 'Clear clipboard', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Clear clipboard', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await Promise.all(context.pages().map((current) => current.close()));
    const provisioner = new Pool({ connectionString: provisioningURL });
    try {
      // Remove only the database created for this test's fresh UUID.
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
