import { blockClipboardSchema,StorypaneError,type BlockClipboard,type Json,type LocaleSnapshot } from './index.js'

const clipboardLimit=1024*1024

export function createBlockClipboard(snapshot:LocaleSnapshot,spaceId:string,blockId:string,overrides:Record<string,{fields:Record<string,Json>}>={}):BlockClipboard {
  const blocks:BlockClipboard['blocks']=[],seen=new Set<string>()
  function visit(id:string,parentIndex:number|null,depth:number) {
    if(seen.has(id) || depth>30 || blocks.length>=1000)throw new StorypaneError('invalid','This block is too large or too deeply nested to copy')
    const block=snapshot.blocks.find(item=>item.id===id)
    if(!block)throw new StorypaneError('not_found','The block to copy no longer exists')
    seen.add(id)
    const index=blocks.length
    blocks.push({definitionId:block.definitionId,parentIndex,parentField:parentIndex===null?null:block.parentField,position:block.position,fields:structuredClone(overrides[id]?.fields ?? block.fields)})
    snapshot.blocks.filter(child=>child.parentId===id).sort((a,b)=>(a.parentField ?? '').localeCompare(b.parentField ?? '') || a.position-b.position || a.id.localeCompare(b.id)).forEach(child=>visit(child.id,index,depth+1))
  }
  visit(blockId,null,0)
  return blockClipboardSchema.parse({type:'storypane/block',version:1,spaceId,migrationVersion:snapshot.migrationVersion ?? 0,blocks})
}

export function serializeBlockClipboard(clipboard:BlockClipboard):string {
  const text=JSON.stringify(clipboard)
  if(new TextEncoder().encode(text).byteLength>clipboardLimit)throw new StorypaneError('invalid','This block is too large to copy (maximum 1 MiB)')
  return text
}

export function parseBlockClipboard(text:string):BlockClipboard {
  if(text.length>clipboardLimit || new TextEncoder().encode(text).byteLength>clipboardLimit)throw new StorypaneError('invalid','The copied block exceeds 1 MiB')
  let value:unknown
  try { value=JSON.parse(text) } catch { throw new StorypaneError('invalid','Copy a block from Storypane before pasting') }
  const result=blockClipboardSchema.safeParse(value)
  if(!result.success)throw new StorypaneError('invalid','This is not a valid copied Storypane block. Copy the block again.')
  return result.data
}
