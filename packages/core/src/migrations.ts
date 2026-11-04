import { StorypaneError, type BlockDefinition, type DefinitionInput, type FieldDefinition, type LocaleSnapshot } from './index.js'

export type SchemaMigration = {
  id:string; spaceId:string; version:number; baseVersion:number; name:string; status:'active'|'deployed'; revision:number;
  definitions:BlockDefinition[]; contributors:string[]; createdAt:string; deployedAt:string|null; deployedBy:string|null;
}
export type MigrationFile = {
  formatVersion:1; id:string; spaceId:string; version:number; baseVersion:number; name:string;
  definitions:{ id:string; schema:DefinitionInput }[];
  remoteRevision:number|null; sourceHash:string|null; status:'active'|'deployed';
}
export type MigrationChange = { definition:string; field?:string; kind:'added'|'removed'|'renamed'|'reset'|'changed'; before?:unknown; after?:unknown }
export type MigrationImpact = { storyId:string; localeId:string; name:string; locale:string; target:'draft'|'published'; deletedValues:number; resetValues:number; deletedBlocks:number }
export type MigrationReview = { migration:SchemaMigration; token:string; changes:MigrationChange[]; impacts:MigrationImpact[]; blockers:{path:string;message:string}[] }
export type ManagementToken = { id:string; name:string; capability:'read'|'stage'|'deploy'; createdAt:string }

export function definitionInput(definition:BlockDefinition):DefinitionInput {
  const { id:_id, versionId:_versionId, version:_version, createdAt:_createdAt, ...input } = definition
  return input
}
export function compatibleFields(before:FieldDefinition, after:FieldDefinition):boolean {
  return before.type === after.type &&
    !(before.type === 'text' && after.type === 'text' && (before.format === 'richtext') !== (after.format === 'richtext')) &&
    !(before.type === 'datetime' && after.type === 'datetime' && before.mode !== after.mode)
}
export function canonicalJson(value:unknown):string {
  return JSON.stringify(value, (_key,item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item)
}
export function migrationChanges(before:BlockDefinition[], after:BlockDefinition[]):MigrationChange[] {
  const changes:MigrationChange[]=[]
  for(const target of after) {
    const source=before.find(item=>item.id===target.id)
    if(!source) { changes.push({definition:target.name,kind:'added',after:definitionInput(target)}); continue }
    for(const old of source.fields) {
      const field=target.fields.find(item=>item.id===old.id)
      if(!field)changes.push({definition:target.name,field:old.name,kind:'removed',before:old})
      else if(canonicalJson(old)!==canonicalJson(field))changes.push({definition:target.name,field:old.name,kind:!compatibleFields(old,field)?'reset':old.name!==field.name?'renamed':'changed',before:old,after:field})
    }
    for(const field of target.fields)if(!source.fields.some(old=>old.id===field.id))changes.push({definition:target.name,field:field.name,kind:'added',after:field})
    const {fields:_oldFields,...oldConfig}=definitionInput(source), {fields:_fields,...config}=definitionInput(target)
    if(canonicalJson(oldConfig)!==canonicalJson(config) || source.fields.map(f=>f.id).join()!==target.fields.map(f=>f.id).join())changes.push({definition:target.name,kind:'changed',before:oldConfig,after:config})
  }
  return changes
}

/** Work from original names, so swaps and nested-field renames never overwrite values. */
export function migrateSnapshot(source:LocaleSnapshot, definitions:BlockDefinition[], migrationVersion:number) {
  const snapshot=structuredClone(source)
  let deletedValues=0, resetValues=0
  const removed=new Set<string>(), original=new Map(source.blocks.map(block=>[block.id,block]))
  function remove(id:string) { if(removed.has(id))return; removed.add(id); for(const child of source.blocks)if(child.parentId===id)remove(child.id) }
  for(const block of source.blocks) {
    const old=source.definitions.find(definition=>definition.versionId===block.schemaVersionId),target=definitions.find(definition=>definition.id===block.definitionId)
    for(const field of old?.fields ?? [])if(field.type==='blocks') {
      const next=target?.fields.find(item=>item.id===field.id)
      if(!next || !compatibleFields(field,next))for(const child of source.blocks)if(child.parentId===block.id && child.parentField===field.name)remove(child.id)
    }
  }
  for(const block of snapshot.blocks) {
    if(removed.has(block.id))continue
    const old=source.definitions.find(definition=>definition.versionId===block.schemaVersionId)
    const target=definitions.find(definition=>definition.id===block.definitionId)
    if(!old || !target)throw new StorypaneError('invalid','Migration is missing a block definition')
    const fields:typeof block.fields={}
    for(const field of old.fields) {
      const next=target.fields.find(item=>item.id===field.id)
      if(!next || !compatibleFields(field,next)) {
        if(field.type==='blocks') { for(const child of source.blocks)if(child.parentId===block.id && child.parentField===field.name)remove(child.id) }
        else if(Object.hasOwn(block.fields,field.name)) { if(next)resetValues++;else deletedValues++ }
      }
    }
    for(const field of target.fields) {
      const previous=old.fields.find(item=>item.id===field.id)
      if(previous && compatibleFields(previous,field)) {
        if(field.type==='blocks') { for(const child of snapshot.blocks)if(original.get(child.id)?.parentId===block.id && original.get(child.id)?.parentField===previous.name)child.parentField=field.name }
        else if(Object.hasOwn(block.fields,previous.name))fields[field.name]=block.fields[previous.name]!
      } else if(field.type!=='blocks' && field.defaultValue!==undefined)fields[field.name]=structuredClone(field.defaultValue)
    }
    block.fields=fields; block.schemaVersionId=target.versionId
    block.revision++
  }
  snapshot.blocks=snapshot.blocks.filter(block=>!removed.has(block.id))
  snapshot.definitions=definitions.filter(definition=>snapshot.blocks.some(block=>block.definitionId===definition.id))
  snapshot.leases=[]
  snapshot.migrationVersion=migrationVersion
  return {snapshot,deletedValues,resetValues,deletedBlocks:removed.size}
}
