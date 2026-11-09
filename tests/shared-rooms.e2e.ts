import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test, expect, type BrowserContext } from '@playwright/test';
import {
  contentScopesSchema,
  type CommitResult,
  type Lease,
  type LocaleSnapshot,
} from '@storypane/core';
import { reviewInstallation } from './fixtures/review-installation';

test('two editor processes share edits, leases and preview; reconnect safely and recheck recipients', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const installation = await reviewInstallation();
  const contexts: BrowserContext[] = [];
  try {
    const scope = (await installation.installation.query('SELECT current_schema() AS scope'))
      .rows[0].scope;
    const channel = `storypane_rooms_${createHash('sha256').update(scope).digest('hex').slice(0, 16)}`;
    const listeners = async () =>
      (
        await installation.installation.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='storypane-rooms' AND query=$1",
          [`LISTEN "${channel}"`],
        )
      ).rows.map((row) => row.pid as number);
    const firstListeners = await listeners();
    expect(firstListeners).toHaveLength(1);
    const replica = await installation.startReplica();
    const secondListener = (await listeners()).find((pid) => !firstListeners.includes(pid));
    expect(secondListener).toBeTruthy();
    const headers = { Origin: installation.origin, 'x-storypane-space-id': installation.spaceId };
    const base = `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}`;
    const signIn = async (person: 'admin' | 'writer') => {
      const context = await browser.newContext({ baseURL: installation.origin });
      contexts.push(context);
      await context.grantPermissions(['local-network-access'], { origin: installation.origin });
      const response = await context.request.post('/api/auth/sign-in/email', {
        headers: { Origin: installation.origin },
        data: { email: installation.people[person].email, password: installation.password },
      });
      expect(response.ok()).toBe(true);
      return context;
    };
    const admin = await signIn('admin'),
      writer = await signIn('writer');
    type Frame = {
      type: string;
      snapshot?: LocaleSnapshot;
      story?: { content: { title?: string } };
      code?: string;
    };
    const peer = async (context: BrowserContext, target: string, previewToken?: string) => {
      const page = await context.newPage();
      await page.route('**/room-check', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Room check</title>',
        }),
      );
      await page.goto('/room-check');
      const messages: Frame[] = [];
      let closed = false;
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) =>
          messages.push(JSON.parse(payload.toString()) as Frame),
        );
        socket.on('close', () => {
          closed = true;
        });
      });
      const path = previewToken
        ? '/api/preview/live'
        : `${base}/live?space=${installation.spaceId}`;
      await page.evaluate(
        ({ url, token }) => {
          const socket = token
            ? new WebSocket(url, ['storypane-preview', token])
            : new WebSocket(url);
          socket.onmessage = () => {};
        },
        { url: target.replace('http:', 'ws:') + path, token: previewToken },
      );
      await expect.poll(() => messages.length).toBeGreaterThan(0);
      return { messages, page, closed: () => closed };
    };
    const read = async (context = admin, origin = installation.origin) => {
      const response = await context.request.get(origin + base, { headers });
      expect(response.ok()).toBe(true);
      return (await response.json()) as LocaleSnapshot;
    };
    const acquire = async (context: BrowserContext, origin: string, blockId: string) => {
      const response = await context.request.post(origin + base + '/leases', {
        headers,
        data: { blockId },
      });
      expect(response.ok()).toBe(true);
      return (await response.json()) as Lease;
    };
    const save = async (
      context: BrowserContext,
      origin: string,
      blockId: string,
      lease: Lease,
      title: string,
    ) => {
      const snapshot = await read(context, origin);
      const block = snapshot.blocks.find((item) => item.id === blockId)!;
      const response = await context.request.post(origin + base + '/commands', {
        headers,
        data: {
          type: 'saveBlock',
          mutationId: randomUUID(),
          migrationVersion: snapshot.migrationVersion,
          expectedRevisions: { [blockId]: block.revision },
          leaseTokens: { [blockId]: lease.token },
          payload: { blockId, fields: { ...block.fields, title } },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()) as CommitResult;
    };
    const snapshot = await read();
    const rootId = installation.rootBlockId;
    const hero = snapshot.blocks.find(
      (block) => block.id !== rootId && typeof block.fields.title === 'string',
    )!;
    expect(hero).toBeTruthy();
    const onFirst = await peer(admin, installation.origin);
    const onSecond = await peer(writer, replica.origin);
    const previewId = randomUUID();
    await installation.db.query(
      'UPDATE spaces SET preview_urls=$2,default_preview_id=$3 WHERE id=$1',
      [
        installation.spaceId,
        JSON.stringify([
          { id: previewId, name: 'Test', url: installation.origin + '/preview/{slug}' },
        ]),
        previewId,
      ],
    );
    const previewResponse = await admin.request.post(base + '/preview', { headers, data: {} });
    expect(previewResponse.ok()).toBe(true);
    const preview = await previewResponse.json();
    const previewPeer = await peer(admin, replica.origin, preview.token);

    let rootLease = await acquire(admin, installation.origin, rootId);
    await expect
      .poll(() =>
        onSecond.messages.some((message) =>
          message.snapshot?.leases.some((lease) => lease.blockId === rootId),
        ),
      )
      .toBe(true);
    const conflict = await writer.request.post(replica.origin + base + '/leases', {
      headers,
      data: { blockId: rootId },
    });
    expect(conflict.status()).toBe(423);
    const heroLease = await acquire(writer, replica.origin, hero.id);
    await Promise.all([
      save(admin, installation.origin, rootId, rootLease, 'Saved on first process'),
      save(writer, replica.origin, hero.id, heroLease, 'Saved on second process'),
    ]);
    await expect
      .poll(() =>
        onFirst.messages.some((message) =>
          message.snapshot?.blocks.some(
            (block) => block.fields.title === 'Saved on second process',
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        onSecond.messages.some((message) =>
          message.snapshot?.blocks.some((block) => block.fields.title === 'Saved on first process'),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        previewPeer.messages.some(
          (message) => message.story?.content.title === 'Saved on first process',
        ),
      )
      .toBe(true);
    expect(
      JSON.stringify([...onFirst.messages, ...onSecond.messages, ...previewPeer.messages]),
    ).not.toContain(rootLease.token);
    expect(JSON.stringify(onSecond.messages)).not.toContain(heroLease.token);

    await installation.installation.query('SELECT pg_terminate_backend($1)', [secondListener]);
    await expect
      .poll(async () => (await admin.request.get(replica.origin + '/api/ready')).status())
      .toBe(503);
    await save(
      admin,
      installation.origin,
      rootId,
      rootLease,
      'Committed during listener interruption',
    );
    await expect
      .poll(() =>
        onSecond.messages.some((message) =>
          message.snapshot?.blocks.some(
            (block) => block.fields.title === 'Committed during listener interruption',
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(async () => (await admin.request.get(replica.origin + '/api/ready')).status())
      .toBe(200);

    const scopes = contentScopesSchema.parse({});
    const visibleField = snapshot.definitions
      .find((definition) => definition.id === hero.definitionId)!
      .fields.find((field) => field.name === 'title')!.id!;
    scopes.read.fieldIds = [visibleField];
    await installation.db.query(
      "UPDATE space_roles SET content_scopes=$2 WHERE space_id=$1 AND id='writer'",
      [installation.spaceId, JSON.stringify(scopes)],
    );
    onSecond.messages.length = 0;
    await save(admin, installation.origin, rootId, rootLease, 'Private field after scope change');
    await expect
      .poll(() => onSecond.messages.some((message) => message.type === 'snapshot'))
      .toBe(true);
    expect(JSON.stringify(onSecond.messages)).not.toContain('Private field after scope change');
    await installation.installation.query('UPDATE "user" SET disabled=true WHERE id=$1', [
      installation.people.writer.id,
    ]);
    await save(admin, installation.origin, rootId, rootLease, 'Recheck revoked recipient');
    await expect.poll(onSecond.closed).toBe(true);
    await installation.db.query(
      "UPDATE preview_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",
      [createHash('sha256').update(preview.token).digest('hex')],
    );
    await save(admin, installation.origin, rootId, rootLease, 'Recheck revoked preview');
    await expect.poll(previewPeer.closed).toBe(true);

    const frozen = await read();
    const localTime = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
    const scheduled = await admin.request.post(base + '/schedules', {
      headers,
      data: {
        requestId: randomUUID(),
        checkpointId: frozen.checkpointId,
        localTime,
        timezone: 'UTC',
        dueAt: localTime + ':00.000Z',
        expectedScheduleId: null,
        expectedRevision: null,
      },
    });
    expect(scheduled.ok(), await scheduled.text()).toBe(true);
    const job = await scheduled.json();
    await save(admin, installation.origin, rootId, rootLease, 'Later draft remains private');
    const publicationPeer = await peer(admin, replica.origin);
    await installation.db.query(
      "UPDATE publication_schedules SET due_at=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [job.id],
    );
    await expect
      .poll(
        async () =>
          (
            await installation.db.query('SELECT status FROM publication_schedules WHERE id=$1', [
              job.id,
            ])
          ).rows[0].status,
        { timeout: 75000, intervals: [250, 1000] },
      )
      .toBe('published');
    for (const subscriber of [onFirst, publicationPeer])
      await expect
        .poll(() =>
          subscriber.messages.some((message) => message.snapshot?.locale.publishedVersionId),
        )
        .toBeTruthy();
    const publications = await installation.db.query(
      'SELECT content FROM publications WHERE checkpoint_id=$1',
      [frozen.checkpointId],
    );
    expect(publications.rows).toHaveLength(1);
    expect(JSON.stringify(publications.rows[0])).not.toContain('Later draft remains private');
    expect((await read()).blocks.find((block) => block.id === rootId)?.fields.title).toBe(
      'Later draft remains private',
    );
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        read(admin, index % 2 ? replica.origin : installation.origin),
      ),
    );
    rootLease = await acquire(admin, installation.origin, rootId);
    await publicationPeer.page.close();
    await onFirst.page.close();
    const exited = once(replica.process, 'exit');
    replica.process.kill('SIGKILL');
    await exited;
    await save(admin, installation.origin, rootId, rootLease, 'Saved without local subscribers');
    const restarted = await installation.startReplica();
    const recovered = await peer(admin, restarted.origin);
    expect(
      recovered.messages[0].snapshot?.blocks.find((block) => block.id === rootId)?.fields.title,
    ).toBe('Saved without local subscribers');
    await save(
      admin,
      installation.origin,
      rootId,
      rootLease,
      'Notified from a process with no subscribers',
    );
    await expect
      .poll(() =>
        recovered.messages.some((message) =>
          message.snapshot?.blocks.some(
            (block) => block.fields.title === 'Notified from a process with no subscribers',
          ),
        ),
      )
      .toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await installation.close();
  }
});
