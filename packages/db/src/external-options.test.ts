import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:dns/promises', () => ({ resolve4: vi.fn(), resolve6: vi.fn() }));
import { resolve4, resolve6 } from 'node:dns/promises';
import { fetchExternalOptions, isPublicAddress } from './external-options.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(response: Response) {
  vi.mocked(resolve4).mockResolvedValue(['93.184.215.14'] as never);
  vi.mocked(resolve6).mockResolvedValue([] as never);
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
describe('external option sources', () => {
  it('rejects loopback, private, reserved and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.2',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.1.1',
      '0.0.0.0',
      '224.0.0.1',
      '198.18.0.1',
      '192.0.2.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
    ])
      expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress('93.184.215.14')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('allows only deployment-approved HTTPS hosts and rejects credentials or custom ports', async () => {
    const fetchMock = setup(Response.json({ items: [] }));
    for (const url of [
      'http://example.com/options',
      'https://other.example/options',
      'https://user:pass@example.com/options',
      'https://example.com:8080/options',
      'https://127.0.0.1/options',
    ])
      await expect(fetchExternalOptions(url, ['example.com', '127.0.0.1'])).rejects.toMatchObject({
        code: 'invalid',
      });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a private DNS answer even alongside a public address', async () => {
    const fetchMock = setup(Response.json({ items: [] }));
    vi.mocked(resolve4).mockResolvedValue(['93.184.215.14', '10.0.0.1'] as never);
    await expect(
      fetchExternalOptions('https://example.com/options', ['example.com']),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('validates the option contract and never follows redirects', async () => {
    const fetchMock = setup(Response.json({ items: [{ value: 'a', label: 'A' }] }));
    await expect(
      fetchExternalOptions('https://example.com/options', ['example.com']),
    ).resolves.toEqual([{ value: 'a', label: 'A' }]);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1' } }),
    );
    await expect(
      fetchExternalOptions('https://example.com/options', ['example.com']),
    ).rejects.toMatchObject({ code: 'invalid' });
    fetchMock.mockResolvedValue(
      Response.json({
        items: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'Duplicate' },
        ],
      }),
    );
    await expect(
      fetchExternalOptions('https://example.com/options', ['example.com']),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('accepts existing name/value feeds while retaining item and uniqueness validation', async () => {
    const fetchMock = setup(Response.json([{ value: 11, name: 'Course' }]));
    await expect(
      fetchExternalOptions('https://example.com/options', ['example.com']),
    ).resolves.toEqual([{ value: '11', label: 'Course' }]);
    for (const items of [
      [
        { value: 11, name: 'A' },
        { value: '11', name: 'B' },
      ],
      [{ value: { id: 11 }, name: 'Bad' }],
      [{ value: 11, name: 'x'.repeat(501) }],
    ]) {
      fetchMock.mockResolvedValue(Response.json(items));
      await expect(
        fetchExternalOptions('https://example.com/options', ['example.com']),
      ).rejects.toMatchObject({ code: 'invalid' });
    }
  });
  it('bounds the streamed response even without a content-length header', async () => {
    setup(
      new Response(JSON.stringify({ items: [{ value: 'x', label: 'x'.repeat(513_000) }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      fetchExternalOptions('https://example.com/options', ['example.com']),
    ).rejects.toMatchObject({ code: 'invalid', message: 'External source is too large' });
  });
});
