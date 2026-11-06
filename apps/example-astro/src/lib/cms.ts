import { createStorypaneClient } from '@storypane/sdk';
import { storypaneMigrationVersion } from '../types/storypane';
import { fetchPublishedStories, pageEntries } from './publications';

export const cmsUrl = import.meta.env.STORYPANE_URL || 'http://127.0.0.1:3130';
export const spaceId = import.meta.env.STORYPANE_SPACE_ID;
export function deliveryClient() {
  if (!spaceId || !import.meta.env.STORYPANE_DELIVERY_TOKEN) {
    throw new Error(
      'Configure apps/example-astro/.env or run pnpm --filter @storypane/example-astro setup first.',
    );
  }
  return createStorypaneClient({
    url: cmsUrl,
    spaceId,
    migrationVersion: storypaneMigrationVersion,
    token: import.meta.env.STORYPANE_DELIVERY_TOKEN,
  });
}
export const publishedStories = async () => (await fetchPublishedStories(deliveryClient())).stories;
export const publishedPages = async () => {
  const { stories, locales } = await fetchPublishedStories(deliveryClient());
  return pageEntries(stories, locales);
};
