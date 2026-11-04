// Keep selection in the URL so separate tabs can work in separate spaces.
export function selectedSpaceId(): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('space')
}

export function spaceHeaders(): Record<string, string> {
  const id = selectedSpaceId()
  return id ? { 'x-blok-space-id': id } : {}
}

export function spaceUrl(path: string): string {
  const id = selectedSpaceId()
  if (!id) return path
  return `${path}${path.includes('?') ? '&' : '?'}space=${encodeURIComponent(id)}`
}

export function setStoryLocation(storyId: string | null, locale = '') {
  const url = new URL(window.location.href)
  if (storyId) {
    url.searchParams.set('story', storyId)
    url.searchParams.delete('view')
  } else url.searchParams.delete('story')
  if (storyId && locale) url.searchParams.set('locale', locale)
  else url.searchParams.delete('locale')
  window.history.replaceState(null, '', url)
}
