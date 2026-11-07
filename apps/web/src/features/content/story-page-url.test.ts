import { expect, it } from 'vitest';
import type { UserDeliverySettings } from '@storypane/core';
import { storyPageUrl } from './story-page-url';

it('opens the content path on the configured app without preview routes or query flags', () => {
  const settings: UserDeliverySettings = {
    previewUrls: [
      { id: 'other', name: 'Other app', url: 'https://other.test/{slug}' },
      {
        id: 'local',
        name: 'Local',
        url: 'http://127.0.0.1:3140/preview?slug={slug}&locale={locale}&review=1',
      },
    ],
    defaultPreviewId: 'local',
    personalDefaultPreviewId: null,
    blockPreviews: true,
    previewParameter: 'review',
  };
  expect(storyPageUrl(settings, '/blog/full-slug')).toBe('http://127.0.0.1:3140/blog/full-slug');
  expect(storyPageUrl(settings, '/ca/équipe/contact')).toBe(
    'http://127.0.0.1:3140/ca/%C3%A9quipe/contact',
  );
  expect(storyPageUrl(settings, '//elsewhere.test/path')).toBe(
    'http://127.0.0.1:3140/elsewhere.test/path',
  );
  expect(storyPageUrl({ ...settings, personalDefaultPreviewId: 'other' }, '/home')).toBe(
    'https://other.test/home',
  );
  expect(storyPageUrl({ ...settings, personalDefaultPreviewId: 'removed' }, '/home')).toBe(
    'http://127.0.0.1:3140/home',
  );
  expect(storyPageUrl(null, '/home')).toBeUndefined();
  expect(
    storyPageUrl({ ...settings, previewUrls: [], defaultPreviewId: null }, '/home'),
  ).toBeUndefined();
});
