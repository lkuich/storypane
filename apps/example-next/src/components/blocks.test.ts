import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { StorypaneStory } from '@storypane/sdk';
import type { FooterBlock, PageBlock, StorypaneContentType } from '../types/storypane';
import { assetIds, linkHref, referencesFor, type SiteReferences } from '../lib/content';
import { Block } from './blocks/block';

const footer: FooterBlock = {
  _uid: 'footer-block',
  component: 'footer',
  text: 'Stay in touch',
  link: { type: 'email', email: 'hello@example.com' },
};
const references: SiteReferences = { paths: { about: '/fr/about' }, footers: { shared: footer } };
const page: PageBlock = {
  _uid: 'page',
  component: 'page',
  title: 'Home',
  footer: 'shared',
  body: [
    {
      _uid: 'hero',
      component: 'hero',
      title: 'Hello',
      hero_image: { assetId: 'image', alt: 'Studio garden' },
    },
    {
      _uid: 'feature',
      component: 'feature',
      title: 'Read more',
      text: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Our approach', marks: [{ type: 'bold' }] }],
          },
        ],
      },
      page: { type: 'story', storyId: 'about' },
    },
    { _uid: 'second', component: 'feature', title: 'Another idea' },
  ],
};
function render(block: StorypaneContentType = page, preview = false) {
  return renderToStaticMarkup(
    createElement(Block, {
      block,
      references,
      preview: preview ? { cmsUrl: 'http://localhost:3130', spaceId: 'space' } : undefined,
    }),
  );
}
it('renders the new hero image, adjacent feature cards, links and selected shared footer', () => {
  const html = render();
  expect(html).toContain('src="/media/image"');
  expect(html).toContain('alt="Studio garden"');
  expect(html).toContain('data-blok-field="hero_image"');
  expect(html.match(/class="feature-grid"/g)).toHaveLength(1);
  expect(html).toContain('href="/fr/about"');
  expect(html).toContain('<p><strong>Our approach</strong></p>');
  expect(html).toContain('Stay in touch');
  expect(html).toContain('mailto:hello@example.com');
  expect(render(footer)).toContain('<footer');
  expect(render(page, true)).toContain(
    'http://localhost:3130/api/cms/assets/image/content?space=space',
  );
});
it('tolerates empty draft fields and unresolved unpublished footers', () => {
  const html = render({
    ...page,
    footer: 'unpublished',
    body: [{ _uid: 'hero', component: 'hero', title: 'Draft', hero_image: null }],
  });
  expect(html).toContain('Good things take shape.');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('Stay in touch');
});
it('resolves localized references with Default fallbacks and accepts only usable link destinations', () => {
  const story = (
    id: string,
    locale: string,
    slug: string,
    content: StorypaneContentType,
  ): StorypaneStory<StorypaneContentType> => ({
    id,
    locale,
    slug,
    content,
    name: id,
    localeId: locale,
    revision: 1,
    publishedAt: 'today',
  });
  const localized = { ...footer, text: 'Bonjour' };
  const result = referencesFor(
    [
      story('shared', '', 'footer', footer),
      story('shared', 'fr', 'pied', localized),
      story('about', '', 'about', page),
      story('other', 'de', 'kontakt', footer),
    ],
    'fr',
  );
  expect(result.paths).toEqual({ shared: '/fr/pied', about: '/about' });
  expect(result.footers.shared).toEqual(localized);
  expect(linkHref({ type: 'story', storyId: 'missing' }, result.paths)).toBeUndefined();
  expect(linkHref({ type: 'external', url: 'javascript:alert(1)' }, result.paths)).toBeUndefined();
  expect(
    linkHref({ type: 'external', url: 'https://user:secret@example.com' }, result.paths),
  ).toBeUndefined();
  expect(linkHref({ type: 'external', url: 'https://example.com/about' }, result.paths)).toBe(
    'https://example.com/about',
  );
  expect(linkHref({ type: 'asset', assetId: 'file' }, result.paths)).toBe('/media/file');
  expect(
    assetIds([page, { link: { type: 'asset', assetId: 'file' } }, { assetId: 'image' }, null]),
  ).toEqual(['image', 'file']);
});
