import { randomUUID } from 'node:crypto'
import { expect,it } from 'vitest'
import { blockClipboardSchema,createBlockClipboard,parseBlockClipboard,serializeBlockClipboard,type LocaleSnapshot } from './index.js'

const definitionId=randomUUID(),spaceId=randomUUID()
const snapshot={migrationVersion:3,blocks:[
  {id:'page',definitionId,fields:{},parentId:null,parentField:null,position:0},
  {id:'group',definitionId,fields:{title:'Saved'},parentId:'page',parentField:'body',position:0},
  {id:'last',definitionId,fields:{text:'Last'},parentId:'group',parentField:'items',position:2},
  {id:'first',definitionId,fields:{text:'First'},parentId:'group',parentField:'items',position:0},
  {id:'unrelated',definitionId,fields:{title:'Leave alone'},parentId:'page',parentField:'body',position:1},
]} as LocaleSnapshot

it('copies only the selected subtree, preserves order and visible edits, and omits source IDs and locks',()=>{
  const edits={group:{fields:{title:'Unsaved'}},first:{fields:{text:'Edited child'}}}
  const copied=createBlockClipboard(snapshot,spaceId,'group',edits)
  expect(copied).toMatchObject({type:'storypane/block',version:1,spaceId,migrationVersion:3})
  expect(copied.blocks).toEqual([
    {definitionId,parentIndex:null,parentField:null,position:0,fields:{title:'Unsaved'}},
    {definitionId,parentIndex:0,parentField:'items',position:0,fields:{text:'Edited child'}},
    {definitionId,parentIndex:0,parentField:'items',position:2,fields:{text:'Last'}},
  ])
  copied.blocks[0]!.fields.title='Changed copy'
  expect(edits.group.fields.title).toBe('Unsaved')
  expect(snapshot.blocks[1]!.fields.title).toBe('Saved')
  expect(parseBlockClipboard(serializeBlockClipboard(copied))).toEqual(copied)
})

it('rejects malformed, disconnected, cyclic, unsupported and oversized clipboard content',()=>{
  const clipboard=createBlockClipboard(snapshot,spaceId,'group')
  for(const change of [{parentIndex:1},{parentIndex:null},{parentIndex:99},{parentField:null}]) {
    const invalid=structuredClone(clipboard);Object.assign(invalid.blocks[1]!,change)
    expect(blockClipboardSchema.safeParse(invalid).success).toBe(false)
  }
  expect(()=>parseBlockClipboard('ordinary text')).toThrow('Copy a block')
  expect(()=>parseBlockClipboard(JSON.stringify({...clipboard,version:2}))).toThrow('not a valid')
  expect(()=>parseBlockClipboard('x'.repeat(1024*1024+1))).toThrow('exceeds 1 MiB')
  clipboard.blocks[0]!.fields.large='😀'.repeat(300000)
  expect(()=>serializeBlockClipboard(clipboard)).toThrow('too large')
  const deep={...clipboard,blocks:Array.from({length:32},(_,i)=>({definitionId,parentIndex:i?i-1:null,parentField:i?'items':null,position:0,fields:{}}))}
  expect(blockClipboardSchema.safeParse(deep).success).toBe(false)
})
