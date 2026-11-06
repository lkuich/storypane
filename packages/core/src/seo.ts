import type { DefinitionInput } from './index.js';

/** Ordinary fields: sites decide how to render metadata and published Markdown. */
export const seoBlockPreset: DefinitionInput = {
  name: 'seo',
  displayName: 'SEO & AI',
  kind: 'nestable',
  fields: [
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      format: 'singleline',
      description: 'Leave empty to use the page title.',
    },
    {
      name: 'description',
      label: 'Description',
      type: 'text',
      format: 'textarea',
      description: 'Search description and introduction for the Markdown mirror.',
    },
    {
      name: 'canonical_url',
      label: 'Canonical URL',
      type: 'text',
      format: 'singleline',
      description: 'Optional absolute HTTP(S) URL. Leave empty to use the page URL.',
    },
    {
      name: 'og_image',
      label: 'Social image',
      type: 'asset',
      mimeTypes: ['image/*'],
      description: 'Used for Open Graph and social cards. Set alt text on the image.',
    },
    {
      name: 'robots_index',
      label: 'Search indexing',
      type: 'option',
      source: {
        type: 'inline',
        items: [
          { value: 'index', label: 'Allow indexing' },
          { value: 'noindex', label: 'No index' },
        ],
      },
      defaultValue: 'index',
    },
    {
      name: 'robots_follow',
      label: 'Follow links',
      type: 'option',
      source: {
        type: 'inline',
        items: [
          { value: 'follow', label: 'Follow links' },
          { value: 'nofollow', label: 'No follow' },
        ],
      },
      defaultValue: 'follow',
    },
    {
      name: 'markdown_enabled',
      label: 'Markdown mirror enabled',
      type: 'boolean',
      defaultValue: false,
      description:
        'Include this published page in your site’s Markdown mirrors and discovery index. Requires frontend integration; no-index pages should be excluded.',
    },
  ],
};
