export type PublicImageOptions = {
  width: 160 | 320 | 640 | 1280 | 1920 | 2560;
  aspect?: 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
  fit?: 'cover' | 'contain';
} & ({ format?: 'webp' | 'jpeg'; quality?: 60 | 80 | 90 } | { format: 'png'; quality?: never });

/** Browser-safe URL construction. The space must opt in and a live publication must use the asset. */
export function publicAssetUrl(
  { url, spaceId, assetId }: { url: string; spaceId: string; assetId: string },
  image?: PublicImageOptions,
): string {
  const base = new URL(url);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Use an HTTP(S) CMS URL without credentials, query, or fragment');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(spaceId) || !uuid.test(assetId))
    throw new Error('Valid space and asset IDs are required');
  const result = new URL(
    `/media/${spaceId.toLowerCase()}/${assetId.toLowerCase()}/${image ? 'image' : 'original'}`,
    base,
  );
  if (image) {
    if (
      Object.keys(image).some(
        (key) => !['width', 'aspect', 'fit', 'format', 'quality'].includes(key),
      ) ||
      ![160, 320, 640, 1280, 1920, 2560].includes(image.width) ||
      (image.aspect !== undefined &&
        !['original', '1:1', '4:3', '3:4', '16:9', '9:16'].includes(image.aspect)) ||
      (image.fit !== undefined && !['cover', 'contain'].includes(image.fit)) ||
      (image.format !== undefined && !['webp', 'jpeg', 'png'].includes(image.format)) ||
      (image.quality !== undefined && ![60, 80, 90].includes(image.quality)) ||
      (image.format === 'png' && image.quality !== undefined)
    )
      throw new Error('Unsupported public image options');
    result.searchParams.set('width', String(image.width));
    if (image.aspect && image.aspect !== 'original') {
      result.searchParams.set('aspect', image.aspect);
      if (image.fit === 'contain') result.searchParams.set('fit', image.fit);
    }
    if (image.format && image.format !== 'webp') result.searchParams.set('format', image.format);
    if (image.quality !== undefined && image.quality !== 80)
      result.searchParams.set('quality', String(image.quality));
  }
  return result.href;
}
