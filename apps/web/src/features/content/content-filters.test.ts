import { describe, expect, it } from 'vitest'
import type { StorySummary } from '@storypane/core'
import { defaultFilters, filterStories, readContentFilters, writeContentFilters } from './content-filters'

const story=(id:string,changes:Partial<StorySummary>={}):StorySummary=>({id,name:id,slug:id,pinned:false,createdAt:'2026-01-01T00:00:00Z',updatedAt:new Date('2026-11-04T12:00:00').toISOString(),publicationStatus:'draft',localeCount:1,pendingLocaleCount:1,modifiedBy:{id:'alice',name:'Alice'},contentType:{id:'page',name:'Page'},...changes})
const stories=[
  story('home',{name:'Home',publicationStatus:'published',pendingLocaleCount:0}),
  story('news',{name:'News',publicationStatus:'changed',modifiedBy:{id:'bob',name:'Bob'},contentType:{id:'article',name:'Article'}}),
  story('draft',{name:'About',slug:'company/about',updatedAt:new Date('2026-10-01T12:00:00').toISOString()}),
]
const ids=(items:StorySummary[])=>items.map(item=>item.id)

describe('content filters',()=>{
  it('puts personal pins first within every sort while still respecting filters',()=>{
    const pinned=stories.map(story=>({...story,pinned:story.id!=='home'}))
    expect(ids(filterStories(pinned,defaultFilters))).toEqual(['news','draft','home'])
    expect(ids(filterStories(pinned,{...defaultFilters,sort:'oldest'}))).toEqual(['draft','news','home'])
    expect(ids(filterStories(pinned,{...defaultFilters,sort:'name'}))).toEqual(['draft','news','home'])
    expect(ids(filterStories(pinned,{...defaultFilters,status:'published'}))).toEqual(['home'])
    expect(ids(filterStories(pinned,{...defaultFilters,query:'home'}))).toEqual(['home'])
    expect(filterStories(pinned,{...defaultFilters,modifiedBy:'nobody'})).toEqual([])
    expect(ids(filterStories(pinned.map(story=>({...story,pinned:false})),defaultFilters))).toEqual(['home','news','draft'])
  })
  it('combines search, status, author, and type without conflating drafts and pending publications',()=>{
    expect(ids(filterStories(stories,{...defaultFilters,query:' NEWS ',status:'changed',modifiedBy:'bob',contentType:'article'}))).toEqual(['news'])
    expect(filterStories(stories,{...defaultFilters,status:'draft',modifiedBy:'bob'})).toEqual([])
    expect(ids(filterStories(stories,{...defaultFilters,status:'published'}))).toEqual(['home'])
    expect(ids(filterStories(stories,{...defaultFilters,query:'/company/about'}))).toEqual(['draft'])
    expect(ids(filterStories([story('page-id',{name:'Different',slug:'other'})],{...defaultFilters,query:'PAGE-ID'}))).toEqual(['page-id'])
  })
  it('includes both custom boundary days in local time and supports open ends',()=>{
    const days=['2026-11-03T23:59:59.999','2026-11-04T00:00:00','2026-11-04T23:59:59.999','2026-11-05T00:00:00'].map((value,i)=>story(String(i),{updatedAt:new Date(value).toISOString()}))
    expect(ids(filterStories(days,{...defaultFilters,modified:'custom',from:'2026-11-04',to:'2026-11-04',sort:'oldest'}))).toEqual(['1','2'])
    expect(ids(filterStories(days,{...defaultFilters,modified:'custom',to:'2026-11-03'}))).toEqual(['0'])
    expect(ids(filterStories(days,{...defaultFilters,modified:'custom',from:'2026-11-05'}))).toEqual(['3'])
    expect(filterStories(days,{...defaultFilters,modified:'custom',from:'2026-11-05',to:'2026-11-03'})).toEqual([])
  })
  it('uses calendar days for today, last seven days, and last thirty days',()=>{
    const now=new Date('2026-11-04T14:00:00')
    const days=['2026-10-05T23:59:59','2026-10-06T00:00:00','2026-10-28T23:59:59','2026-10-29T00:00:00','2026-11-04T00:00:00','2026-11-05T00:00:00'].map((value,i)=>story(String(i),{updatedAt:new Date(value).toISOString()}))
    expect(ids(filterStories(days,{...defaultFilters,modified:'today'},now))).toEqual(['4'])
    expect(ids(filterStories(days,{...defaultFilters,modified:'week'},now))).toEqual(['4','3'])
    expect(ids(filterStories(days,{...defaultFilters,modified:'month'},now))).toEqual(['4','3','2','1'])
  })
  it('sorts results without reordering the source and tolerates missing historical metadata',()=>{
    expect(ids(filterStories(stories,{...defaultFilters,sort:'oldest'}))).toEqual(['draft','home','news'])
    expect(ids(filterStories(stories,{...defaultFilters,sort:'name'}))).toEqual(['draft','home','news'])
    expect(ids(stories)).toEqual(['home','news','draft'])
    expect(filterStories([story('legacy',{modifiedBy:null,contentType:null})],{...defaultFilters,modifiedBy:'alice'})).toEqual([])
  })
  it('round-trips filters while preserving the selected space and story',()=>{
    const params=new URLSearchParams('space=my-space&story=my-story&locale=fr')
    const filters={...defaultFilters,query:'Home & news',status:'changed' as const,modified:'custom' as const,from:'2026-11-01',to:'2026-11-04',modifiedBy:'bob',contentType:'article',sort:'oldest' as const}
    writeContentFilters(params,filters)
    expect(readContentFilters(new URLSearchParams(params.toString()))).toEqual(filters)
    writeContentFilters(params,defaultFilters)
    expect(params.toString()).toBe('space=my-space&story=my-story&locale=fr')
  })
  it('ignores invalid URL enums and dates and removes inactive date boundaries',()=>{
    expect(readContentFilters(new URLSearchParams('filterStatus=wrong&filterDate=wrong&sort=wrong&filterFrom=2026-02-30&filterTo=bad'))).toEqual(defaultFilters)
    const params=new URLSearchParams('filterFrom=2026-11-01&filterTo=2026-11-04')
    writeContentFilters(params,{...defaultFilters,modified:'today',from:'2026-11-01',to:'2026-11-04'})
    expect(params.toString()).toBe('filterDate=today')
  })
})
