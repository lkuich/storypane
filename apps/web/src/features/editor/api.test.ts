import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, fieldName, jsonRequest } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('editor API failures', () => {
  it('treats a truncated success response as unconfirmed, so the same mutation can retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"snapshot":', { status: 200 })),
    );
    await expect(api('/commands')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('creates field names that start with a letter', () => {
    expect(fieldName('123 Hero Banner')).toBe('hero_banner');
    expect(fieldName('Main heading!')).toBe('main_heading');
    expect(fieldName('123')).toBe('');
  });
  it('keeps field validation errors available to the editor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'invalid',
              message: 'Invalid field values',
              details: [{ path: 'title', message: 'Maximum 20 characters' }],
            },
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(api('/story/commands', jsonRequest('POST', {}))).rejects.toMatchObject({
      code: 'invalid',
      details: [{ path: 'title', message: 'Maximum 20 characters' }],
    });
  });
  it('does not mistake a failed non-JSON response for a saved mutation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Upstream unavailable', { status: 502 })),
    );
    await expect(api('/commands')).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Request failed (502)',
    });
  });
  it('distinguishes a lost connection from a rejected mutation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
    await expect(api('/commands')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/commands')).rejects.toMatchObject({ code: 'network' });
  });
  it('requests fresh authenticated state after reconnecting', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 8 })));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/stories/a/locales/b')).resolves.toEqual({ revision: 8 });
    expect(fetch).toHaveBeenCalledWith(
      '/api/cms/stories/a/locales/b',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
  });
});
