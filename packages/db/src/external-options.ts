import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { StorypaneError, optionItemSchema, type OptionItem } from '@storypane/core';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6)
    return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0|10|20):/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export async function fetchExternalOptions(
  urlString: string,
  allowedHosts: string[],
): Promise<OptionItem[]> {
  const url = new URL(urlString);
  const host = url.hostname.toLowerCase();
  // Only operator-approved domains can control DNS for an outbound source.
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !allowedHosts.map((v) => v.toLowerCase()).includes(host) ||
    isIP(host.replace(/^\[|\]$/g, '')) ||
    !host.includes('.') ||
    /(?:\.local|\.localhost|\.internal|\.test|\.invalid|\.home\.arpa)$/.test(host)
  )
    throw new StorypaneError(
      'invalid',
      'External sources require an approved public HTTPS hostname',
    );
  let addresses: string[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      Promise.allSettled([resolve4(host), resolve6(host)]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), 5000);
      }),
    ]);
    addresses = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  } catch {
    throw new StorypaneError('unavailable', 'Could not resolve the external source');
  } finally {
    clearTimeout(timer);
  }
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address)))
    throw new StorypaneError(
      'invalid',
      'External sources cannot resolve to private or reserved networks',
    );
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (response.status >= 300 && response.status < 400)
      throw new StorypaneError('invalid', 'External source redirects are not allowed');
    if (!response.ok)
      throw new StorypaneError('unavailable', 'The external source returned an error');
    if (!response.headers.get('content-type')?.includes('json'))
      throw new StorypaneError('invalid', 'External source must return JSON');
    if (Number(response.headers.get('content-length') ?? 0) > 512_000)
      throw new StorypaneError('invalid', 'External source is too large');
    const reader = response.body?.getReader();
    if (!reader) throw new StorypaneError('invalid', 'External source returned an empty response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 512_000) throw new StorypaneError('invalid', 'External source is too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed = z
      .object({ items: z.array(optionItemSchema).max(1000) })
      .strict()
      .safeParse(JSON.parse(new TextDecoder().decode(data)));
    if (
      !parsed.success ||
      new Set(parsed.data.items.map((i) => i.value)).size !== parsed.data.items.length
    )
      throw new StorypaneError('invalid', 'Expected {items: [{value, label}]} with unique values');
    return parsed.data.items;
  } catch (error) {
    if (error instanceof StorypaneError) throw error;
    throw new StorypaneError(
      'unavailable',
      'External source is unavailable or returned invalid JSON',
    );
  }
}
