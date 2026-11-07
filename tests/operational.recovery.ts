import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { Pool } from 'pg';
import type { APIRequestContext } from '@playwright/test';
import type {
  BlockDefinition,
  CommitResult,
  Lease,
  LocaleSnapshot,
  Story,
  StoryLocale,
} from '@storypane/core';
import { test, expect, type OperationalInstallation } from './fixtures/operational';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const WebSocket = require('ws');
async function cms<T>(
  client: APIRequestContext,
  f: OperationalInstallation,
  path: string,
  data?: unknown,
  method = data === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await client.fetch(f.origin + '/api/cms' + path, {
    method,
    data,
    headers: { Origin: f.origin, 'x-storypane-space-id': f.spaceId },
    timeout: 30000,
  });
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
  return response.json();
}
async function story(client: APIRequestContext, f: OperationalInstallation, name: string) {
  const defs = await cms<BlockDefinition[]>(client, f, '/definitions?deployed=true');
  const page = await cms<Story>(client, f, '/stories', {
    name,
    slug: 'regression-' + randomUUID(),
    definitionId: defs.find((d) => d.name === 'page')!.id,
  });
  const [locale] = await cms<StoryLocale[]>(client, f, `/stories/${page.id}/locales`);
  return { page, locale, defs, base: `/stories/${page.id}/locales/${locale.id}` };
}
async function save(
  client: APIRequestContext,
  f: OperationalInstallation,
  base: string,
  blockId: string,
  fields: Record<string, unknown>,
) {
  const snapshot = await cms<LocaleSnapshot>(client, f, base);
  const lease = await cms<Lease>(client, f, base + '/leases', { blockId });
  try {
    return (
      await cms<CommitResult>(client, f, base + '/commands', {
        type: 'saveBlock',
        mutationId: randomUUID(),
        expectedRevisions: { [blockId]: snapshot.blocks.find((b) => b.id === blockId)!.revision },
        leaseTokens: { [blockId]: lease.token },
        payload: { blockId, fields },
      })
    ).snapshot;
  } finally {
    await cms(client, f, base + '/leases', { blockId, token: lease.token }, 'DELETE');
  }
}
async function connect(url: string, protocols: string[], headers: Record<string, string>) {
  const socket = new WebSocket(url, protocols, { headers, handshakeTimeout: 15000 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let message;
  try {
    message = await Promise.race([
      once(socket, 'message').then(([data]) => JSON.parse(data.toString())),
      new Promise<never>((_r, reject) => {
        timer = setTimeout(() => {
          socket.terminate();
          reject(new Error('No WebSocket snapshot'));
        }, 20000);
        timer!.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }

  return { socket, message };
}
async function revoked(socket: InstanceType<typeof WebSocket>) {
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'sync' }));
  const [code] = await closed;
  expect(code).toBe(1008);
}
test.beforeEach(async ({ page, installation: f }) => {
  // Respect the built-in sign-in throttle when tests share one public IP.
  await expect
    .poll(
      async () =>
        (
          await page.request.post(f.origin + '/api/auth/sign-in/email', {
            headers: { Origin: f.origin },
            data: { email: f.email, password: f.password },
          })
        ).status(),
      { timeout: 30000, intervals: [1000, 3000, 5000] },
    )
    .toBe(200);
});

test('scoped HTTP and live snapshots filter content and active lease tokens; editor and preview revocation disconnect', async ({
  page,
  playwright,
  installation: f,
}) => {
  const item = await story(page.request, f, 'Scope and revocation');
  let snapshot = await cms<LocaleSnapshot>(page.request, f, item.base);
  const root = await cms<Lease>(page.request, f, item.base + '/leases', {
    blockId: snapshot.locale.rootBlockId,
  });
  try {
    for (const name of ['hero', 'footer']) {
      snapshot = await cms<LocaleSnapshot>(page.request, f, item.base);
      await cms(page.request, f, item.base + '/commands', {
        type: 'insertBlock',
        mutationId: randomUUID(),
        expectedRevisions: {
          [snapshot.locale.rootBlockId]: snapshot.blocks.find(
            (b) => b.id === snapshot.locale.rootBlockId,
          )!.revision,
        },
        leaseTokens: { [snapshot.locale.rootBlockId]: root.token },
        payload: {
          parentId: snapshot.locale.rootBlockId,
          parentField: 'body',
          definitionId: item.defs.find((d) => d.name === name)!.id,
        },
      });
    }
  } finally {
    await cms(
      page.request,
      f,
      item.base + '/leases',
      { blockId: snapshot.locale.rootBlockId, token: root.token },
      'DELETE',
    );
  }
  snapshot = await cms<LocaleSnapshot>(page.request, f, item.base);
  const hero = snapshot.blocks.find(
    (b) => b.definitionId === item.defs.find((d) => d.name === 'hero')!.id,
  )!;
  const footer = snapshot.blocks.find(
    (b) => b.definitionId === item.defs.find((d) => d.name === 'footer')!.id,
  )!;
  await save(page.request, f, item.base, hero.id, { ...hero.fields, title: 'PUBLIC HERO' });
  await save(page.request, f, item.base, footer.id, { ...footer.fields, text: 'PRIVATE FOOTER' });
  const email = `editor-${randomUUID()}@regression.test`,
    password = randomUUID() + randomUUID();
  const invitation = await cms<{ link: string }>(page.request, f, '/invitations', {
    email,
    role: 'editor',
  });
  const peer = await playwright.request.newContext({
    baseURL: f.origin,
    extraHTTPHeaders: { Origin: f.origin },
  });
  let held: Lease | undefined,
    editorSocket: InstanceType<typeof WebSocket> | undefined,
    previewSocket: InstanceType<typeof WebSocket> | undefined;
  let userId = '';
  try {
    expect(
      (
        await peer.post('/api/auth/accept-invitation', {
          data: {
            spaceId: f.spaceId,
            token: new URL(invitation.link).searchParams.get('invite'),
            name: 'Scoped editor',
            password,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await peer.post('/api/auth/sign-in/email', { data: { email, password } })).status(),
    ).toBe(200);
    userId = (await (await peer.get('/api/session')).json()).user.id;
    const roleName = 'Scoped ' + randomUUID();
    const body = item.defs
      .find((d) => d.name === 'page')!
      .fields.find((field) => field.name === 'body')!;
    const title = item.defs
      .find((d) => d.name === 'hero')!
      .fields.find((field) => field.name === 'title')!;
    await cms(page.request, f, '/roles', {
      name: roleName,
      permissions: ['content:read'],
      contentScopes: { read: { fieldIds: [body.id, title.id] } },
    });
    const role = (await cms<{ id: string; name: string }[]>(page.request, f, '/roles')).find(
      (r) => r.name === roleName,
    )!;
    await cms(page.request, f, '/members/' + userId, { role: role.id }, 'PUT');
    held = await cms<Lease>(page.request, f, item.base + '/leases', { blockId: hero.id });
    const http = await cms<LocaleSnapshot>(peer, f, item.base);
    expect(JSON.stringify(http)).toContain('PUBLIC HERO');
    expect(JSON.stringify(http)).not.toContain('PRIVATE FOOTER');
    expect(http.leases.some((lease) => lease.blockId === hero.id)).toBe(true);
    expect(http.leases.every((lease) => !('token' in lease))).toBe(true);
    const cookies = (await peer.storageState()).cookies
      .map((c) => c.name + '=' + c.value)
      .join('; ');
    const url = new URL('/api/cms' + item.base + '/live?space=' + f.spaceId, f.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const live = await connect(url.href, [], { Origin: f.origin, Cookie: cookies });
    editorSocket = live.socket;
    expect(live.message.type).toBe('snapshot');
    expect(JSON.stringify(live.message)).toContain('PUBLIC HERO');
    expect(JSON.stringify(live.message)).not.toContain('PRIVATE FOOTER');
    expect(live.message.snapshot.leases.some((lease: Lease) => lease.blockId === hero.id)).toBe(
      true,
    );
    expect(live.message.snapshot.leases.every((lease: Lease) => !('token' in lease))).toBe(true);
    await cms(
      page.request,
      f,
      '/roles/' + role.id,
      { name: roleName, permissions: [], contentScopes: {} },
      'PUT',
    );
    await revoked(editorSocket);
    await cms(page.request, f, '/members/' + userId, { role: 'editor' }, 'PUT');
    const previewId = randomUUID(),
      previewOrigin = 'https://preview.example.test';
    await cms(
      page.request,
      f,
      '/delivery-settings',
      {
        previewUrls: [
          { id: previewId, name: 'Regression preview', url: previewOrigin + '/{slug}' },
        ],
        defaultPreviewId: previewId,
        previewParameter: 'storypane_preview',
      },
      'PUT',
    );
    const preview = await cms<{ token: string }>(peer, f, item.base + '/preview', {});
    const previewUrl = new URL('/api/preview/live', f.origin);
    previewUrl.protocol = url.protocol;
    const livePreview = await connect(previewUrl.href, ['storypane-preview', preview.token], {
      Origin: previewOrigin,
    });
    previewSocket = livePreview.socket;
    expect(livePreview.message.type).toBe('content');
    const wrong = new WebSocket(previewUrl.href, ['storypane-preview', preview.token], {
      headers: { Origin: 'https://untrusted.example' },
      handshakeTimeout: 15000,
    });
    const denied = once(wrong, 'unexpected-response');
    wrong.on('error', () => {});
    const [, response] = await denied;
    response.resume();
    wrong.terminate();
    expect(response.statusCode).toBe(401);
    await cms(page.request, f, '/members/' + userId, { role: role.id }, 'PUT');
    await revoked(previewSocket);
  } finally {
    editorSocket?.terminate();
    previewSocket?.terminate();
    if (held)
      await cms(
        page.request,
        f,
        item.base + '/leases',
        { blockId: hero.id, token: held.token },
        'DELETE',
      );
    if (userId) await cms(page.request, f, '/members/' + userId, { role: 'editor' }, 'PUT');
    await peer.dispose();
  }
});

test('multipart upload and an approved two-page release recover across process restart without publishing later drafts', async ({
  page,
  installation: f,
}) => {
  test.setTimeout(300000);
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const item = await story(page.request, f, 'Release ' + i);
    const snapshot = await cms<LocaleSnapshot>(page.request, f, item.base);
    const root = snapshot.blocks.find((b) => typeof b.fields.title === 'string');
    // Starter Page has no title field: keep approval content on a nested Hero instead.
    let target = root;
    if (!target) {
      const parent = snapshot.locale.rootBlockId;
      const lease = await cms<Lease>(page.request, f, item.base + '/leases', { blockId: parent });
      try {
        await cms(page.request, f, item.base + '/commands', {
          type: 'insertBlock',
          mutationId: randomUUID(),
          expectedRevisions: { [parent]: snapshot.blocks.find((b) => b.id === parent)!.revision },
          leaseTokens: { [parent]: lease.token },
          payload: {
            parentId: parent,
            parentField: 'body',
            definitionId: item.defs.find((d) => d.name === 'hero')!.id,
          },
        });
      } finally {
        await cms(
          page.request,
          f,
          item.base + '/leases',
          { blockId: parent, token: lease.token },
          'DELETE',
        );
      }
      target = (await cms<LocaleSnapshot>(page.request, f, item.base)).blocks.find(
        (b) => typeof b.fields.title === 'string',
      )!;
    }
    await save(page.request, f, item.base, target.id, { ...target.fields, title: 'APPROVED ' + i });
    pages.push({ ...item, target });
  }
  const due = new Date(Math.ceil((Date.now() + 90000) / 60000) * 60000);
  const localTime = due.toISOString().slice(0, 16);
  let release = await cms<{ id: string; revision: number }>(page.request, f, '/releases', {
    requestId: randomUUID(),
    name: 'Restart regression',
    dueAt: due.toISOString(),
    timezone: 'UTC',
    localTime,
  });
  for (const item of pages) {
    const snapshot = await cms<LocaleSnapshot>(page.request, f, item.base);
    await cms(page.request, f, item.base + '/schedules', {
      requestId: randomUUID(),
      checkpointId: snapshot.checkpointId,
      dueAt: due.toISOString(),
      timezone: 'UTC',
      localTime,
      expectedScheduleId: null,
      expectedRevision: null,
      release: { id: release.id, revision: release.revision },
    });
    release = (await cms<{ id: string; revision: number }[]>(page.request, f, '/releases')).find(
      (r) => r.id === release.id,
    )!;
    await save(page.request, f, item.base, item.target.id, {
      ...item.target.fields,
      title: 'LATER PRIVATE DRAFT',
    });
  }
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 4096, 'b');
  bytes.write('Multipart restart regression');
  const upload = await cms<{ id: string; assetId: string; partBytes: number }>(
    page.request,
    f,
    '/assets/uploads',
    { filename: 'restart.txt', mimeType: 'text/plain', byteSize: bytes.length },
  );
  const uploadPath = f.origin + '/api/cms/assets/uploads/' + upload.id;
  expect(
    (
      await page.request.put(uploadPath + '/parts/1', {
        headers: { Origin: f.origin, 'x-storypane-space-id': f.spaceId },
        data: bytes.subarray(0, upload.partBytes),
      })
    ).status(),
  ).toBe(200);
  await f.crash();
  const resumed = await cms<{ parts: { partNumber: number }[] }>(
    page.request,
    f,
    '/assets/uploads/' + upload.id,
  );
  expect(resumed.parts.map((part) => part.partNumber)).toEqual([1]);
  expect(
    (
      await page.request.put(uploadPath + '/parts/2', {
        headers: { Origin: f.origin, 'x-storypane-space-id': f.spaceId },
        data: bytes.subarray(upload.partBytes),
      })
    ).status(),
  ).toBe(200);
  await cms(page.request, f, '/assets/uploads/' + upload.id + '/complete', {});
  const original = await page.request.get(
    f.origin + '/api/cms/assets/' + upload.assetId + '/content',
    { headers: { 'x-storypane-space-id': f.spaceId } },
  );
  expect(original.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await original.body())
      .digest('hex'),
  ).toBe(createHash('sha256').update(bytes).digest('hex'));
  await expect
    .poll(
      async () =>
        (await cms<{ id: string; status: string }[]>(page.request, f, '/releases')).find(
          (r) => r.id === release.id,
        )?.status,
      { timeout: 210000, intervals: [2000] },
    )
    .toBe('published');
  for (const item of pages) {
    const published = JSON.stringify(await cms(page.request, f, item.base + '/published'));
    expect(published).toContain('APPROVED');
    expect(published).not.toContain('LATER PRIVATE DRAFT');
    expect(JSON.stringify(await cms(page.request, f, item.base))).toContain('LATER PRIVATE DRAFT');
  }
});

test('space outages degrade readiness without blocking a healthy space; installation outages recover the existing session', async ({
  page,
  installation: f,
}) => {
  test.setTimeout(90000);
  const other = await page.request.post(f.origin + '/api/spaces', {
    headers: { Origin: f.origin },
    data: { name: 'Healthy during outage', mode: 'create', environment: 'dev' },
  });
  expect(other.ok()).toBe(true);
  const second = await other.json();
  const operator = new Pool({
    connectionString: f.operatorURL,
    ssl: f.databaseSSL,
    connectionTimeoutMillis: 10000,
  });
  const spaceName = 'sp_' + f.spaceId.replaceAll('-', '');
  const available = async (name: string, value: boolean) => {
    expect(/^(storypane_installation|sp_[a-f0-9]{32})$/.test(name)).toBe(true);
    await operator.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS ${value ? 'true' : 'false'}`);
    if (!value)
      await operator.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',
        [name],
      );
  };
  try {
    await available(spaceName, false);
    const ready = await page.request.get(f.origin + '/api/ready');
    expect(ready.status()).toBe(200);
    expect((await ready.json()).degraded).toBe(true);
    expect(
      (
        await page.request.get(f.origin + '/api/cms/stories', {
          headers: { 'x-storypane-space-id': second.id },
        })
      ).status(),
    ).toBe(200);
    await available(spaceName, true);
    expect(
      (
        await page.request.get(f.origin + '/api/cms/stories', {
          headers: { 'x-storypane-space-id': f.spaceId },
        })
      ).status(),
    ).toBe(200);
    await available('storypane_installation', false);
    expect((await page.request.get(f.origin + '/api/ready')).status()).toBe(503);
    await available('storypane_installation', true);
    expect((await page.request.get(f.origin + '/api/ready')).status()).toBe(200);
    expect((await page.request.get(f.origin + '/api/session')).status()).toBe(200);
  } finally {
    await available(spaceName, true);
    await available('storypane_installation', true);
    await operator.end();
  }
});

test('backup restores every database, original, credentials and encrypted settings, then delivers the pending outbox', async ({
  page,
  playwright,
  installation: f,
}) => {
  test.setTimeout(600000);
  const { backupAndRestore } = await import('./fixtures/recovery-backup');
  const { readFileSync } = await import('node:fs');
  const { createHmac } = await import('node:crypto');
  const other = await page.request.post(f.origin + '/api/spaces', {
    headers: { Origin: f.origin },
    data: { name: 'Backup second space', mode: 'create', environment: 'dev' },
  });
  expect(other.status()).toBe(201);
  const home = (await cms<Story[]>(page.request, f, '/stories')).find((s) => s.slug === 'home')!;
  const [homeLocale] = await cms<StoryLocale[]>(page.request, f, `/stories/${home.id}/locales`);
  const homeBase = `/stories/${home.id}/locales/${homeLocale.id}`;
  const homeSnapshot = await cms<LocaleSnapshot>(page.request, f, homeBase);
  const hero = homeSnapshot.blocks.find((b) => typeof b.fields.title === 'string')!;
  const approved = await save(page.request, f, homeBase, hero.id, {
    ...hero.fields,
    title: 'RESTORE APPROVED',
  });
  await cms(page.request, f, homeBase + '/commands', {
    type: 'publishCheckpoint',
    mutationId: randomUUID(),
    expectedRevisions: {},
    leaseTokens: {},
    payload: { checkpointId: approved.checkpointId },
  });
  await save(page.request, f, homeBase, hero.id, {
    ...hero.fields,
    title: 'RESTORE PRIVATE DRAFT',
  });
  const previewId = randomUUID();
  await cms(
    page.request,
    f,
    '/delivery-settings',
    {
      previewUrls: [
        { id: previewId, name: 'Restore preview', url: 'https://preview.example.test/{slug}' },
      ],
      defaultPreviewId: previewId,
      previewParameter: 'storypane_preview',
    },
    'PUT',
  );
  const bytes = readFileSync(new URL('./fixtures/landscape.png', import.meta.url));
  const upload = await cms<{ id: string; assetId: string }>(page.request, f, '/assets/uploads', {
    filename: 'restore.png',
    mimeType: 'image/png',
    byteSize: bytes.length,
  });
  expect(
    (
      await page.request.put(f.origin + '/api/cms/assets/uploads/' + upload.id + '/parts/1', {
        headers: { Origin: f.origin, 'x-storypane-space-id': f.spaceId },
        data: bytes,
      })
    ).status(),
  ).toBe(200);
  await cms(page.request, f, '/assets/uploads/' + upload.id + '/complete', {});
  const delivery = await cms<{ token: string }>(page.request, f, '/delivery-tokens', {
    name: 'Restore delivery',
    scope: 'published',
  });
  const management = await cms<{ token: string }>(page.request, f, '/management-tokens', {
    name: 'Restore management',
    scopes: ['read'],
  });
  const path = '/restore-outbox/' + randomUUID();
  const endpoint = await cms<{ endpoint: { id: string }; secret: string }>(
    page.request,
    f,
    '/webhooks',
    {
      name: 'Restore outbox',
      url: f.destination + path,
      events: ['story.published'],
      enabled: true,
    },
  );
  const session = await (await page.request.get(f.origin + '/api/session')).json();
  const received: { id: string; body: string }[] = [];
  const listener: import('node:http').RequestListener = async (incoming, outgoing) => {
    if (incoming.url !== path) {
      outgoing.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 32768) throw Error('Oversized webhook');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8'),
        timestamp = String(incoming.headers['webhook-timestamp'] ?? '');
      const signature =
        'v1=' +
        createHmac('sha256', endpoint.secret)
          .update(timestamp + '.' + body)
          .digest('hex');
      if (incoming.headers['webhook-signature'] !== signature) {
        outgoing.writeHead(401).end();
        return;
      }
      received.push({ id: String(incoming.headers['webhook-id']), body });
      outgoing.writeHead(204).end();
    } catch {
      outgoing.writeHead(500).end();
    }
  };
  f.receiver.on('request', listener);
  let restored: Awaited<ReturnType<typeof backupAndRestore>> | undefined;
  try {
    restored = await backupAndRestore(f, endpoint.endpoint.id, session.user.id);
    const client = await playwright.request.newContext({
      baseURL: restored.origin,
      extraHTTPHeaders: { Origin: restored.origin, 'x-storypane-space-id': f.spaceId },
    });
    try {
      expect(
        (
          await client.post('/api/auth/sign-in/email', {
            data: { email: f.email, password: f.password },
          })
        ).status(),
      ).toBe(200);
      const spaces = await (await client.get('/api/spaces')).json();
      expect(spaces.length).toBeGreaterThanOrEqual(2);
      for (const space of spaces)
        expect(
          (
            await client.get('/api/cms/stories', { headers: { 'x-storypane-space-id': space.id } })
          ).status(),
        ).toBe(200);
      const asset = await client.get('/api/cms/assets/' + upload.assetId + '/content');
      expect(asset.status()).toBe(200);
      expect(
        createHash('sha256')
          .update(await asset.body())
          .digest('hex'),
      ).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(
        (await client.get('/api/cms/assets/' + upload.assetId + '/thumbnail?width=320')).headers()[
          'content-type'
        ],
      ).toBe('image/webp');
      const anonymous = await playwright.request.newContext({ baseURL: restored.origin });
      try {
        expect(
          (
            await anonymous.get('/api/cms/assets/' + upload.assetId + '/content', {
              headers: { 'x-storypane-space-id': f.spaceId },
            })
          ).status(),
        ).toBe(401);
        expect(
          (
            await anonymous.get(`/api/management/v1/spaces/${f.spaceId}/stories`, {
              headers: { Authorization: 'Bearer ' + management.token },
            })
          ).status(),
        ).toBe(200);
        const published = await anonymous.get('/api/delivery/stories?space=' + f.spaceId, {
          headers: { Authorization: 'Bearer ' + delivery.token },
        });
        expect(published.status()).toBe(200);
        const body = await published.text();
        expect(body).toContain('RESTORE APPROVED');
        expect(body).not.toContain('RESTORE PRIVATE DRAFT');
      } finally {
        await anonymous.dispose();
      }
      const stories = await cms<Story[]>(client, { ...f, origin: restored.origin }, '/stories');
      const [locale] = await cms<StoryLocale[]>(
        client,
        { ...f, origin: restored.origin },
        `/stories/${stories[0].id}/locales`,
      );
      const preview = await cms<{ token: string }>(
        client,
        { ...f, origin: restored.origin },
        `/stories/${stories[0].id}/locales/${locale.id}/preview`,
        {},
      );
      const socket = await connect(
        restored.origin.replace('http:', 'ws:') + '/api/preview/live',
        ['storypane-preview', preview.token],
        { Origin: 'https://preview.example.test' },
      );
      expect(socket.message.type).toBe('content');
      socket.socket.terminate();
      await expect
        .poll(
          async () => {
            const result = await client.get(`/api/cms/webhooks/${endpoint.endpoint.id}/deliveries`);
            return (await result.json()).deliveries.find(
              (d: { id: string }) => d.id === restored!.pending.deliveryId,
            )?.status;
          },
          { timeout: 90000, intervals: [1000] },
        )
        .toBe('succeeded');
      expect(received.some((r) => r.id === restored!.pending.eventId)).toBe(true);
      expect(Object.keys(restored.manifest.databases).length).toBeGreaterThanOrEqual(3);
      expect(restored.manifest.objects.length).toBeGreaterThanOrEqual(1);
    } finally {
      await client.dispose();
    }
  } finally {
    if (restored) await restored.close();
    f.receiver.off('request', listener);
  }
});
