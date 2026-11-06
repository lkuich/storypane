import type { createStorypaneClient, StorypaneLocale, StorypaneStory } from '@storypane/sdk';
import type { StorypaneContentType } from '../types/storypane';
import { referencesFor } from './content';

export async function fetchPublishedStories(client: ReturnType<typeof createStorypaneClient>) {
  const locales = await client.listLocales();
  const stories = await Promise.all(
    locales.map(({ slug: locale, isDefault }) =>
      isDefault
        ? client.listAllStories<StorypaneContentType>()
        : client.listAllStories<StorypaneContentType>({ locale }),
    ),
  );
  return { locales, stories: stories.flat() };
}
export function pageEntries(
  stories: StorypaneStory<StorypaneContentType>[],
  locales: Pick<StorypaneLocale, 'slug' | 'isDefault'>[],
) {
  const paths = new Set<string>();
  const localePrefixes = new Set(locales.map(({ slug }) => slug).filter(Boolean));
  return stories.map((story) => {
    const path = [story.locale, story.slug].filter(Boolean).join('/');
    if (!path || !/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(path) || paths.has(path))
      throw new Error(`Invalid or duplicate page path: ${path}`);
    const prefix = path.split('/')[0]!;
    if (['preview', 'media', '_astro'].includes(prefix))
      throw new Error(`Reserved story path: ${path}`);
    if (!story.locale && localePrefixes.has(prefix))
      throw new Error(`Story path conflicts with a locale: ${path}`);
    paths.add(path);
    return {
      params: { path },
      props: {
        story,
        references: referencesFor(
          stories,
          story.locale,
          locales.find((locale) => locale.isDefault)?.slug,
        ),
      },
    };
  });
}
