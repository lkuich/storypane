import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BlockDefinition, MigrationChange, SchemaMigration } from '@storypane/core'
import { MigrationHistoryDialog } from './migration-history'
import { MigrationChangeCount } from './migration-diff'

const hero:BlockDefinition={id:'hero',name:'hero',displayName:'Hero',kind:'nestable',version:1,versionId:'hero-v1',createdAt:'',fields:[
  {id:'title',name:'title',label:'Title',type:'text',format:'singleline'},
  {id:'test',name:'test',label:'Test',type:'text',format:'singleline'},
]}
const first:SchemaMigration={id:'m1',spaceId:'space',version:1,baseVersion:0,name:'Initial schema',status:'deployed',revision:1,definitions:[hero],contributors:['alice'],createdAt:'2026-11-01T12:00:00Z',deployedAt:'2026-11-01T12:00:00Z',deployedBy:'alice'}
const second:SchemaMigration={...first,id:'m2',version:2,baseVersion:1,name:'Add hero image',definitions:[{...hero,version:2,versionId:'hero-v2',fields:[...hero.fields,{id:'image',name:'hero_image',label:'Hero image',type:'asset'}]}]}
const third:SchemaMigration={...second,id:'m3',version:3,baseVersion:2,name:'Remove test',destructive:true,definitions:second.definitions.map(definition=>({...definition,fields:definition.fields.filter(field=>field.name!=='test')}))}
function render(migration:SchemaMigration,base?:SchemaMigration) {
  return renderToStaticMarkup(createElement(MigrationHistoryDialog,{migration,base,people:{alice:'Alice Editor'},onClose:()=>{}}))
}

describe('deployed migration diffs',()=>{
  it('compares a release to its own base and shows a read-only, expanded before/after diff',()=>{
    const html=render(second,first)
    expect(html).toContain('hero_image')
    expect(html).toContain('1 change')
    expect(html).toContain('data-kind="added"')
    expect(html).toContain('<details open="">')
    expect(html).toContain('Not present')
    expect(html).toContain('&quot;type&quot;: &quot;asset&quot;')
    expect(html).toContain('Alice Editor')
    expect(html).toContain('Deployed migrations are read-only.')
    expect(html).not.toContain('Refresh review')
    expect(html).not.toContain('Deploy migration')
    const removed=render(third,second)
    expect(removed).toContain('1 change')
    expect(removed).toContain('<code>test</code>')
    expect(removed).toContain('data-kind="removed"')
    expect(removed).toContain('<pre>Removed</pre>')
    expect(removed).not.toContain('hero_image')
    expect(removed).toContain('Destructive')
  })

  it('reports missing bases instead of treating every definition as added, and handles unchanged deployments',()=>{
    const missing=render(second)
    expect(missing).toContain('Base migration 1 is unavailable. The diff cannot be shown.')
    expect(missing).not.toContain('data-kind="added"')
    const unchanged=render({...second,definitions:first.definitions},first)
    expect(unchanged).toContain('0 changes')
    expect(unchanged).toContain('without changing its definitions')
  })

  it('counts additions, removals, and other changes with accessible labels',()=>{
    const changes:MigrationChange[]=['added','removed','changed','reset','renamed'].map(kind=>({definition:'hero',kind:kind as MigrationChange['kind']}))
    const html=renderToStaticMarkup(createElement(MigrationChangeCount,{changes}))
    expect(html).toContain('aria-label="1 added, 3 changed, 1 removed"')
    expect(html).toContain('>+1</span>')
    expect(html).toContain('>~3</span>')
    expect(html).toContain('>−1</span>')
    expect(renderToStaticMarkup(createElement(MigrationChangeCount,{changes:[]}))).toContain('No schema changes')
  })
})
