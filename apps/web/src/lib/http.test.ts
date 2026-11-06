import { describe, expect, it, vi } from 'vitest';
import { assertOrigin, readJson, errorResponse } from './http';

describe('CMS request boundary', () => {
  it('rejects cross-origin and missing-origin writes', () => {
    expect(() =>
      assertOrigin(
        new Request('http://localhost/api', { headers: { origin: 'https://attacker.example' } }),
        'http://localhost',
      ),
    ).toThrow();
    expect(() => assertOrigin(new Request('http://localhost/api'), 'http://localhost')).toThrow();
    expect(() =>
      assertOrigin(
        new Request('http://localhost/api', { headers: { origin: 'http://localhost' } }),
        'http://localhost',
      ),
    ).not.toThrow();
  });
  it('bounds actual JSON bytes rather than trusting Content-Length', async () => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) }),
    });
    await expect(readJson(request)).rejects.toThrow('2 MiB');
  });
  it('rejects malformed JSON and accepts valid content', async () => {
    const make = (body: string) =>
      new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    await expect(readJson(make('{'))).rejects.toThrow('Malformed');
    await expect(readJson(make('{"title":"Hero"}'))).resolves.toEqual({ title: 'Hero' });
  });
  it('times out and cancels a body even when its source never finishes cancelling', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel,
    });
    try {
      const result = expect(
        readJson({
          headers: new Headers({ 'content-type': 'application/json' }),
          body,
        }),
      ).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('reports Clerk throttling as a retryable service failure', async () => {
  const response = errorResponse({ clerkError: true, status: 429, retryAfter: 2 });
  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('2');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    error: {
      code: 'unavailable',
      message: 'The sign-in service is busy. Please try again shortly.',
    },
  });
});
