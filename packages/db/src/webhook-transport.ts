import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import { StorypaneError } from '@storypane/core';
import { isPublicAddress } from './external-options.js';

const encoder = new TextEncoder();
const decodeKey = (value: string) => {
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (
    bytes.length !== 32 ||
    Buffer.from(bytes).toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')
  )
    throw new StorypaneError('unavailable', 'Webhook encryption is not configured');
  return bytes;
};
export function webhookEncryptionConfigured(value: string | undefined): boolean {
  try {
    decodeKey(value ?? '');
    return true;
  } catch {
    return false;
  }
}
export function newWebhookSecret(): string {
  return 'whsec_' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}
export async function encryptWebhookSecret(
  secret: string,
  encryptionKey: string,
  context: string,
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', decodeKey(encryptionKey), 'AES-GCM', false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(secret),
  );
  return (
    'v1.' +
    Buffer.from(iv).toString('base64url') +
    '.' +
    Buffer.from(encrypted).toString('base64url')
  );
}
export async function decryptWebhookSecret(
  value: string,
  encryptionKey: string,
  context: string,
): Promise<string> {
  try {
    const [version, nonce, body, extra] = value.split('.');
    if (version !== 'v1' || !nonce || !body || extra) throw new Error('Invalid ciphertext');
    const key = await crypto.subtle.importKey('raw', decodeKey(encryptionKey), 'AES-GCM', false, [
      'decrypt',
    ]);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(Buffer.from(nonce, 'base64url')),
        additionalData: encoder.encode(context),
      },
      key,
      new Uint8Array(Buffer.from(body, 'base64url')),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new StorypaneError(
      'unavailable',
      'Webhook secret could not be decrypted; check the configured encryption key',
    );
  }
}
export async function signWebhook(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return (
    'v1=' +
    Buffer.from(
      await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + body)),
    ).toString('hex')
  );
}
export async function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now(),
): Promise<boolean> {
  if (
    !/^\d{10,13}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^v1=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(Buffer.from(signature.slice(3), 'hex')),
    encoder.encode(timestamp + '.' + body),
  );
}

export function validateWebhookUrl(value: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorypaneError('invalid', 'Use an approved public HTTPS webhook URL');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    isIP(host.replace(/^\[|\]$/g, '')) ||
    !host.includes('.') ||
    host.endsWith('.') ||
    /(?:\.local|\.localhost|\.internal|\.test|\.invalid|\.home\.arpa)$/.test(host) ||
    !allowedHosts.some((item) => item.toLowerCase() === host)
  )
    throw new StorypaneError(
      'invalid',
      'Webhooks require an approved public HTTPS hostname without credentials or a fragment',
    );
  return url;
}
async function resolveHost(host: string): Promise<string[]> {
  const result = await Promise.allSettled([resolve4(host), resolve6(host)]);
  return result.flatMap((item) => (item.status === 'fulfilled' ? item.value : []));
}
async function beforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('Webhook timed out'));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
export type WebhookTransportOptions = {
  allowedHosts: string[];
  fetch?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  now?: () => number;
  beforeSend?: () => Promise<boolean>;
};
export type WebhookAttemptResult = {
  httpStatus: number | null;
  error: string | null;
  retryable: boolean;
  retryAfterMs?: number;
};
export async function sendWebhook(
  endpoint: { url: string; secret: string },
  event: { id: string; body: string },
  options: WebhookTransportOptions,
): Promise<WebhookAttemptResult> {
  let httpStatus: number | null = null;
  try {
    const url = validateWebhookUrl(endpoint.url, options.allowedHosts);
    const signal = AbortSignal.timeout(10_000);
    const addresses = await beforeAbort((options.resolve ?? resolveHost)(url.hostname), signal);
    if (!addresses.length)
      return { httpStatus: null, error: 'Webhook hostname could not be resolved', retryable: true };
    if (addresses.some((address) => !isPublicAddress(address)))
      return {
        httpStatus: null,
        error: 'Webhook hostname resolves to a private or reserved address',
        retryable: false,
      };
    const now = (options.now ?? Date.now)();
    const timestamp = String(Math.floor(now / 1000));
    const signature = await signWebhook(endpoint.secret, timestamp, event.body);
    if (options.beforeSend && !(await beforeAbort(options.beforeSend(), signal)))
      return { httpStatus: null, error: 'Webhook configuration changed', retryable: false };
    const response = await beforeAbort(
      (options.fetch ?? fetch)(url, {
        method: 'POST',
        redirect: 'manual',
        signal,
        body: event.body,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Storypane-Webhooks/1',
          'Webhook-Id': event.id,
          'Webhook-Timestamp': timestamp,
          'Webhook-Signature': signature,
        },
      }),
      signal,
    );
    httpStatus = response.status;
    const reader = response.body?.getReader();
    if (reader) {
      let bytes = 0;
      try {
        if (Number(response.headers.get('content-length') ?? 0) > 16_384)
          return { httpStatus, error: 'Webhook response exceeds 16 KiB', retryable: false };
        while (true) {
          const part = await beforeAbort(reader.read(), signal);
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 16_384)
            return { httpStatus, error: 'Webhook response exceeds 16 KiB', retryable: false };
        }
      } finally {
        await beforeAbort(reader.cancel(), signal).catch(() => {});
      }
    }
    if (httpStatus >= 200 && httpStatus < 300) return { httpStatus, error: null, retryable: false };
    const retryable = httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
    const retryAfter = response.headers.get('retry-after');
    let retryAfterMs: number | undefined;
    if (retryable && retryAfter) {
      const milliseconds = /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter) - now;
      if (Number.isFinite(milliseconds) && milliseconds > 0)
        retryAfterMs = Math.min(milliseconds, 86_400_000);
    }
    return {
      httpStatus,
      error:
        httpStatus >= 300 && httpStatus < 400
          ? 'Webhook redirects are not allowed'
          : 'Webhook returned HTTP ' + httpStatus,
      retryable,
      retryAfterMs,
    };
  } catch (error) {
    if (error instanceof StorypaneError)
      return { httpStatus, error: error.message, retryable: false };
    return { httpStatus, error: 'Webhook request failed or timed out', retryable: true };
  }
}
