import { signInPage, signInApi, authState } from './auth';
import { expect, test, type APIResponse } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  BlockDefinition,
  CommitResult,
  Lease,
  LocaleSnapshot,
  Story,
  StoryLocale,
} from '@storypane/core';

const origin = 'http://127.0.0.1:3130';
const landscape = readFileSync(new URL('./fixtures/landscape.png', import.meta.url));
const apiPath = '/api/cms/assets';
const partBytes = 10 * 1024 * 1024;

async function expectStatus(response: APIResponse, status: number) {
  expect(response.status(), `${response.url()}: ${await response.text()}`).toBe(status);
}

test('R2 multipart upload survives resume and archive, with authenticated range delivery', async ({
  playwright,
}) => {
  const client = await playwright.request.newContext({
    storageState: authState('admin'),
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const otherEditor = await playwright.request.newContext({
    storageState: authState('editor'),
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  let assetId: string | undefined;
  let uploadId: string | undefined;
  let finalized = false;
  try {
    await signInApi(client);
    await signInApi(otherEditor, 'editor');
    await expectStatus(await anonymous.get(apiPath), 401);
    const bytes = Buffer.alloc(partBytes + 4096, 'a');
    bytes.write('Storypane local R2 multipart regression fixture\n');
    bytes.write('last part: resume must preserve these bytes', partBytes);
    const title = `R2 roundtrip ${crypto.randomUUID()}`;
    const unauthorized = await client.post(`${apiPath}/uploads`, {
      headers: { Origin: 'https://untrusted.example' },
      data: { filename: 'fixture.txt', mimeType: 'text/plain', byteSize: bytes.length, title },
    });
    await expectStatus(unauthorized, 403);

    const start = await client.post(`${apiPath}/uploads`, {
      data: { filename: 'fixture.txt', mimeType: 'text/plain', byteSize: bytes.length, title },
    });
    await expectStatus(start, 201);
    const upload = (await start.json()) as { id: string; assetId: string; partBytes: number };
    uploadId = upload.id;
    assetId = upload.assetId;
    expect(upload.partBytes).toBe(partBytes);
    await expectStatus(await otherEditor.get(`${apiPath}/uploads/${upload.id}`), 404);

    const wrongSize = await client.put(`${apiPath}/uploads/${upload.id}/parts/1`, {
      data: bytes.subarray(0, 64),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    await expectStatus(wrongSize, 400);
    const firstPart = await client.put(`${apiPath}/uploads/${upload.id}/parts/1`, {
      data: bytes.subarray(0, partBytes),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    await expectStatus(firstPart, 200);
    expect(((await firstPart.json()) as { etag: string }).etag).toBeTruthy();

    const resume = await client.get(`${apiPath}/uploads/${upload.id}`);
    await expectStatus(resume, 200);
    const state = (await resume.json()) as { parts: Array<{ partNumber: number; etag: string }> };
    expect(state.parts.map((part) => part.partNumber)).toEqual([1]);
    await expectStatus(await client.post(`${apiPath}/uploads/${upload.id}/complete`), 400);

    const lastPart = await client.put(`${apiPath}/uploads/${upload.id}/parts/2`, {
      data: bytes.subarray(partBytes),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    await expectStatus(lastPart, 200);
    const complete = await client.post(`${apiPath}/uploads/${upload.id}/complete`);
    await expectStatus(complete, 200);
    finalized = true;
    const asset = ((await complete.json()) as { asset: { id: string; byteSize: number } }).asset;
    expect(asset.id).toBe(assetId);
    expect(asset.byteSize).toBe(bytes.length);
    const repeated = await client.post(`${apiPath}/uploads/${upload.id}/complete`);
    await expectStatus(repeated, 200);
    expect(((await repeated.json()) as { asset: { id: string } }).asset.id).toBe(asset.id);

    const listed = await client.get(apiPath, { params: { search: title } });
    await expectStatus(listed, 200);
    expect(
      ((await listed.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id),
    ).toEqual([asset.id]);
    const url = `${apiPath}/${asset.id}/content`;
    await expectStatus(await anonymous.get(url), 401);
    const downloaded = await client.get(url);
    expect(downloaded.status()).toBe(200);
    expect(downloaded.headers()['content-type']).toBe('text/plain');
    expect(downloaded.headers()['content-disposition']).toContain('attachment');
    expect(downloaded.headers()['x-content-type-options']).toBe('nosniff');
    expect(
      createHash('sha256')
        .update(await downloaded.body())
        .digest('hex'),
    ).toBe(createHash('sha256').update(bytes).digest('hex'));

    const range = await client.get(url, {
      headers: { Range: `bytes=${partBytes}-${partBytes + 63}` },
    });
    expect(range.status()).toBe(206);
    expect(range.headers()['content-range']).toBe(
      `bytes ${partBytes}-${partBytes + 63}/${bytes.length}`,
    );
    expect(await range.body()).toEqual(bytes.subarray(partBytes, partBytes + 64));
    const suffix = await client.get(url, { headers: { Range: 'bytes=-20' } });
    expect(suffix.status()).toBe(206);
    expect(await suffix.body()).toEqual(bytes.subarray(-20));
    const invalid = await client.get(url, { headers: { Range: `bytes=${bytes.length}-` } });
    expect(invalid.status()).toBe(416);
    expect(invalid.headers()['content-range']).toBe(`bytes */${bytes.length}`);
    const head = await client.head(url);
    expect(head.status()).toBe(200);
    expect(head.headers()['content-length']).toBe(String(bytes.length));
    expect(await head.body()).toHaveLength(0);

    await expectStatus(await client.delete(`${apiPath}/${asset.id}`), 200);
    const afterArchive = await client.get(apiPath, { params: { search: title } });
    expect(((await afterArchive.json()) as { items: unknown[] }).items).toEqual([]);
    const historical = await otherEditor.get(url, { headers: { Range: 'bytes=0-39' } });
    expect(historical.status()).toBe(206);
    expect(await historical.body()).toEqual(bytes.subarray(0, 40));
  } finally {
    if (assetId && finalized) await client.delete(`${apiPath}/${assetId}`).catch(() => {});
    else if (uploadId) await client.delete(`${apiPath}/uploads/${uploadId}`).catch(() => {});
    await Promise.all([client.dispose(), otherEditor.dispose(), anonymous.dispose()]);
  }
});

test('image and PDF uploads verify their content before exposing a stable asset', async ({
  playwright,
}) => {
  const client = await playwright.request.newContext({
    storageState: authState('admin'),
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const fixtures = [
    {
      filename: 'tiny.png',
      mimeType: 'image/png',
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
      inline: true,
    },
    {
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
      ),
      inline: false,
    },
  ];
  const uploads: Array<{ id: string; assetId: string; complete: boolean }> = [];
  try {
    await signInApi(client);
    for (const fixture of fixtures) {
      const start = await client.post(`${apiPath}/uploads`, {
        data: {
          filename: fixture.filename,
          mimeType: fixture.mimeType,
          byteSize: fixture.bytes.length,
          title: `Asset e2e ${crypto.randomUUID()}`,
        },
      });
      await expectStatus(start, 201);
      const upload = {
        ...((await start.json()) as { id: string; assetId: string }),
        complete: false,
      };
      uploads.push(upload);
      await expectStatus(
        await client.put(`${apiPath}/uploads/${upload.id}/parts/1`, { data: fixture.bytes }),
        200,
      );
      await expectStatus(await client.post(`${apiPath}/uploads/${upload.id}/complete`), 200);
      upload.complete = true;
      const content = await client.get(`${apiPath}/${upload.assetId}/content`);
      expect(content.status()).toBe(200);
      expect(await content.body()).toEqual(fixture.bytes);
      expect(content.headers()['content-type']).toBe(fixture.mimeType);
      expect(content.headers()['content-disposition']).toContain(
        fixture.inline ? 'inline' : 'attachment',
      );
    }
    const invalidBytes = Buffer.from('<html>not actually an image</html>');
    const invalidStart = await client.post(`${apiPath}/uploads`, {
      data: { filename: 'bad.png', mimeType: 'image/png', byteSize: invalidBytes.length },
    });
    await expectStatus(invalidStart, 201);
    const invalid = {
      ...((await invalidStart.json()) as { id: string; assetId: string }),
      complete: false,
    };
    uploads.push(invalid);
    await expectStatus(
      await client.put(`${apiPath}/uploads/${invalid.id}/parts/1`, { data: invalidBytes }),
      200,
    );
    await expectStatus(await client.post(`${apiPath}/uploads/${invalid.id}/complete`), 415);
    await expectStatus(await client.get(`${apiPath}/${invalid.assetId}`), 404);
  } finally {
    for (const upload of uploads)
      await client
        .delete(
          upload.complete ? `${apiPath}/${upload.assetId}` : `${apiPath}/uploads/${upload.id}`,
        )
        .catch(() => {});
    await client.dispose();
  }
});

test('an uploaded library image can be picked for a Hero and persists as an asset reference', async ({
  page,
}) => {
  const title = `Hero image ${crypto.randomUUID()}`;
  const alt = 'A tiny image selected for this Hero';
  let assetId: string | undefined;
  async function cms<T>(path: string, body?: unknown): Promise<T> {
    const response =
      body === undefined
        ? await page.request.get(`/api/cms${path}`)
        : await page.request.post(`/api/cms${path}`, { headers: { Origin: origin }, data: body });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()) as T;
  }
  try {
    await signInPage(page);

    const definitions = await cms<BlockDefinition[]>('/definitions');
    const story = await cms<Story>('/stories', {
      name: title,
      slug: `asset-${crypto.randomUUID()}`,
      definitionId: definitions.find((definition) => definition.name === 'page')!.id,
    });
    const [locale] = await cms<StoryLocale[]>(`/stories/${story.id}/locales`);
    const base = `/stories/${story.id}/locales/${locale.id}`;
    const snapshot = await cms<LocaleSnapshot>(base);
    const root = snapshot.locale.rootBlockId;
    const lease = await cms<Lease>(`${base}/leases`, { blockId: root });
    const inserted = await cms<CommitResult>(`${base}/commands`, {
      type: 'insertBlock',
      mutationId: crypto.randomUUID(),
      expectedRevisions: { [root]: snapshot.blocks.find((block) => block.id === root)!.revision },
      leaseTokens: { [root]: lease.token },
      payload: {
        parentId: root,
        parentField: 'body',
        definitionId: definitions.find((definition) => definition.name === 'hero')!.id,
      },
    });
    const heroId = inserted.snapshot.blocks.find((block) => block.parentId === root)!.id;
    await expectStatus(
      await page.request.delete(`/api/cms${base}/leases`, {
        headers: { Origin: origin },
        data: { blockId: root, token: lease.token },
      }),
      200,
    );

    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await navigation.getByRole('button', { name: 'Assets', exact: true }).click();
    const filename = `${title}.png`;
    const completion = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/cms\/assets\/uploads\/[^/]+\/complete$/.test(new URL(response.url()).pathname),
    );
    await page
      .getByLabel('Choose files to upload')
      .setInputFiles({ name: filename, mimeType: 'image/png', buffer: landscape });
    const completed = await completion;
    expect(completed.status(), await completed.text()).toBe(200);
    assetId = ((await completed.json()) as { asset: { id: string } }).asset.id;
    const card = page.getByRole('button', { name: `Edit ${filename}`, exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole('img')).toHaveAttribute(
      'src',
      `${apiPath}/${assetId}/thumbnail?width=320&space=11111111-1111-4111-8111-111111111111`,
    );
    await expect(card.getByRole('img')).toHaveJSProperty('naturalWidth', 320);
    const thumbnail = await page.request.get(`${apiPath}/${assetId}/thumbnail?width=320`);
    expect(thumbnail.status(), await thumbnail.text()).toBe(200);
    expect(thumbnail.headers()['content-type']).toBe('image/webp');
    expect(thumbnail.headers()['cache-control']).toBe('private, max-age=300');
    expect((await thumbnail.body()).length).toBeLessThan(landscape.length);
    await card.click();
    const details = page.getByRole('dialog', { name: filename, exact: true });
    await details.getByLabel('Title', { exact: true }).fill(title);
    await details.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(details).not.toBeVisible();

    await navigation.getByRole('button', { name: 'Content', exact: true }).click();
    await page.getByRole('button', { name: story.name, exact: true }).click();
    await page
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Hero', exact: true })
      .click();
    await page.getByRole('button', { name: 'Choose asset', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose an asset' });
    await picker.getByRole('searchbox', { name: 'Search assets' }).fill(title);
    await picker.getByRole('button', { name: `Select ${title}`, exact: true }).click();
    await expect(picker).not.toBeVisible();
    await page.getByLabel('Alt text for this use').fill(alt);
    await expect
      .poll(
        async () =>
          (await cms<LocaleSnapshot>(base)).blocks.find((block) => block.id === heroId)!.fields
            .image,
      )
      .toEqual({ assetId, alt });
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();

    // Reopening forces the picker to resolve the stored ID through the asset API.
    await navigation.getByRole('button', { name: 'Content', exact: true }).click();
    await page.getByRole('button', { name: story.name, exact: true }).click();
    await page
      .getByRole('region', { name: 'Block editor' })
      .getByRole('button', { name: 'Hero', exact: true })
      .click();
    const preview = page.locator('.asset-picked').getByRole('img');
    await expect(preview).toHaveAttribute(
      'src',
      `${apiPath}/${assetId}/thumbnail?width=320&space=11111111-1111-4111-8111-111111111111`,
    );
    await expect(preview).toHaveJSProperty('naturalWidth', 320);
    await expect(page.getByLabel('Alt text for this use')).toHaveValue(alt);
    await navigation.getByRole('button', { name: 'Content', exact: true }).click();
  } finally {
    if (assetId)
      await page.request
        .delete(`${apiPath}/${assetId}`, { headers: { Origin: origin } })
        .catch(() => {});
  }
});

test('dropping multiple files starts the mini uploader and survives navigation, pause, and resume', async ({
  page,
  playwright,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const prefix = `Drop-${crypto.randomUUID()}`;
  const imageName = `${prefix}.png`,
    textName = `${prefix}.txt`,
    invalidName = `${prefix}.exe`;
  let releasePart!: () => void;
  const gate = new Promise<void>((resolve) => {
    releasePart = resolve;
  });
  let intercepted = false;
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  try {
    await signInPage(page);
    await page.route('**/api/cms/assets/uploads/*/parts/1', async (route) => {
      if (!intercepted) {
        intercepted = true;
        await gate;
      }
      await route.continue().catch(() => {});
    });
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await navigation.getByRole('button', { name: 'Assets', exact: true }).click();
    const transfer = await page.evaluateHandle(
      ({ bytes, imageName, textName, invalidName }) => {
        const data = new DataTransfer();
        data.items.add(
          new File([new Uint8Array(bytes)], imageName, { type: 'image/png', lastModified: 12345 }),
        );
        data.items.add(
          new File(['Drag and drop fixture'], textName, {
            type: 'text/plain',
            lastModified: 12345,
          }),
        );
        data.items.add(
          new File(['Unsupported fixture'], invalidName, {
            type: 'application/octet-stream',
            lastModified: 12345,
          }),
        );
        return data;
      },
      { bytes: Array.from(landscape), imageName, textName, invalidName },
    );
    const library = page.locator('.asset-library');
    await library.dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(page.getByText('Drop files to upload', { exact: true })).toBeVisible();
    await library.dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
    const manager = page.getByRole('region', { name: 'Upload manager' });
    await expect(manager).toBeVisible();
    await expect.poll(() => intercepted).toBe(true);
    await navigation.getByRole('button', { name: 'Content', exact: true }).click();
    await expect(manager).toBeVisible();
    await manager.getByRole('button', { name: `Pause ${imageName}`, exact: true }).click();
    await expect(manager.locator('.upload-mini-item').filter({ hasText: imageName })).toContainText(
      'Paused',
    );
    releasePart();
    await manager.getByRole('button', { name: `Retry ${imageName}`, exact: true }).click();
    await expect(manager.locator('.upload-mini-item--done')).toHaveCount(2, { timeout: 20_000 });
    await expect(
      manager.locator('.upload-mini-item').filter({ hasText: invalidName }),
    ).toContainText('Unsupported file type');
    await expect(manager).toHaveCSS('background-color', 'rgb(25, 31, 41)');
    await manager.screenshot({ path: '/tmp/storypane-theme-uploader-dark.png' });
    await manager.getByRole('button', { name: 'Minimize uploads' }).click();
    await expect(manager.locator('.upload-mini-items')).not.toBeVisible();
    await manager.getByRole('button', { name: 'Expand uploads' }).click();
    await expect(manager.locator('.upload-mini-items')).toBeVisible();
    await navigation.getByRole('button', { name: 'Assets', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search assets' }).fill(prefix);
    await expect(page.locator('.asset-card')).toHaveCount(2);
    const image = page
      .getByRole('button', { name: `Edit ${imageName}`, exact: true })
      .getByRole('img');
    await expect(image).toHaveJSProperty('naturalWidth', 320);
    const thumbnailUrl = await image.getAttribute('src');
    expect((await anonymous.get(thumbnailUrl!)).status()).toBe(401);
  } finally {
    releasePart?.();
    const listed = await page.request.get(apiPath, { params: { search: prefix } });
    if (listed.ok())
      for (const asset of ((await listed.json()) as { items: { id: string }[] }).items)
        await page.request.delete(`${apiPath}/${asset.id}`, { headers: { Origin: origin } });
    await anonymous.dispose();
  }
});
