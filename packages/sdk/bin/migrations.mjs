import { createHash,randomUUID } from 'node:crypto';
import { link,mkdir,readFile,readdir,rename,rm,writeFile } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const directory='storypane/migrations';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonical=value=>JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const contentHash=file=>createHash('sha256').update(canonical({name:file.name,definitions:file.definitions})).digest('hex');
export async function writeAtomic(path,value,exclusive=false) {
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.${randomUUID()}.tmp`;
  try {await writeFile(temporary,value,{flag:'wx'});if(exclusive)await link(temporary,path);else await rename(temporary,path)}finally{await rm(temporary,{force:true})}
}
export function validateMigration(file) {
  if(!file || file.formatVersion!==1 || !uuid.test(file.id) || !uuid.test(file.spaceId) || !Number.isSafeInteger(file.version) || file.version<0 || !Number.isSafeInteger(file.baseVersion) || file.baseVersion!==Math.max(0,file.version-1) || typeof file.name!=='string' || !file.name.trim() || file.name.length>120 || !['active','deployed'].includes(file.status) || !Array.isArray(file.definitions) || file.definitions.length>10000 || !(file.remoteRevision===null || Number.isSafeInteger(file.remoteRevision) && file.remoteRevision>0) || !(file.sourceHash===null || /^[a-f0-9]{64}$/.test(file.sourceHash)))throw new Error('Invalid migration file');
  const ids=new Set(),names=new Set();
  for(const definition of file.definitions) {
    if(!definition || !(uuid.test(definition.id) || file.status==='active' && definition.id===undefined) || !definition.schema || typeof definition.schema.name!=='string' || !/^[a-z][a-z0-9_]{0,79}$/.test(definition.schema.name) || !['nestable','content-type','universal'].includes(definition.schema.kind) || !Array.isArray(definition.schema.fields) || definition.schema.fields.length>200 || (definition.id!==undefined && ids.has(definition.id)) || names.has(definition.schema.name))throw new Error('Invalid or duplicate migration definition');
    if(definition.id)ids.add(definition.id);names.add(definition.schema.name);
    const fields=new Set(),fieldIds=new Set();
    for(const field of definition.schema.fields) {
      if(!field || typeof field.name!=='string' || !/^[a-z][a-z0-9_]{0,79}$/.test(field.name) || ['component','_uid','constructor','prototype','__proto__'].includes(field.name) || fields.has(field.name) || !['text','number','datetime','boolean','option','options','asset','link','blocks'].includes(field.type) || (field.id && (!uuid.test(field.id) || fieldIds.has(field.id))))throw new Error(`Invalid field in ${definition.schema.name}`);
      fields.add(field.name);if(field.id)fieldIds.add(field.id);
    }
  }
  return file;
}
export function migrationFile(migration) {
  const definitions=migration.definitions.map(({id,versionId:_versionId,version:_version,createdAt:_createdAt,...schema})=>({id,schema}));
  const file={formatVersion:1,id:migration.id,spaceId:migration.spaceId,version:migration.version,baseVersion:migration.baseVersion,name:migration.name,status:migration.status,definitions,remoteRevision:migration.revision,sourceHash:null};
  file.sourceHash=contentHash(file);
  return validateMigration(file);
}
export function schemaFromMigration(file) {
  validateMigration(file);
  if(file.status!=='deployed' || file.version<1)throw new Error('Generate types from a deployed migration; deploy the initial migration first');
  return {migrationVersion:file.version,components:file.definitions.map(({id,schema})=>({id,name:schema.name,kind:schema.kind,version:1,tags:schema.tags ?? [],fields:schema.fields.map(field=>({name:field.name,type:field.type,required:field.required ?? false,...(field.type==='text'?{format:field.format ?? 'singleline'}:{}),...(field.type==='blocks'?{allowedDefinitionIds:field.allowedDefinitionIds ?? [],allowedTags:field.allowedTags ?? []}:{}),...(['option','options'].includes(field.type) && field.source?.type==='inline'?{options:field.source.items.map(item=>item.value)}:{})}))}))};
}
async function readJson(path) {
  const raw=await readFile(path,'utf8');
  if(Buffer.byteLength(raw)>2*1024*1024)throw new Error(`Migration exceeds the 2 MiB request limit: ${path}`);
  return JSON.parse(raw);
}
async function optionalFile(path) {try{return validateMigration(await readJson(path))}catch(error){if(error.code==='ENOENT')return null;throw error}}
async function replaceActive(dir,expected,next) {
  const path=join(dir,'active.json'),current=await optionalFile(path);
  if(canonical(current)!==canonical(expected))throw new Error('The local active file changed during synchronization. Your edits are preserved; pull to a separate directory to reconcile.');
  if(next)await writeAtomic(path,JSON.stringify(next,null,2)+'\n',current===null);
  else if(current)await rm(path);
}
export async function localMigrations(dir=directory) {
  const names=await readdir(dir).catch(error=>{if(error.code==='ENOENT')return [];throw error});
  const deployed=[];
  for(const name of names.filter(name=>/^\d+\.json$/.test(name)).sort((a,b)=>Number(a.slice(0,-5))-Number(b.slice(0,-5)))) {
    const file=validateMigration(await readJson(join(dir,name)));
    if(file.status!=='deployed' || file.version!==Number(name.slice(0,-5)) || (deployed.length?file.baseVersion!==deployed.at(-1).version:file.version>1) || (deployed.length && deployed[0].spaceId!==file.spaceId) || file.sourceHash!==contentHash(file))throw new Error(`Migration history is modified, incomplete, or from another space: ${name}`);
    deployed.push(file);
  }
  return {deployed,active:await optionalFile(join(dir,'active.json'))};
}
function client(setting) {
  const base=new URL(setting('URL')),spaceId=setting('SPACE_ID'),token=setting('MANAGEMENT_TOKEN');
  if(base.username || base.password || !(base.protocol==='https:' || base.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new Error('Management requests require HTTPS or localhost HTTP');
  return async(path='',body)=>{
    const response=await fetch(new URL(`/api/cms/migrations${path}`,base),{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'x-blok-space-id':spaceId,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path.endsWith('/deploy')?120000:20000)});
    const result=await response.json();
    if(!response.ok)throw new Error(`${result.error?.message ?? `Migration request failed (${response.status})`}${result.error?.details?.length?'\n'+result.error.details.map(issue=>`${issue.path}: ${issue.message}`).join('\n'):''}`);
    return result;
  };
}
export async function pullMigrations(request,dir=directory) {
  const remote=(await request()).map(migrationFile).sort((a,b)=>a.version-b.version),local=await localMigrations(dir);
  if(!remote.length)throw new Error('The space has no migration baseline');
  const deployed=remote.filter(file=>file.status==='deployed'),active=remote.find(file=>file.status==='active') ?? null;
  for(const file of local.deployed)if(!deployed.some(other=>other.version===file.version && canonical(other)===canonical(file)))throw new Error('Local deployed history differs from the server. Pull to a separate --out directory to compare.');
  let next=active;
  if(local.active) {
    const own=local.active,hash=contentHash(own),alreadyDeployed=deployed.find(file=>file.id===own.id);
    if(own.spaceId!==remote[0].spaceId)throw new Error('Local migration belongs to another space');
    if(alreadyDeployed) {
      if(hash!==contentHash(alreadyDeployed))throw new Error('Local edits differ from the deployed migration. Pull to a separate --out directory to compare.');
    } else if(active) {
      if(active.id!==own.id || hash!==own.sourceHash && hash!==contentHash(active) && own.sourceHash!==contentHash(active))throw new Error('Local and remote active migrations diverged. Pull to a separate --out directory and reconcile your edits.');
      if(hash!==own.sourceHash && own.sourceHash===contentHash(active))next={...own,remoteRevision:active.remoteRevision};
    } else {
      if(own.baseVersion!==deployed.at(-1)?.version)throw new Error('The deployed base changed. Preserve your active file and reconcile with a separate pull.');
      next=own;
    }
  }
  for(const file of deployed)await writeAtomic(join(dir,`${file.version}.json`),JSON.stringify(file,null,2)+'\n');
  await replaceActive(dir,local.active,next);
  return {deployed,active:next};
}
export async function createMigration(name,dir=directory) {
  if(!name?.trim() || name.length>120)throw new Error('Provide a migration description of 1–120 characters');
  const local=await localMigrations(dir);
  if(local.active)throw new Error('An active migration already exists. Edit it instead.');
  const base=local.deployed.at(-1);
  if(!base)throw new Error('Run storypane migrations pull first');
  const file={formatVersion:1,id:randomUUID(),spaceId:base.spaceId,version:base.version+1,baseVersion:base.version,name:name.trim(),status:'active',definitions:base.definitions,remoteRevision:null,sourceHash:null};
  await replaceActive(dir,null,file);
  return file;
}
function printReview(review) {
  console.log(`Migration ${review.migration.version}: ${review.migration.name}`);
  for(const change of review.changes)console.log(`${change.kind}: ${change.definition}${change.field?'.'+change.field:''}\n${JSON.stringify({before:change.before,after:change.after},null,2)}`);
  for(const impact of review.impacts)console.log(`${impact.name} / ${impact.locale} (${impact.target}): ${impact.deletedValues} values deleted, ${impact.resetValues} reset, ${impact.deletedBlocks} blocks deleted`);
  for(const blocker of review.blockers)console.error(`${blocker.path}: ${blocker.message}`);
}
export async function pushMigration(request,{deploy=false,yes=false,dir=directory}={}) {
  const local=await localMigrations(dir),file=local.active;
  if(!file || file.status!=='active')throw new Error('Create or pull an active migration first');
  if(!local.deployed.length || local.deployed.at(-1).version!==file.baseVersion || local.deployed[0].spaceId!==file.spaceId)throw new Error('Pull the complete deployed history for this migration before pushing');
  if(yes && !deploy)throw new Error('--yes requires --deploy');
  if(deploy && !yes && !process.stdin.isTTY)throw new Error('Noninteractive deployment requires --deploy --yes');
  const original=structuredClone(file);
  for(const definition of file.definitions){if(!definition.id)definition.id=randomUUID();for(const field of definition.schema.fields)if(!field.id)field.id=randomUUID();}
  await replaceActive(dir,original,file);
  const staged=await request('',file);
  if(staged.status==='deployed') {await pullMigrations(request,dir);console.log(`Migration ${staged.version} is already deployed`);return staged}
  await replaceActive(dir,file,migrationFile(staged));
  if(!deploy){console.log(`Staged migration ${staged.version}`);return staged}
  const review=await request(`/${staged.id}/review`);
  if(review.migration.revision!==staged.revision || contentHash(migrationFile(review.migration))!==contentHash(migrationFile(staged)))throw new Error('The shared migration changed after pushing. Pull and review the new changes before deploying.');
  printReview(review);
  if(review.blockers.length)throw new Error('Deployment blocked; resolve the listed validation errors');
  if(!yes) {
    const prompt=createInterface({input:process.stdin,output:process.stdout});
    try {if((await prompt.question('Deploy this migration? [y/N] ')).trim().toLowerCase()!=='y'){console.log('Migration remains staged');return staged}}finally{prompt.close()}
  }
  const deployed=await request(`/${staged.id}/deploy`,{reviewToken:review.token});
  await pullMigrations(request,dir);
  console.log(`Deployed migration ${deployed.version}`);
  return deployed;
}
export async function runMigrations(positionals,values,setting) {
  const [command,name,...extra]=positionals;
  if(values.input || extra.length || command!=='create' && name || command!=='pull' && values.out || command!=='push' && (values.deploy || values.yes))throw new Error('Invalid migration command arguments; use storypane --help');
  if(command==='create'){const file=await createMigration(name);console.log(`Created migration ${file.version}: edit ${directory}/active.json`);return}
  const request=client(setting);
  if(command==='pull'){const result=await pullMigrations(request,values.out?resolve(values.out):directory);console.log(`Pulled migration ${result.deployed.at(-1)?.version ?? 0}${result.active?' and active changes':''}`);return}
  if(command==='push'){await pushMigration(request,{deploy:values.deploy,yes:values.yes});return}
  throw new Error('Use migrations pull, create, or push');
}
