import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocaleSnapshot, PageEditor } from '@storypane/core'
import { BlockEditorAvatar } from './editor-avatars'

const editors:PageEditor[]=[
  {userId:'alice',name:'Alice Editor',avatarUrl:'https://example.com/alice.png',locales:['Default','Français']},
  {userId:'bob',name:'Bob Editor',avatarUrl:null,locales:['Default']},
]
function snapshot():LocaleSnapshot {
  return {
    story:{id:'story',name:'Home',slug:'home',createdAt:'',updatedAt:''},
    locale:{id:'default',storyId:'story',spaceLocaleId:'default',slug:'',name:'Default',urlSlug:'',rootBlockId:'page',revision:1,checkpointId:null,publishedVersionId:null},
    blocks:[],definitions:[],revision:1,checkpointId:null,
    leases:[
      {blockId:'hero',userId:'alice',sessionId:'alice-session',expiresAt:'2026-11-04T20:00:45Z'},
      {blockId:'footer',userId:'bob',sessionId:'bob-session',expiresAt:'2026-11-04T20:00:45Z'},
    ],
  }
}
function render(blockId:string, current=snapshot()) {
  return renderToStaticMarkup(createElement(BlockEditorAvatar,{blockId,snapshot:current,editors,currentUserId:'alice'}))
}

describe('block editor avatars',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T20:00:00Z'))})
  afterEach(()=>vi.useRealTimers())

  it('shows the block owner, their photo or initials, and only the current locale',()=>{
    const hero=render('hero')
    expect(hero).toContain('Alice Editor (you) · Editing Default')
    expect(hero).toContain('https://example.com/alice.png')
    expect(hero).not.toContain('Bob Editor')
    expect(hero).not.toContain('Français')
    const footer=render('footer')
    expect(footer).toContain('Bob Editor · Editing Default')
    expect(footer).toContain('>BE</span>')
    expect(footer).not.toContain('Alice Editor')
  })

  it('does not show unlocked, expired, or unknown editors',()=>{
    expect(render('page')).toBe('')
    const expired=snapshot()
    expired.leases[0].expiresAt='2026-11-04T20:00:00Z'
    expect(render('hero',expired)).toBe('')
    const unknown=snapshot()
    unknown.leases[0].userId='removed-user'
    expect(render('hero',unknown)).toBe('')
  })

  it('uses updated lock ownership and does not carry locks into another locale',()=>{
    const updated=snapshot()
    updated.leases[0].userId='bob'
    expect(render('hero',updated)).toContain('Bob Editor · Editing Default')
    expect(render('hero',updated)).not.toContain('Alice Editor')
    updated.locale={...updated.locale,id:'french',slug:'fr',name:'Français'}
    updated.leases=[]
    expect(render('hero',updated)).toBe('')
  })
})
