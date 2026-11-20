import { describe, expect, it } from 'vitest';
import {
  folderInputSchema,
  folderLabel,
  folderPath,
  pathSlugSchema,
  type ContentFolder,
} from './index';

const folder = (
  id: string,
  parentId: string | null = null,
  localeSlugs: Record<string, string> = {},
): ContentFolder => ({
  id,
  parentId,
  name: id,
  slug: id,
  localeSlugs,
  allowedDefinitionIds: [],
  defaultDefinitionId: null,
  formOnly: false,
});
describe('folder paths', () => {
  it('composes ancestor translations and falls back independently to default segments', () => {
    const folders = [
      folder('courses', null, { fr: 'cours' }),
      folder('workshops', 'courses'),
      folder('intro', 'workshops', { fr: 'présentation' }),
    ];
    expect(folderPath(folders, 'intro')).toBe('courses/workshops/intro');
    expect(folderPath(folders, 'intro', 'fr')).toBe('cours/workshops/présentation');
    expect(folderPath(folders, null, 'fr')).toBe('');
  });
  it('keeps organizational names in editor paths and skips them in every locale URL', () => {
    const grouping = { ...folder('Regional', 'courses'), slug: '' };
    const folders = [
      folder('courses', null, { fr: 'cours' }),
      grouping,
      folder('book', 'Regional'),
    ];
    expect(folderInputSchema.parse({ name: 'Regional', slug: '' }).slug).toBe('');
    expect(
      folderInputSchema.safeParse({
        name: 'Regional',
        slug: '',
        localeSlugs: { '00000000-0000-4000-8000-000000000001': 'region' },
      }).success,
    ).toBe(false);
    expect(folderLabel(folders, 'book')).toBe('courses / Regional / book');
    expect(folderPath(folders, 'book', 'fr')).toBe('cours/book');
  });
  it('rejects invalid paths while supporting normalized translated slugs', () => {
    expect(pathSlugSchema.parse(' pre\u0301sentation/details ')).toBe('présentation/details');
    for (const slug of [
      '../courses',
      'courses//intro',
      '/courses',
      'courses/',
      'courses?draft=1',
      'https://site.test',
    ])
      expect(pathSlugSchema.safeParse(slug).success).toBe(false);
    expect(folderInputSchema.safeParse({ name: 'Courses', slug: 'courses/intro' }).success).toBe(
      false,
    );
    expect(folderInputSchema.parse({ name: 'Courses', slug: 'courses' })).toMatchObject({
      parentId: null,
      localeSlugs: {},
    });
  });
  it('rejects cycles, missing parents, and excessive depth', () => {
    expect(() => folderPath([folder('a', 'b'), folder('b', 'a')], 'a')).toThrow(
      'cannot contain themselves',
    );
    expect(() => folderPath([folder('a', 'missing')], 'a')).toThrow('Parent folder not found');
    const folders = Array.from({ length: 21 }, (_, index) =>
      folder(String(index), index ? String(index - 1) : null),
    );
    expect(folderPath(folders, '19').split('/')).toHaveLength(20);
    expect(() => folderPath(folders, '20')).toThrow('20 levels');
  });
});
