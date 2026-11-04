import { describe, expect, it } from 'vitest';
import { assertOrigin, readJson } from './http';

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
});
