import 'server-only';
import { cache } from 'react';
import { createStorypaneClient } from '@storypane/sdk';
import { storypaneMigrationVersion, type StorypaneContentType } from '@/types/storypane';

export const cmsUrl = process.env.STORYPANE_URL || 'http://127.0.0.1:3130';
export const spaceId = process.env.STORYPANE_SPACE_ID!;
const token = process.env.STORYPANE_DELIVERY_TOKEN;
if (!spaceId || !token) {
  throw new Error('Set STORYPANE_SPACE_ID and STORYPANE_DELIVERY_TOKEN in .env.');
}

// This is the only authenticated client. Never import this file in a Client Component.
export const storypane = createStorypaneClient<StorypaneContentType>({
  url: cmsUrl,
  spaceId,
  token,
  migrationVersion: storypaneMigrationVersion,
  // Read fresh publications on each build; Next.js prerenders the resulting pages.
  fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
});

export const getLocales = cache(() => storypane.listLocales());

// The site index supplies static routes, story links, and shared footer content.
export const getPublishedStories = cache(async () => {
  const locales = await getLocales();
  const stories = await Promise.all(
    locales.map(({ slug }) => storypane.listAllStories({ locale: slug })),
  );
  return stories.flat();
});
