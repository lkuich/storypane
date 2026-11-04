import { describe, expect, it } from 'vitest';
import { publicAssetUrl, type PublicImageOptions } from './media.js';

const source = {
  url: 'https://cms.example.com',
  spaceId: '11111111-1111-4111-8111-111111111111',
  assetId: '22222222-2222-4222-8222-222222222222',
};
describe('publicAssetUrl', () => {
  it('builds original and canonical responsive URLs without a client or credentials', () => {
    expect(publicAssetUrl(source)).toBe(
      `https://cms.example.com/media/${source.spaceId}/${source.assetId}/original`,
    );
    expect(
      publicAssetUrl(source, { width: 640, aspect: '16:9', format: 'jpeg', quality: 90 }),
    ).toBe(
      `https://cms.example.com/media/${source.spaceId}/${source.assetId}/image?width=640&aspect=16%3A9&format=jpeg&quality=90`,
    );
    expect(publicAssetUrl(source, { width: 320 })).toBe(
      publicAssetUrl(source, {
        width: 320,
        aspect: 'original',
        fit: 'contain',
        format: 'webp',
        quality: 80,
      }),
    );
    expect(publicAssetUrl(source, { width: 320, format: 'png' })).toMatch(/width=320&format=png$/);
  });
  it('rejects credentials and unsafe inputs even from untyped callers', () => {
    for (const url of [
      'https://secret@cms.example.com',
      'https://cms.example.com?token=secret',
      'https://cms.example.com#secret',
      'javascript:alert(1)',
    ])
      expect(() => publicAssetUrl({ ...source, url })).toThrow();
    expect(() => publicAssetUrl({ ...source, assetId: '../key' })).toThrow();
    for (const image of [
      { width: 500 },
      { width: 320, height: 50 },
      { width: 320, format: 'png', quality: 80 },
      { width: 320, fit: 'crop' },
      { width: 320, aspect: '2:1' },
      { width: 320, quality: 99 },
    ])
      expect(() => publicAssetUrl(source, image as PublicImageOptions)).toThrow();
  });
});
