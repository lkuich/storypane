import type { StorypaneLink, StorypaneStory } from '@storypane/sdk';
import type { FooterBlock } from '../types/storypane';

export type SiteReferences = {
  paths: Record<string, string>;
  footers: Record<string, FooterBlock>;
};

export function referencesFor(
  stories: StorypaneStory<{ _uid: string; component: string }>[],
  locale: string,
): SiteReferences {
  const references: SiteReferences = { paths: {}, footers: {} };
  // Prefer the current locale, with Default as the fallback for shared stories.
  for (const story of [
    ...stories.filter((item) => item.locale === ''),
    ...stories.filter((item) => item.locale === locale),
  ]) {
    references.paths[story.id] =
      '/' +
      [story.locale, story.slug]
        .filter(Boolean)
        .join('/')
        .split('/')
        .map(encodeURIComponent)
        .join('/');
    if (story.content.component === 'footer') {
      references.footers[story.id] = story.content as FooterBlock;
    }
  }
  return references;
}

export function assetPath(id: string): string {
  return `/media/${encodeURIComponent(id)}`;
}

export function assetIds(value: unknown): string[] {
  const ids = new Set<string>();
  function visit(item: unknown) {
    if (!item || typeof item !== 'object') {
      return;
    }
    if ('assetId' in item && typeof item.assetId === 'string') {
      ids.add(item.assetId);
    }
    for (const child of Object.values(item)) {
      visit(child);
    }
  }
  visit(value);
  return [...ids];
}

export function linkHref(
  link: StorypaneLink | null | undefined | '',
  paths: SiteReferences['paths'],
): string | undefined {
  if (!link) {
    return;
  }
  if (link.type === 'story') {
    return paths[link.storyId];
  }
  if (link.type === 'asset') {
    return assetPath(link.assetId);
  }
  if (link.type === 'email') {
    return `mailto:${link.email}`;
  }
  try {
    const url = new URL(link.url);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    /* Incomplete draft links do not become clickable. */
  }
}
