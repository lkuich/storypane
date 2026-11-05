import { expect, test } from '@playwright/test';
import type {
  BlockDefinition,
  CommitResult,
  Lease,
  LocaleSnapshot,
  SchemaMigration,
} from '@storypane/core';
import { signInPage } from './auth';

test('offers valid clipboard blocks only and pastes between siblings, including the manual fallback', async ({
  page,
  context,
}, testInfo) => {
  const origin = 'http://127.0.0.1:3130';
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await signInPage(page);
  const created = await page.request.post('/api/spaces', {
    headers: { Origin: origin },
    data: { name: `Block paste ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const space = await created.json();
  console.log('Block paste test space:', space.id);
  const headers = { Origin: origin, 'x-storypane-space-id': space.id };
  const get = async (path: string) => {
    const response = await page.request.get(`/api/cms${path}`, { headers });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/cms${path}`, { headers, data });
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
  await expect(editor.getByRole('button', { name: 'Add block', exact: true })).toBeEnabled();
  const pasteButtons = editor.getByRole('button', { name: /^Paste block/ });
  await expect(pasteButtons).toHaveCount(0);
  const copy = editor.getByRole('button', { name: 'Copy Hero', exact: true }).first();
  await copy.click();
  await expect(pasteButtons).toHaveCount(3);
  const copiedText = await page.evaluate(() => navigator.clipboard.readText());
  for (const invalid of [
    '',
    '{"type":"storypane/block"}',
    JSON.stringify({ ...JSON.parse(copiedText), spaceId: crypto.randomUUID() }),
    JSON.stringify({ ...JSON.parse(copiedText), migrationVersion: 0 }),
  ]) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), invalid);
    await expect(pasteButtons).toHaveCount(0);
    await copy.click();
    await expect(pasteButtons).toHaveCount(3);
  }
  await page.getByRole('button', { name: 'Copy page id for Clipboard test', exact: true }).click();
  await expect(pasteButtons).toHaveCount(0);
  await copy.click();
  const between = editor.getByRole('button', { name: 'Paste block before Footer', exact: true });
  await between.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('paste-between-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
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
    definitions[2].id,
  ]);
  expect(children[0].id).toBe(original[0].id);
  expect(children[2].id).toBe(original[1].id);
  expect(children[1].id).not.toBe(original[0].id);
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
  await between.click();
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
  ).toEqual([definitions[1].id, definitions[1].id, definitions[1].id, definitions[2].id]);
});
