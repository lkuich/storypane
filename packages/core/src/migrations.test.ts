import { expect,it } from 'vitest'
import { migrateSnapshot, migrationChanges, type BlockDefinition, type LocaleSnapshot } from './index.js'

const definition:BlockDefinition={id:'page',versionId:'v1',version:1,createdAt:'',name:'page',displayName:'Page',kind:'content-type',fields:[
  {id:'a',name:'title',label:'Title',type:'text',format:'singleline'},
  {id:'b',name:'count',label:'Count',type:'number'},
  {id:'c',name:'body',label:'Body',type:'blocks'},
]}
const snapshot={migrationVersion:1,definitions:[definition],blocks:[
  {id:'root',definitionId:'page',schemaVersionId:'v1',parentId:null,parentField:null,position:0,revision:1,fields:{title:'Keep',count:12}},
  {id:'child',definitionId:'page',schemaVersionId:'v1',parentId:'root',parentField:'body',position:0,revision:1,fields:{title:'Child'}},
],leases:[]} as unknown as LocaleSnapshot
it('preserves field and nested renames while resetting changed types to defaults',()=>{
  const target:BlockDefinition={...definition,versionId:'v2',version:2,fields:[
    {...definition.fields[0]!,name:'headline'},
    {id:'b',name:'count',label:'Count',type:'text',format:'singleline',defaultValue:'reset'},
    {...definition.fields[2]!,name:'items'},
  ]}
  const result=migrateSnapshot(snapshot,[target],2)
  expect(result.snapshot.blocks[0]!.fields).toEqual({headline:'Keep',count:'reset'})
  expect(result.snapshot.blocks[1]!.parentField).toBe('items')
  expect(result.resetValues).toBe(1)
  expect(result.snapshot.migrationVersion).toBe(2)
  expect(snapshot.blocks[0]!.fields).toEqual({title:'Keep',count:12})
  expect(migrationChanges([definition],[target]).map(change=>change.kind)).toEqual(['renamed','reset','renamed'])
})
it('deletes nested subtrees and never restores values after a type reversion',()=>{
  const removed={...definition,versionId:'v2',fields:[{id:'a',name:'title',label:'Title',type:'number' as const}]}
  const first=migrateSnapshot(snapshot,[removed],2)
  expect(first.deletedBlocks).toBe(1)
  expect(first.deletedValues).toBe(1)
  expect(first.snapshot.blocks[0]!.fields).toEqual({})
  expect(migrateSnapshot(first.snapshot,[definition],3).snapshot.blocks[0]!.fields).toEqual({})
})
it('moves swapped names from the original values and preserves plain text format changes',()=>{
  const initial={...definition,fields:[definition.fields[0]!,{id:'b',name:'count',label:'Count',type:'text' as const,format:'singleline' as const}]}
  const source={...snapshot,definitions:[initial],blocks:[{...snapshot.blocks[0]!,fields:{title:'First',count:'Second'}}]}
  const target={...initial,versionId:'v2',fields:[{...initial.fields[0]!,name:'count',format:'markdown' as const},{...initial.fields[1]!,name:'title'}]}
  expect(migrateSnapshot(source,[target],2).snapshot.blocks[0]!.fields).toEqual({count:'First',title:'Second'})
})
