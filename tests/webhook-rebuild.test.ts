import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRebuildReceiver } from '../scripts/webhook-rebuild';
import { signWebhook } from '../packages/db/src/webhook-transport';

let directory: string;
const secret = 'whsec_example_test',
  spaceId = randomUUID();
const now = 1_800_000_000_000;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'storypane-build-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function request(id = randomUUID(), type = 'story.published', timestamp = now) {
  const body = JSON.stringify({
    version: 1,
    id,
    type,
    spaceId,
    occurredAt: new Date(timestamp).toISOString(),
    data: {},
  });
  const seconds = String(Math.floor(timestamp / 1000));
  return new Request('https://site.example.com/webhook', {
    method: 'POST',
    body,
    headers: {
      'Webhook-Id': id,
      'Webhook-Timestamp': seconds,
      'Webhook-Signature': await signWebhook(secret, seconds, body),
    },
  });
}
describe('static site webhook receiver example', () => {
  it('persists accepted work across restart and deduplicates events before building', async () => {
    const build = vi.fn(async () => {}),
      databasePath = join(directory, 'queue.sqlite');
    const original = createRebuildReceiver({
      databasePath,
      secret,
      spaceId,
      build,
      now: () => now,
    });
    const id = randomUUID();
    expect((await original.receive(await request(id))).status).toBe(202);
    expect(build).not.toHaveBeenCalled();
    await original.close();
    const restarted = createRebuildReceiver({
      databasePath,
      secret,
      spaceId,
      build,
      now: () => now,
    });
    try {
      expect((await restarted.receive(await request(id))).status).toBe(202);
      await Promise.all([restarted.runPending(), restarted.runPending()]);
      expect(build).toHaveBeenCalledOnce();
      expect((await restarted.receive(await request(id))).status).toBe(202);
      await restarted.runPending();
      expect(build).toHaveBeenCalledOnce();
      expect((await restarted.receive(await request(randomUUID(), 'webhook.test'))).status).toBe(
        202,
      );
      await restarted.runPending();
      expect(build).toHaveBeenCalledOnce();
    } finally {
      await restarted.close();
    }
  });
  it('retries failed builds from durable state independently of outbound delivery', async () => {
    let clock = now;
    const build = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('build failed'))
      .mockResolvedValue(undefined);
    const receiver = createRebuildReceiver({
      databasePath: join(directory, 'queue.sqlite'),
      secret,
      spaceId,
      build,
      now: () => clock,
    });
    try {
      await receiver.receive(await request());
      await receiver.runPending();
      await receiver.runPending();
      expect(build).toHaveBeenCalledOnce();
      clock += 60_000;
      await receiver.runPending();
      expect(build).toHaveBeenCalledTimes(2);
    } finally {
      await receiver.close();
    }
  });
  it('rejects tampering, stale replay, mismatched IDs and oversized bodies', async () => {
    const build = vi.fn(async () => {});
    const receiver = createRebuildReceiver({
      databasePath: join(directory, 'queue.sqlite'),
      secret,
      spaceId,
      build,
      now: () => now,
    });
    try {
      const signed = await request(),
        body = await signed.text();
      expect(
        (
          await receiver.receive(
            new Request(signed.url, { method: 'POST', headers: signed.headers, body: body + ' ' }),
          )
        ).status,
      ).toBe(401);
      expect(
        (await receiver.receive(await request(randomUUID(), 'story.published', now - 301_000)))
          .status,
      ).toBe(401);
      const mismatch = await request();
      mismatch.headers.set('Webhook-Id', randomUUID());
      expect((await receiver.receive(mismatch)).status).toBe(400);
      expect(
        (
          await receiver.receive(
            new Request(signed.url, { method: 'POST', body: 'x'.repeat(32_769) }),
          )
        ).status,
      ).toBe(413);
      await receiver.runPending();
      expect(build).not.toHaveBeenCalled();
    } finally {
      await receiver.close();
    }
  });
});
