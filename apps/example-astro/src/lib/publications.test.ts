import { expect, it } from 'vitest';
import type { StorypaneStory } from '@storypane/sdk';
import type { StorypaneContentType } from '../types/storypane';
import { fetchPublishedStories, pageEntries } from './publications';

const story: StorypaneStory<StorypaneContentType> = {
  id: 'home',
  name: 'Home',
  slug: 'home',
  locale: '',
  localeId: 'default',
  revision: 1,
  publishedAt: '2026-11-04T00:00:00Z',
  content: { _uid: 'root', component: 'page', title: 'Home', seo: [], body: [], footer: 'shared' },
};
const locales = [
  { slug: '', isDefault: true },
  { slug: 'fr', isDefault: false },
];
it('builds nested/localized routes with the selected footer and rejects ambiguous or reserved paths', () => {
  const footer: StorypaneStory<StorypaneContentType> = {
    ...story,
    id: 'shared',
    slug: 'footer',
    content: { _uid: 'footer', component: 'footer', text: 'Contact us' },
  };
  const pages = pageEntries(
    [story, footer, { ...story, locale: 'fr', slug: 'studio/home' }],
    locales,
  );
  expect(pages[2]?.params.path).toBe('fr/studio/home');
  expect(pages[2]?.props.references.footers.shared?.text).toBe('Contact us');
  expect(() => pageEntries([story, story], locales)).toThrow('duplicate');
  for (const slug of [
    '',
    '../secret',
    'bad?query',
    'a//b',
    '/home',
    'home/',
    'llms.txt',
    'llms/home.md',
  ])
    expect(() => pageEntries([{ ...story, slug }], locales)).toThrow('Invalid');
  for (const slug of [
    'preview',
    'preview/nested',
    'llms',
    'llms/home',
    'media',
    'media/asset',
    '_astro',
    '_astro/app',
  ])
    expect(() => pageEntries([{ ...story, slug }], locales)).toThrow('Reserved');
  // A configured locale reserves its prefix even before any translations are published.
  for (const slug of ['fr', 'fr/home'])
    expect(() => pageEntries([{ ...story, slug }], locales)).toThrow('conflicts with a locale');
  expect(() => pageEntries([{ ...story, slug: 'preview', locale: 'media' }], locales)).toThrow(
    'Reserved',
  );
  expect(() => pageEntries([story, { ...story, slug: 'studio/équipe' }], locales)).not.toThrow();
});
it.each(['', 'fr'])(
  'uses no query for default locale %j and explicitly fetches the others',
  async (defaultLocale) => {
    const configured = locales.map((locale) => ({
      ...locale,
      isDefault: locale.slug === defaultLocale,
    }));
    const calls: unknown[] = [];
    const client = {
      listLocales: async () => configured,
      listAllStories: async (query?: { locale?: string }) => {
        calls.push(query);
        return [{ ...story, locale: query?.locale ?? defaultLocale }];
      },
    } as unknown as Parameters<typeof fetchPublishedStories>[0];
    expect(await fetchPublishedStories(client)).toEqual({
      locales: configured,
      stories: [story, { ...story, locale: 'fr' }],
    });
    expect(calls).toEqual(
      defaultLocale === '' ? [undefined, { locale: 'fr' }] : [{ locale: '' }, undefined],
    );
  },
);
