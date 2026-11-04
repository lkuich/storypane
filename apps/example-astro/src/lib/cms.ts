import { createStorypaneClient } from '@storypane/sdk';
import type { StorypaneStory } from '@storypane/sdk';
import type { StorypaneContentType } from '../types/storypane';

export const cmsUrl = (import.meta.env.STORYPANE_URL ?? import.meta.env.BLOK_URL) || 'http://127.0.0.1:3130';
export const spaceId = (import.meta.env.STORYPANE_SPACE_ID ?? import.meta.env.BLOK_SPACE_ID);
export async function publishedPages() {
  if (!spaceId || !(import.meta.env.STORYPANE_DELIVERY_TOKEN ?? import.meta.env.BLOK_DELIVERY_TOKEN)) throw new Error('Configure apps/example-astro/.env or run pnpm example:setup first.');
  const client = createStorypaneClient({ url:cmsUrl,spaceId,token:(import.meta.env.STORYPANE_DELIVERY_TOKEN ?? import.meta.env.BLOK_DELIVERY_TOKEN) });
  const locales = await client.listLocales();
  const stories:StorypaneStory<StorypaneContentType>[] = [];
  for (const { slug:locale } of locales) {
    let offset:number | null = 0;
    while (offset !== null) {
      const page:{ stories:StorypaneStory<StorypaneContentType>[]; nextOffset:number | null } = await client.listStories<StorypaneContentType>({ locale,offset,limit:100 });
      stories.push(...page.stories); offset = page.nextOffset;
    }
  }
  const paths = new Set<string>();
  return stories.map(story => {
    const path = [story.locale,story.slug].filter(Boolean).join('/');
    if (!path || path === 'preview' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path) || paths.has(path)) throw new Error(`Invalid, reserved, or duplicate page path: ${path}`);
    paths.add(path);
    return { params:{ path },props:{ story } };
  });
}
