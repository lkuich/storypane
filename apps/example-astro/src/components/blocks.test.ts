import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { StorypaneStory } from '@storypane/sdk';
import type { FooterBlock, PageBlock, StorypaneContentType } from '../types/storypane';
import {
  assetIds,
  linkHref,
  referencesFor,
  storyReferences,
  type SiteReferences,
} from '../lib/content';
import { Content } from './blocks';

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
    createElement(Content, {
      block,
      references,
      cmsUrl: 'http://localhost:3130',
      spaceId: 'space',
      preview,
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
  expect(render(footer)).toContain('<main id="content"><footer');
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
it('uses live referenced footer drafts, switches selections, and clears stale build references', () => {
  const draftFooter = { ...footer, _uid: 'new-footer', text: 'Unpublished footer' };
  const reference: StorypaneStory<FooterBlock> = {
    id: 'new',
    locale: '',
    slug: 'footer',
    name: 'Footer',
    localeId: 'footer-locale',
    revision: 2,
    publishedAt: null,
    content: draftFooter,
  };
  const initial: StorypaneStory<PageBlock> = {
    ...reference,
    id: 'home',
    content: { ...page, footer: 'new' },
  };
  const draft = { ...initial, references: [{ ...reference, content: { ...draftFooter } }] };
  const renderDraft = (story: typeof draft) =>
    renderToStaticMarkup(
      createElement(Content, {
        block: story.content,
        references: storyReferences(story, references),
        cmsUrl: 'http://localhost:3130',
        spaceId: 'space',
        preview: true,
      }),
    );
  expect(renderDraft(draft)).toContain('Unpublished footer');
  expect(renderDraft({ ...draft, content: { ...draft.content, footer: null } })).not.toContain(
    'Unpublished footer',
  );
  expect(storyReferences({ ...initial, references: [] }, references).footers).toEqual({});
  expect(storyReferences(initial, references)).toBe(references);
  expect(
    renderDraft({
      ...draft,
      references: [{ ...draft.references[0], content: { ...draftFooter, text: 'Updated footer' } }],
    }),
  ).toContain('Updated footer');
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
