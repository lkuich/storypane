import type { createStorypaneClient,StorypaneStory } from '@storypane/sdk';
import type { StorypaneContentType } from '../types/storypane';
import { referencesFor } from './content';

export async function fetchPublishedStories(client:ReturnType<typeof createStorypaneClient>) {
  const locales = await client.listLocales();
  const stories:StorypaneStory<StorypaneContentType>[] = [];
  for (const { slug:locale } of locales) {
    let offset:number | null = 0;
    while (offset !== null) {
      const page:{ stories:StorypaneStory<StorypaneContentType>[]; nextOffset:number | null } = await client.listStories<StorypaneContentType>({ locale,offset,limit:100 });
      stories.push(...page.stories); offset = page.nextOffset;
    }
  }
  return stories;
}
export function pageEntries(stories:StorypaneStory<StorypaneContentType>[]) {
  const paths = new Set<string>();
  return stories.map(story => {
    const path = [story.locale,story.slug].filter(Boolean).join('/');
    if (!path || path === 'preview' || !/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(path) || paths.has(path)) throw new Error(`Invalid, reserved, or duplicate page path: ${path}`);
    paths.add(path);
    return { params:{ path },props:{ story,references:referencesFor(stories,story.locale) } };
  });
}
