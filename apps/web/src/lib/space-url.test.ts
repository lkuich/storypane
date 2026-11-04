import { afterEach, expect, it, vi } from 'vitest'
import { setStoryLocation, spaceHeaders, spaceUrl, storyUrl } from './space-url'
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

it('keeps the story and locale in this tab’s URL and clears them when leaving', () => {
  let url = new URL('http://localhost/?space=one&view=settings&unrelated=keep')
  const replaceState = vi.fn((_state, _title, next: URL) => { url = new URL(next) })
  vi.stubGlobal('window', { get location() { return url }, history: { replaceState } })
  setStoryLocation('story-one', 'fr-CA', 'nested-block')
  expect(Object.fromEntries(url.searchParams)).toEqual({ space: 'one', unrelated: 'keep', story: 'story-one', locale: 'fr-CA', block:'nested-block' })
  setStoryLocation('story-one')
  expect(url.searchParams.has('locale')).toBe(false)
  expect(url.searchParams.has('block')).toBe(false)
  setStoryLocation(null)
  expect(Object.fromEntries(url.searchParams)).toEqual({ space: 'one', unrelated: 'keep' })
})

it('creates standalone links to the precise space, story, locale and block',()=>{
  expect(storyUrl({spaceId:'space',storyId:'story',localeSlug:'fr-CA',blockId:'block'})).toBe('/?space=space&story=story&locale=fr-CA&block=block')
  expect(storyUrl({spaceId:'space',storyId:'story'})).toBe('/?space=space&story=story')
})

it('pushes a story entry while keeping selection changes in that entry and preserving history state',()=>{
  let url=new URL('http://localhost/?space=one&folder=articles&q=home'),state={storypaneIndex:0,framework:'preserved'};
  const entries:{url:URL;state:typeof state}[]=[];
  const pushState=vi.fn((next:typeof state,_title:string,target:URL)=>{entries.push({url,state});url=new URL(target);state=next});
  const replaceState=vi.fn((next:typeof state,_title:string,target:URL)=>{url=new URL(target);state=next});
  vi.stubGlobal('window',{get location(){return url},history:{get state(){return state},pushState,replaceState}});
  setStoryLocation('story','fr',undefined,'push');
  setStoryLocation('story','fr','nested-block');
  expect(pushState).toHaveBeenCalledTimes(1);
  expect(entries[0]!.url.search).toBe('?space=one&folder=articles&q=home');
  expect(url.searchParams.get('block')).toBe('nested-block');
  expect(url.searchParams.get('locale')).toBe('fr');
  expect(state).toEqual({storypaneIndex:1,framework:'preserved'});
})
