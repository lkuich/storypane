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
it('reports added and removed fields without an unchanged block entry',()=>{
  const added={id:'d',name:'hero_image',label:'Hero image',type:'asset' as const}
  const target={...definition,versionId:'v2',version:2,fields:[definition.fields[0]!,added,...definition.fields.slice(1)]}
  expect(migrationChanges([definition],[target])).toEqual([{definition:'page',field:'hero_image',kind:'added',after:added}])
  expect(migrationChanges([target],[definition])).toEqual([{definition:'page',field:'hero_image',kind:'removed',before:added}])
  expect(migrationChanges([definition],[{...definition,versionId:'v2',version:2,createdAt:'later'}])).toEqual([])
})
it('shows the field order when existing fields are reordered, including alongside additions and removals',()=>{
  const added={id:'d',name:'hero_image',label:'Hero image',type:'asset' as const}
  for(const fields of [
    [definition.fields[2]!,definition.fields[0]!,definition.fields[1]!],
    [definition.fields[2]!,added,definition.fields[0]!],
  ]) {
    const changes=migrationChanges([definition],[{...definition,fields}])
    expect(changes.filter(change=>!change.field)).toEqual([{
      definition:'page',kind:'changed',
      before:{name:'page',displayName:'Page',kind:'content-type',fieldOrder:definition.fields.map(field=>field.name)},
      after:{name:'page',displayName:'Page',kind:'content-type',fieldOrder:fields.map(field=>field.name)},
    }])
  }
})
it('still reports genuine block configuration changes without field-order noise',()=>{
  expect(migrationChanges([definition],[{...definition,displayName:'Landing page'}])).toEqual([{
    definition:'page',kind:'changed',
    before:{name:'page',displayName:'Page',kind:'content-type'},
    after:{name:'page',displayName:'Landing page',kind:'content-type'},
  }])
})
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
it('destructive migration prunes disallowed subtrees, keeps earliest allowed blocks, and resets invalid values',()=>{
  const page={...definition,kind:'universal' as const}
  const forbidden={...page,id:'forbidden',versionId:'forbidden-v1',kind:'nestable' as const}
  const source={...snapshot,definitions:[page,forbidden],blocks:[
    snapshot.blocks[0]!,
    {...snapshot.blocks[1]!,id:'last',position:2,fields:{title:'Last',count:20}},
    {...snapshot.blocks[1]!,id:'first',position:0},
    {...snapshot.blocks[1]!,id:'forbidden',definitionId:forbidden.id,schemaVersionId:forbidden.versionId,position:1},
    {...snapshot.blocks[1]!,id:'grandchild',parentId:'forbidden'},
  ]}
  const target={...page,versionId:'v2',fields:page.fields.map(field=>field.type==='blocks'?{...field,allowedDefinitionIds:['page'],maxItems:1}:field.type==='number'?{...field,max:5,defaultValue:0}:field)}
  expect(migrateSnapshot(source,[target,forbidden],2).snapshot.blocks).toHaveLength(5)
  const result=migrateSnapshot(source,[target,forbidden],2,true)
  expect(result.snapshot.blocks.map(block=>block.id)).toEqual(['root','first'])
  expect(result.snapshot.blocks[0]!.fields).toEqual({title:'Keep',count:0})
  expect(result).toMatchObject({deletedBlocks:3,resetValues:1})
  expect(source.blocks).toHaveLength(5)
  expect(source.blocks[0]!.fields.count).toBe(12)
})
it('counts removed blocks separately from value resets inside those blocks',()=>{
  const target={...definition,versionId:'v2',fields:definition.fields.map(field=>field.type==='text'?{id:field.id,name:field.name,label:field.label,type:'number' as const}:field)}
  const result=migrateSnapshot(snapshot,[target],2,true)
  expect(result).toMatchObject({deletedBlocks:1,resetValues:1,deletedValues:0})
})
