import 'server-only';
import { cache } from 'react';
import { createStorypaneClient } from '@storypane/sdk';
import { storypaneMigrationVersion } from '../../../example-astro/src/types/storypane';
import { fetchPublishedStories,pageEntries } from '../../../example-astro/src/lib/publications';

export const cmsUrl = (process.env.STORYPANE_URL ?? process.env.BLOK_URL) || 'http://127.0.0.1:3130';
export const spaceId = (process.env.STORYPANE_SPACE_ID ?? process.env.BLOK_SPACE_ID) || '';
export const previewParameter = process.env.STORYPANE_PREVIEW_PARAMETER || 'blok_preview';
export function deliveryClient() {
  const token = process.env.STORYPANE_DELIVERY_TOKEN ?? process.env.BLOK_DELIVERY_TOKEN;
  if (!spaceId || !token) throw new Error('Configure apps/example-next/.env or run pnpm example:setup:next first.');
  // Each build must read fresh publications rather than Next's persistent fetch cache.
  return createStorypaneClient({ url:cmsUrl,spaceId,migrationVersion:storypaneMigrationVersion,token,fetch:(input,init) => fetch(input,{ ...init,cache:'no-store' }) });
}
export const publishedStories = cache(() => fetchPublishedStories(deliveryClient()));
export const publishedPages = cache(async () => pageEntries(await publishedStories()));
