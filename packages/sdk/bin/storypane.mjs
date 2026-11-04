#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStorypaneClient } from '../dist/index.js';
import { generateTypes,parseStorypaneSchema } from '../dist/codegen.js';
import { localMigrations,runMigrations,schemaFromMigration,writeAtomic } from './migrations.mjs';

function setting(name) {
  const value=process.env[`STORYPANE_${name}`] ?? process.env[`BLOK_${name}`];
  if(!value)throw new Error(`Missing STORYPANE_${name}`);
  return value;
}
try {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{input:{type:'string'},out:{type:'string'},deploy:{type:'boolean'},yes:{type:'boolean'},help:{type:'boolean',short:'h'}}});
  const [command]=positionals;
  if(values.help) {
    console.log(`storypane migrations pull [--out directory]
storypane migrations create "description"
storypane migrations push [--deploy [--yes]]
storypane generate-types [--input deployed-schema.json] --out src/types/storypane.ts
storypane pull-components --out storypane/components.json

Migrations use STORYPANE_URL, STORYPANE_SPACE_ID, STORYPANE_MANAGEMENT_TOKEN.
Local migrations live in storypane/migrations; commit them with your app.
Default codegen uses the latest pulled deployed migration, never active.json.
CI deployment requires --deploy --yes and a deploy-capable management token.
Legacy pull-components uses STORYPANE_PREVIEW_TOKEN. BLOK_* settings are also accepted.`);
  } else if(command==='migrations')await runMigrations(positionals.slice(1),values,setting);
  else {
    if(positionals.length!==1 || !['pull-components','generate-types'].includes(command) || !values.out || values.deploy || values.yes)throw new Error('Use storypane --help for commands and required flags');
    let output;
    if(command==='pull-components') {
      if(values.input)throw new Error('--input is only valid for generate-types');
      const client=createStorypaneClient({url:setting('URL'),spaceId:setting('SPACE_ID'),token:setting('PREVIEW_TOKEN')});
      output=JSON.stringify(parseStorypaneSchema(await client.getSchema()),null,2)+'\n';
    } else {
      if(values.input && resolve(values.input)===resolve(values.out))throw new Error('Input and output must be different files');
      const value=values.input?JSON.parse(await readFile(values.input,'utf8')):(await localMigrations()).deployed.at(-1);
      if(!value)throw new Error('Run storypane migrations pull before generating types');
      output=generateTypes(value.formatVersion===1?schemaFromMigration(value):value);
    }
    await writeAtomic(values.out,output);
    console.log(`Wrote ${values.out}`);
  }
} catch(error){console.error(error instanceof Error?error.message:'Storypane command failed');process.exitCode=1}
