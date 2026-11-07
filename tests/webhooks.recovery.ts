import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type {
  CommitResult,
  LocaleSnapshot,
  Story,
  StoryLocale,
  WebhookDelivery,
  WebhookEvent,
} from '@storypane/core';
import { webhookInstallation } from './fixtures/webhook-installation';

test('signed HTTPS deliveries survive queued retries and a crash after receiver acceptance', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fixture = await webhookInstallation();
  const received: { body: string; id: string; timestamp: string; signature: string }[] = [];
  const effects = new Map<string, string>();
  const failures: string[] = [];
  const held: ServerResponse[] = [];
  const path = '/webhook/' + randomUUID();
  let secret = '',
    token = '',
    responseStatus = 503,
    hold = false;
  fixture.receiver.on('request', async (incoming, outgoing) => {
    if (incoming.url !== path) {
      outgoing.writeHead(404).end();
      return;
    }
    if (incoming.method === 'GET') {
      outgoing.writeHead(204).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 32768) throw new Error('Oversized test webhook');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const timestamp = String(incoming.headers['webhook-timestamp'] ?? '');
      const signature = String(incoming.headers['webhook-signature'] ?? '');
      // Independent HMAC verification, rather than reusing the sender's signing implementation.
      const expected =
        'v1=' +
        createHmac('sha256', secret)
          .update(timestamp + '.' + body)
          .digest('hex');
      const valid =
        signature.length === expected.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) &&
        Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
      if (!valid) {
        outgoing.writeHead(401).end();
        return;
      }
      const event = JSON.parse(body) as WebhookEvent;
      expect(incoming.headers['webhook-id']).toBe(event.id);
      expect(event.spaceId).toBe(fixture.spaceId);
      expect(body.includes(secret)).toBe(false);
      if (token) expect(body.includes(token)).toBe(false);
      received.push({ body, id: event.id, timestamp, signature });
      if (event.type === 'story.published' && !effects.has(event.id)) {
        const published = await fetch(
          fixture.origin + `/api/delivery/stories?space=${fixture.spaceId}`,
          { headers: { Authorization: 'Bearer ' + token } },
        );
        expect(published.status).toBe(200);
        effects.set(event.id, await published.text());
      }
      if (hold) {
        held.push(outgoing);
        return;
      }
      outgoing
        .writeHead(responseStatus)
        .end('receiver response must never appear in delivery logs');
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      outgoing.writeHead(500).end();
    }
  });
  const headers = { Origin: fixture.origin, 'x-storypane-space-id': fixture.spaceId };
  async function api<T>(client: APIRequestContext, path: string, data?: unknown): Promise<T> {
    const r = await client.fetch(fixture.origin + '/api/cms' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers,
      data,
    });
    expect(r.ok(), `${path}: HTTP ${r.status()}`).toBe(true);
    return r.json();
  }
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(fixture.destination + path, { signal: AbortSignal.timeout(5000) }))
              .status;
          } catch {
            return 0;
          }
        },
        { timeout: 60_000 },
      )
      .toBe(204);
    await page.goto(fixture.origin);
    await page.getByLabel('Email', { exact: true }).fill(fixture.email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect
      .poll(async () => (await page.request.get(fixture.origin + '/api/session')).status())
      .toBe(200);
    await page.goto(fixture.origin + '/?space=' + fixture.spaceId);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Webhooks', exact: true })
      .click();
    await page.getByRole('button', { name: 'New webhook' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create webhook' });
    await dialog.getByLabel('Name', { exact: true }).fill('Operational receiver');
    await dialog.getByLabel('Endpoint URL').fill(fixture.destination + path);
    await dialog.getByRole('button', { name: 'Save webhook' }).click();
    const secretDialog = page.getByRole('dialog', { name: 'Save your webhook secret' });
    secret = await secretDialog.getByLabel('Signing secret').inputValue();
    expect(secret.startsWith('whsec_')).toBe(true);
    await secretDialog.getByRole('button', { name: 'Done' }).click();
    const {
      endpoints: [endpoint],
    } = await api<{ endpoints: { id: string }[] }>(page.request, '/webhooks');
    const deliveries = async () =>
      (
        await api<{ deliveries: WebhookDelivery[] }>(
          page.request,
          `/webhooks/${endpoint.id}/deliveries`,
        )
      ).deliveries;
    const refresh = async () => page.getByRole('button', { name: 'Refresh deliveries' }).click();
    await page.getByRole('button', { name: 'Send test' }).click();
    await expect.poll(async () => (await deliveries()).length).toBe(1);
    await fixture.restart();
    await expect
      .poll(async () => (await deliveries())[0]?.status, { timeout: 20_000 })
      .toBe('pending');
    const queued = (await deliveries())[0];
    expect(queued).toMatchObject({
      type: 'webhook.test',
      attemptCount: 1,
      httpStatus: 503,
      completedAt: null,
    });
    expect(Date.parse(queued.nextAttemptAt)).toBeGreaterThan(Date.now());
    await refresh();
    const logs = page.getByRole('dialog', { name: 'Deliveries · Operational receiver' });
    await expect(logs.getByText('pending', { exact: true })).toBeVisible();
    await expect(logs.getByRole('button', { name: 'Retry delivery' })).toHaveCount(0);
    responseStatus = 204;
    await fixture.restart();
    // Use the real retry delay and minute scheduler; no database clock or due-time rewrites.
    await expect
      .poll(async () => (await deliveries()).find((d) => d.id === queued.id)?.status, {
        timeout: 90_000,
        intervals: [1000],
      })
      .toBe('succeeded');
    const succeeded = (await deliveries()).find((d) => d.id === queued.id)!;
    expect(succeeded).toMatchObject({ eventId: queued.eventId, attemptCount: 2, httpStatus: 204 });
    expect(succeeded.attempts.map((a) => a.httpStatus)).toEqual([503, 204]);
    expect(received).toHaveLength(2);
    expect(received[1].body).toBe(received[0].body);
    expect(received[1].id).toBe(received[0].id);
    expect(Number(received[1].timestamp)).toBeGreaterThan(Number(received[0].timestamp));
    expect(received[1].signature).not.toBe(received[0].signature);
    await refresh();
    await expect(logs.getByText('succeeded', { exact: true })).toBeVisible();
    await logs.getByRole('button', { name: 'Close dialog', exact: true }).click();

    token = (
      await api<{ token: string }>(page.request, '/delivery-tokens', {
        name: 'Receiver build',
        scope: 'published',
      })
    ).token;
    const [story] = await api<Story[]>(page.request, '/stories');
    const [locale] = await api<StoryLocale[]>(page.request, `/stories/${story.id}/locales`);
    const base = `/stories/${story.id}/locales/${locale.id}`;
    async function save(title: string) {
      const snapshot = await api<LocaleSnapshot>(page.request, base);
      const block = snapshot.blocks.find((b) => typeof b.fields.title === 'string')!;
      const lease = await api<{ token: string }>(page.request, base + '/leases', {
        blockId: block.id,
      });
      try {
        return await api<CommitResult>(page.request, base + '/commands', {
          type: 'saveBlock',
          mutationId: randomUUID(),
          expectedRevisions: { [block.id]: block.revision },
          leaseTokens: { [block.id]: lease.token },
          payload: { blockId: block.id, fields: { ...block.fields, title } },
        });
      } finally {
        expect(
          (
            await page.request.delete(fixture.origin + '/api/cms' + base + '/leases', {
              headers,
              data: { blockId: block.id, token: lease.token },
            })
          ).ok(),
        ).toBe(true);
      }
    }
    const approved = await save('APPROVED PUBLICATION');
    await api(page.request, base + '/commands', {
      type: 'publishCheckpoint',
      mutationId: randomUUID(),
      expectedRevisions: {},
      leaseTokens: {},
      payload: { checkpointId: approved.checkpointId },
    });
    await save('LATER PRIVATE DRAFT');
    hold = true;
    await fixture.restart();
    await expect.poll(() => held.length, { timeout: 20_000 }).toBe(1);
    const publishing = (await deliveries()).find((d) => d.type === 'story.published')!;
    expect(publishing.status).toBe('delivering');
    expect(effects.size).toBe(1);
    expect([...effects.values()][0]).toContain('APPROVED PUBLICATION');
    expect([...effects.values()][0]).not.toContain('LATER PRIVATE DRAFT');
    hold = false;
    await fixture.restart(); // SIGKILL after acceptance, before the sender records a response.
    held.forEach((response) => response.end());
    await expect
      .poll(async () => (await deliveries()).find((d) => d.id === publishing.id)?.status, {
        timeout: 90_000,
        intervals: [1000],
      })
      .toBe('succeeded');
    const recovered = (await deliveries()).find((d) => d.id === publishing.id)!;
    expect(recovered).toMatchObject({
      eventId: publishing.eventId,
      attemptCount: 2,
      httpStatus: 204,
    });
    expect(recovered.attempts[0].error).toContain('interrupted');
    const publicationRequests = received.filter((r) => r.id === publishing.eventId);
    expect(publicationRequests).toHaveLength(2);
    expect(publicationRequests[1].body).toBe(publicationRequests[0].body);
    expect(effects.size).toBe(1);
    expect((await deliveries()).map((d) => d.type).sort()).toEqual([
      'story.published',
      'webhook.test',
    ]);
    expect(JSON.stringify(await deliveries())).not.toContain(secret);
    expect(JSON.stringify(await deliveries())).not.toContain('receiver response must never');
    expect(failures).toEqual([]);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.getByRole('button', { name: 'Delivery logs', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(logs).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(logs).not.toBeVisible();
  } finally {
    held.forEach((response) => response.end());
    await fixture.close();
  }
});
