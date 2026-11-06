import { describe, expect, it } from 'vitest';
import type { StorypaneStory } from '../packages/sdk/src/index';
import type { StorypaneContentType, SeoBlock } from '../apps/example-astro/src/types/storypane';
import * as astro from '../apps/example-astro/src/lib/seo';
import * as next from '../apps/example-next/src/lib/seo';

const site = 'https://fieldwork.test';
const story = (seo: Partial<SeoBlock> = {}): StorypaneStory<StorypaneContentType> => ({
  id: 'home',
  name: 'Story name',
  slug: 'studio/équipe',
  locale: 'fr',
  localeId: 'french',
  revision: 1,
  publishedAt: '2026-11-06T00:00:00Z',
  content: {
    _uid: 'root',
    component: 'page',
    title: 'Page title',
    seo: [{ _uid: 'seo', component: 'seo', markdown_enabled: true, ...seo }],
    body: [
      {
        _uid: 'hero',
        component: 'hero',
        title: 'Visible heading',
        description: 'A <script> & [link](bad)',
      },
      {
        _uid: 'feature',
        component: 'feature',
        title: 'Detail',
        text: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Visible rich text' }] }],
        },
      },
    ],
  },
});

for (const [name, api] of Object.entries({ astro, next }))
  describe(`${name} SEO integration`, () => {
    it('uses metadata overrides, safe canonical URLs, social image alt and localized mirror paths', () => {
      expect(
        api.pageMetadata(
          story({
            title: ' SEO title ',
            description: ' Summary ',
            canonical_url: 'https://canonical.test/page#section',
            robots_follow: 'nofollow',
            og_image: { assetId: 'asset', alt: 'Picture' },
          }),
          site,
        ),
      ).toMatchObject({
        title: 'SEO title',
        description: 'Summary',
        canonical: 'https://canonical.test/page',
        robots: 'index, nofollow',
        image: { url: 'https://fieldwork.test/media/asset', alt: 'Picture' },
        markdownEnabled: true,
        markdownPath: '/llms/fr/studio/%C3%A9quipe.md',
      });
      for (const canonical_url of [
        'javascript:alert(1)',
        'https://user:pass@example.test/',
        '/relative',
        '',
      ]) {
        expect(api.pageMetadata(story({ title: ' ', canonical_url }), site)).toMatchObject({
          title: 'Page title',
          canonical: 'https://fieldwork.test/fr/studio/%C3%A9quipe',
        });
      }
    });
    it('requires a published, explicitly enabled, indexable page for both mirrors and discovery', () => {
      const blocked = [
        story({ markdown_enabled: false }),
        story({ markdown_enabled: undefined }),
        story({ robots_index: 'noindex' }),
        { ...story(), publishedAt: null },
        { ...story(), content: { _uid: 'footer', component: 'footer' as const, text: 'Shared' } },
      ];
      for (const value of blocked) {
        expect(api.pageMetadata(value, site).markdownEnabled).toBe(false);
        expect(() => api.pageMarkdown(value, site)).toThrow('disabled');
      }
      expect(api.discoveryMarkdown(blocked, site)).not.toContain('/llms/');
      expect(api.discoveryMarkdown([story({ title: '[Team]\npage' }), ...blocked], site)).toContain(
        '- [\\[Team\\] page](<https://fieldwork.test/llms/fr/studio/%C3%A9quipe.md>)',
      );
    });
    it('exports visible body content with escaped text, without dumping metadata or arbitrary fields', () => {
      const page = story({
        canonical_url: 'https://canonical.test/page',
        robots_follow: 'nofollow',
      });
      Object.assign(page.content, { internal_notes: 'Private extra field' });
      const markdown = api.pageMarkdown(page, site);
      expect(markdown).toContain('# Page title');
      expect(markdown).toContain('Canonical: <https://canonical.test/page>');
      expect(markdown).toContain('## Visible heading');
      expect(markdown).toContain('A \\<script\\> & \\[link\\](bad)');
      expect(markdown).toContain('Visible rich text');
      expect(markdown).not.toMatch(/nofollow|Private extra field|markdown_enabled|_uid/);
    });
  });
