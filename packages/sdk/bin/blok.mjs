#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBlokClient } from '../dist/index.js';
import { generateTypes, parseBlokSchema } from '../dist/codegen.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals:true, options:{ input:{ type:'string' }, out:{ type:'string' }, help:{ type:'boolean',short:'h' } } });
  const [command] = positionals;
  if (values.help) {
    console.log('blok pull-components --out blok/components.json\nblok generate-types --input blok/components.json --out src/types/blok.ts\n\nPull uses BLOK_URL, BLOK_SPACE_ID, BLOK_PREVIEW_TOKEN from the environment.');
  } else {
    if (positionals.length !== 1 || !['pull-components','generate-types'].includes(command) || !values.out) throw new Error('Use blok --help for commands and required flags');
    let output;
    if (command === 'pull-components') {
      for (const name of ['BLOK_URL','BLOK_SPACE_ID','BLOK_PREVIEW_TOKEN']) if (!process.env[name]) throw new Error(`Missing ${name}`);
      if (values.input) throw new Error('--input is only valid for generate-types');
      const client = createBlokClient({ url:process.env.BLOK_URL, spaceId:process.env.BLOK_SPACE_ID, token:process.env.BLOK_PREVIEW_TOKEN });
      output = JSON.stringify(parseBlokSchema(await client.getSchema()),null,2) + '\n';
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
} catch (error) { console.error(error instanceof Error ? error.message : 'Blok command failed'); process.exitCode = 1; }
