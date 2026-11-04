// Keep selection in the URL so separate tabs can work in separate spaces.
export function selectedSpaceId(): string | null {
  return typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('space');
}

export function spaceHeaders(): Record<string, string> {
  const id = selectedSpaceId();
  return id ? { 'x-blok-space-id': id } : {};
}

export function spaceUrl(path: string): string {
  const id = selectedSpaceId();
  if (!id) return path;
  return `${path}${path.includes('?') ? '&' : '?'}space=${encodeURIComponent(id)}`;
}

export function storyUrl({
  spaceId,
  storyId,
  localeSlug = '',
  blockId,
}: {
  spaceId: string;
  storyId: string;
  localeSlug?: string;
  blockId?: string;
}): string {
  const params = new URLSearchParams({ space: spaceId, story: storyId });
  if (localeSlug) params.set('locale', localeSlug);
  if (blockId) params.set('block', blockId);
  return `/?${params}`;
}

export function setStoryLocation(
  storyId: string | null,
  locale = '',
  blockId?: string | null,
  historyMode: 'replace' | 'push' = 'replace',
) {
  const url = new URL(window.location.href);
  if (storyId) {
    url.searchParams.set('story', storyId);
    url.searchParams.delete('view');
  } else url.searchParams.delete('story');
  if (storyId && locale) url.searchParams.set('locale', locale);
  else url.searchParams.delete('locale');
  if (storyId && blockId) url.searchParams.set('block', blockId);
  else url.searchParams.delete('block');
  if (historyMode === 'push')
    window.history.pushState(
      { ...window.history.state, storypaneIndex: (window.history.state?.storypaneIndex ?? 0) + 1 },
      '',
      url,
    );
  else window.history.replaceState(window.history.state, '', url);
}
