import { expect, it } from 'vitest';
import { referenceForPath, staticStoryParams } from './routes';

const locales = [
  { id: 'default', name: 'Default', slug: '' },
  { id: 'french', name: 'French', slug: 'fr' },
];
it('maps default, localized, and nested routes back to the exact delivery reference', () => {
  const stories = [
    { locale: '', slug: 'home' },
    { locale: 'fr', slug: 'studio/home' },
  ];
  const paths = staticStoryParams(stories, locales);
  expect(paths).toEqual([{ path: ['home'] }, { path: ['fr', 'studio', 'home'] }]);
  expect(paths.map(({ path }) => referenceForPath(path, locales))).toEqual(stories);
  expect(referenceForPath(['studio', 'home'], locales)).toEqual({
    locale: '',
    slug: 'studio/home',
  });
});
it('rejects ambiguous, reserved, and unsafe routes before building pages', () => {
  for (const slug of [
    'preview',
    'preview/nested',
    'media/asset',
    '../secret',
    'bad?query',
    'home//nested',
    'home/',
    '/home',
    'home\n',
    'fr',
    'fr/home',
    '',
  ]) {
    expect(() => staticStoryParams([{ slug, locale: '' }], locales)).toThrow();
  }
  expect(() =>
    staticStoryParams(
      [
        { slug: 'home', locale: '' },
        { slug: 'home', locale: '' },
      ],
      locales,
    ),
  ).toThrow('duplicate');
});
