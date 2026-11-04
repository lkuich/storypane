import { spaceHeaders, spaceUrl } from '../../lib/space-url';

export async function assetApi<T>(path = '', init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/cms/assets${path}`, {
    ...init,
    headers: {
      ...spaceHeaders(),
      ...(init?.body && typeof init.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(assetErrorMessage(result, `Asset request failed (${response.status})`));
  }
  return response.json() as Promise<T>;
}

export function assetErrorMessage(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === 'object' &&
    'error' in value &&
    value.error &&
    typeof value.error === 'object' &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  )
    return value.error.message;
  return fallback;
}

export function assetContentUrl(id: string) {
  return spaceUrl(`/api/cms/assets/${encodeURIComponent(id)}/content`);
}
export function assetThumbnailUrl(id: string, width: 160 | 320 | 640 | 1280 = 320) {
  return spaceUrl(`/api/cms/assets/${encodeURIComponent(id)}/thumbnail?width=${width}`);
}
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KiB`;
}
