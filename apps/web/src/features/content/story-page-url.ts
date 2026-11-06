import { defaultPreview, type UserDeliverySettings } from '@storypane/core';

export function storyPageUrl(
  settings: UserDeliverySettings | null,
  path: string,
): string | undefined {
  const target = settings ? defaultPreview(settings) : undefined;
  if (!target) return;
  // Preview routes can be /preview?slug=…; page links use the app origin and actual content path.
  const origin = new URL(target.url).origin;
  return new URL(`/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`, origin)
    .href;
}
