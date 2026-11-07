import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  newWebhookSecret,
  sendWebhook,
  signWebhook,
  validateWebhookUrl,
  verifyWebhookSignature,
  webhookEncryptionConfigured,
} from './webhook-transport.js';

const key = Buffer.alloc(32, 7).toString('base64');
const secret = newWebhookSecret();
const body = '{"id":"event-1","data":{"path":"/café"}}';
const now = 1_800_000_000_000;
const allowedHosts = ['hooks.example.com'];
const endpoint = { url: 'https://hooks.example.com/rebuild', secret };
const event = { id: 'event-1', body };
const publicDns = async () => ['8.8.8.8', '2606:4700:4700::1111'];
afterEach(() => vi.restoreAllMocks());

describe('webhook signing and secret storage', () => {
  it('encrypts separately per endpoint and rejects altered key/context/ciphertext', async () => {
    const encrypted = await encryptWebhookSecret(secret, key, 'space:endpoint');
    expect(encrypted).not.toContain(secret);
    expect(await encryptWebhookSecret(secret, key, 'space:endpoint')).not.toBe(encrypted);
    expect(await decryptWebhookSecret(encrypted, key, 'space:endpoint')).toBe(secret);
    for (const [cipher, encryptionKey, context] of [
      [encrypted, key, 'other:endpoint'],
      [encrypted, Buffer.alloc(32, 8).toString('base64'), 'space:endpoint'],
      [encrypted.slice(0, -4) + 'xxxx', key, 'space:endpoint'],
    ])
      await expect(decryptWebhookSecret(cipher, encryptionKey, context)).rejects.toMatchObject({
        code: 'unavailable',
      });
    expect(webhookEncryptionConfigured(undefined)).toBe(false);
    expect(webhookEncryptionConfigured('not-base64')).toBe(false);
    expect(webhookEncryptionConfigured(key)).toBe(true);
  });
  it('verifies exact bytes and rejects stale/future timestamps and tampering', async () => {
    const timestamp = String(now / 1000);
    const signature = await signWebhook(secret, timestamp, body);
    expect(await verifyWebhookSignature(secret, timestamp, body, signature, now)).toBe(true);
    expect(await verifyWebhookSignature(secret, timestamp, body + ' ', signature, now)).toBe(false);
    expect(await verifyWebhookSignature('wrong', timestamp, body, signature, now)).toBe(false);
    expect(await verifyWebhookSignature(secret, timestamp, body, signature, now + 301_000)).toBe(
      false,
    );
    expect(await verifyWebhookSignature(secret, timestamp, body, signature, now - 301_000)).toBe(
      false,
    );
    expect(await verifyWebhookSignature(secret, timestamp, body, 'v2=bad', now)).toBe(false);
  });
});
describe('bounded webhook transport', () => {
  it.each([
    'http://hooks.example.com',
    'https://hooks.example.com:444/',
    'https://a:b@hooks.example.com/',
    'https://hooks.example.com/#x',
    'https://unapproved.example.com/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://hooks.local/',
    'https://hooks.internal/',
    'https://hooks.example.com./',
  ])('rejects unsafe URL %s', (value) => {
    expect(() =>
      validateWebhookUrl(value, [
        ...allowedHosts,
        ...(value.includes('unapproved') ? [] : [new URL(value).hostname]),
      ]),
    ).toThrow();
  });
  it('signs a POST with stable identity, a fresh timestamp, and manual redirects', async () => {
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(init).toMatchObject({ method: 'POST', redirect: 'manual', body });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(headers.get('webhook-id')).toBe(event.id);
      expect(
        await verifyWebhookSignature(
          secret,
          headers.get('webhook-timestamp')!,
          body,
          headers.get('webhook-signature')!,
          now,
        ),
      ).toBe(true);
      return new Response(null, { status: 204 });
    });
    expect(
      await sendWebhook(endpoint, event, {
        allowedHosts,
        fetch: send,
        resolve: publicDns,
        now: () => now,
      }),
    ).toEqual({ httpStatus: 204, error: null, retryable: false });
    expect(send).toHaveBeenCalledOnce();
  });
  it.each([
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['169.254.169.254'],
    ['::1'],
    ['fc00::1'],
    ['8.8.8.8', '192.168.1.1'],
  ])('rejects private DNS answers %j', async (...addresses) => {
    const send = vi.fn<typeof fetch>();
    const result = await sendWebhook(endpoint, event, {
      allowedHosts,
      fetch: send,
      resolve: async () => addresses,
    });
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('private or reserved');
    expect(send).not.toHaveBeenCalled();
  });
  it('rechecks configuration after DNS and never sends a cancelled claim', async () => {
    const send = vi.fn<typeof fetch>();
    const result = await sendWebhook(endpoint, event, {
      allowedHosts,
      fetch: send,
      resolve: publicDns,
      beforeSend: async () => false,
    });
    expect(result.error).toBe('Webhook configuration changed');
    expect(send).not.toHaveBeenCalled();
  });
  it.each<[number, boolean, string | null]>([
    [200, false, null],
    [299, false, null],
    [301, false, 'redirects'],
    [400, false, 'HTTP 400'],
    [408, true, 'HTTP 408'],
    [429, true, 'HTTP 429'],
    [500, true, 'HTTP 500'],
  ])('handles HTTP %i', async (status, retryable, error) => {
    const result = await sendWebhook(endpoint, event, {
      allowedHosts,
      resolve: publicDns,
      fetch: async () => new Response('private response text', { status }),
    });
    expect(result.retryable).toBe(retryable);
    if (error) expect(result.error).toContain(error);
    else expect(result.error).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private response text');
  });
  it('clamps Retry-After and supports HTTP dates', async () => {
    for (const [header, milliseconds] of [
      ['9999999', 86_400_000],
      [new Date(now + 600_000).toUTCString(), 600_000],
    ] as const) {
      const result = await sendWebhook(endpoint, event, {
        allowedHosts,
        resolve: publicDns,
        now: () => now,
        fetch: async () => new Response(null, { status: 429, headers: { 'Retry-After': header } }),
      });
      expect(result.retryAfterMs).toBe(milliseconds);
    }
  });
  it.each(['0', '-1', 'not-a-date', 'Infinity', new Date(now - 60_000).toUTCString()])(
    'ignores invalid or expired Retry-After %s',
    async (header) => {
      const result = await sendWebhook(endpoint, event, {
        allowedHosts,
        resolve: publicDns,
        now: () => now,
        fetch: async () => new Response(null, { status: 503, headers: { 'Retry-After': header } }),
      });
      expect(result).toMatchObject({ httpStatus: 503, retryable: true });
      expect(result.retryAfterMs).toBeUndefined();
    },
  );

  it('bounds response bytes with or without Content-Length', async () => {
    for (const headers of [{}, { 'Content-Length': '16385' }] as Record<string, string>[]) {
      const result = await sendWebhook(endpoint, event, {
        allowedHosts,
        resolve: publicDns,
        fetch: async () => new Response('x'.repeat(16385), { headers }),
      });
      expect(result).toMatchObject({ error: 'Webhook response exceeds 16 KiB', retryable: false });
    }
  });
  it.each(['dns', 'fetch', 'body'])(
    'times out stalled %s without leaking details',
    async (stalled) => {
      const controller = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
        expect(milliseconds).toBe(10_000);
        setTimeout(() => controller.abort(), 10);
        return controller.signal;
      });
      const pending = () => new Promise<never>(() => {});
      const result = await sendWebhook(endpoint, event, {
        allowedHosts,
        resolve: stalled === 'dns' ? pending : publicDns,
        fetch:
          stalled === 'fetch'
            ? pending
            : async () => new Response(new ReadableStream({ pull: pending })),
      });
      expect(result).toMatchObject({
        error: 'Webhook request failed or timed out',
        retryable: true,
      });
    },
  );
  it('sanitizes network errors and treats missing DNS as retryable', async () => {
    const result = await sendWebhook(endpoint, event, {
      allowedHosts,
      resolve: publicDns,
      fetch: async () => {
        throw new Error('sensitive body ' + secret);
      },
    });
    expect(result).toEqual({
      httpStatus: null,
      error: 'Webhook request failed or timed out',
      retryable: true,
    });
    expect(
      (await sendWebhook(endpoint, event, { allowedHosts, resolve: async () => [] })).retryable,
    ).toBe(true);
  });
});
