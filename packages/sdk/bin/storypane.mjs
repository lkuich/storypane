#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStorypaneClient } from '../dist/index.js';
import { generateTypes, parseStorypaneSchema } from '../dist/codegen.js';

function setting(name) {
  const value = process.env[`STORYPANE_${name}`] ?? process.env[`BLOK_${name}`];
  if (!value) throw new Error(`Missing STORYPANE_${name}`);
  return value;
}

try {
  const { values, positionals } = parseArgs({ allowPositionals:true, options:{ input:{ type:'string' }, out:{ type:'string' }, help:{ type:'boolean',short:'h' } } });
  const [command] = positionals;
  if (values.help) {
    console.log('storypane pull-components --out storypane/components.json\nstorypane generate-types --input storypane/components.json --out src/types/storypane.ts\n\nPull uses STORYPANE_URL, STORYPANE_SPACE_ID, STORYPANE_PREVIEW_TOKEN from the environment. Legacy BLOK_* settings are also accepted.');
  } else {
    if (positionals.length !== 1 || !['pull-components','generate-types'].includes(command) || !values.out) throw new Error('Use storypane --help for commands and required flags');
    let output;
    if (command === 'pull-components') {
      if (values.input) throw new Error('--input is only valid for generate-types');
      const client = createStorypaneClient({ url:setting('URL'), spaceId:setting('SPACE_ID'), token:setting('PREVIEW_TOKEN') });
      output = JSON.stringify(parseStorypaneSchema(await client.getSchema()),null,2) + '\n';
    } else {
      if (!values.input) throw new Error('generate-types requires --input');
      if (resolve(values.input) === resolve(values.out)) throw new Error('Input and output must be different files');
      output = generateTypes(JSON.parse(await readFile(values.input,'utf8')));
    }
    await mkdir(dirname(values.out),{ recursive:true });
    const temporary = `${values.out}.${randomUUID()}.tmp`;
    try { await writeFile(temporary,output,{ flag:'wx' }); await rename(temporary,values.out); }
    finally { await rm(temporary,{ force:true }); }
    console.log(`Wrote ${values.out}`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Storypane command failed'); process.exitCode = 1; }
