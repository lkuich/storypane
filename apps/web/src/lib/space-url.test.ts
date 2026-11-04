import { afterEach, expect, it, vi } from 'vitest'
import { spaceHeaders, spaceUrl } from './space-url'
import { assetContentUrl, assetThumbnailUrl } from '../features/assets/api'
import { api } from '../features/editor/api'

afterEach(() => vi.unstubAllGlobals())
it('scopes API calls and browser media URLs to the space selected in this tab', async () => {
  const id = '22222222-2222-4222-8222-222222222222'
  vi.stubGlobal('window', { location: { search:`?space=${id}&view=settings` } })
  const fetch = vi.fn().mockResolvedValue(new Response('[]'))
  vi.stubGlobal('fetch', fetch)
  await api('/stories')
  expect(fetch).toHaveBeenCalledWith('/api/cms/stories', expect.objectContaining({ headers:expect.objectContaining({ 'x-blok-space-id':id }) }))
  expect(spaceHeaders()).toEqual({ 'x-blok-space-id':id })
  expect(assetContentUrl('image')).toBe(`/api/cms/assets/image/content?space=${id}`)
  expect(assetThumbnailUrl('image')).toBe(`/api/cms/assets/image/thumbnail?width=320&space=${id}`)
  expect(spaceUrl('/api/cms/stories/story/locales/locale/live')).toBe(`/api/cms/stories/story/locales/locale/live?space=${id}`)
})
