import type { StorypaneLocale, StorypaneStory, StoryReference } from '@storypane/sdk';

/** This app uses /home for Default and /fr/home for French, including nested slugs. */
export function referenceForPath(path: string[], locales: StorypaneLocale[]): StoryReference {
  const locale = locales.find((locale) => locale.slug !== '' && locale.slug === path[0]);

  if (locale) {
    return { locale: locale.slug, slug: path.slice(1).join('/') };
  }

  return { locale: '', slug: path.join('/') };
}

export function staticStoryParams(
  stories: Pick<StorypaneStory, 'slug' | 'locale'>[],
  locales: Pick<StorypaneLocale, 'slug'>[],
) {
  const seen = new Set<string>();
  const localePrefixes = locales.map((locale) => locale.slug).filter(Boolean);

  return stories.map((story) => {
    const path = [story.locale, story.slug].filter(Boolean).join('/');
    const segments = path.split('/');
    const prefix = segments[0];
    const hasInvalidCharacters = /[^\p{L}\p{N}_/-]/u.test(path);
    const hasEmptySegments = segments.includes('');

    if (hasInvalidCharacters || hasEmptySegments) {
      throw new Error(`Invalid story path: ${path}`);
    }

    if (['preview', 'media', '_next'].includes(prefix)) {
      throw new Error(`Reserved story path: ${path}`);
    }

    if (seen.has(path)) {
      throw new Error(`Found a duplicate story path: ${path}`);
    }

    if (!story.locale && localePrefixes.includes(prefix)) {
      throw new Error(`Story path conflicts with a locale: ${path}`);
    }

    seen.add(path);
    return { path: segments };
  });
}
