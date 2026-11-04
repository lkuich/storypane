import { expect,it } from 'vitest';
import { generateTypes } from './codegen.js';
import type { BlokSchema } from './types.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';

const schema:BlokSchema = { components:[
  { id:'page',name:'page',kind:'content-type',version:1,fields:[{ name:'body',type:'blocks',allowedDefinitionIds:['hero'] }] },
  { id:'hero',name:'hero',kind:'universal',version:2,fields:[
    { name:'title',type:'text',required:true },{ name:'description',type:'text',format:'markdown' },
    { name:'count',type:'number' },{ name:'date',type:'datetime' },{ name:'enabled',type:'boolean' },
    { name:'theme',type:'option',required:true,options:['light','dark','quote"\n'] },
    { name:'tags',type:'options',options:['one','two'] },{ name:'remote',type:'option' },
    { name:'image',type:'asset' },{ name:'link',type:'link' },{ name:'body',type:'text',format:'richtext' },
    { name:'children',type:'blocks' },
  ] },
] };
it('generates deterministic discriminated types with constrained nesting and real field shapes',() => {
  const output = generateTypes(schema);
  expect(output).toBe(generateTypes({ components:[...schema.components].reverse() }));
  expect(output).toContain('"body": Array<HeroBlok>');
  expect(output).toContain('"theme": "light" | "dark" | "quote\\\"\\n"');
  expect(output).toContain('export type BlokNestable = HeroBlok;');
  const dir = mkdtempSync(join(tmpdir(),'blok-types-'));
  try {
    const source = join(dir,'check.ts');
    // Use the SDK's real field types without depending on temporary-directory package resolution.
    writeFileSync(source,output.replace("from '@blok/sdk'",`from ${JSON.stringify(new URL('./types.js',import.meta.url).pathname)}`) + `
const hero: HeroBlok = { _uid:'1',component:'hero',title:'Hello',theme:'light',children:[] };
const page: PageBlok = { _uid:'2',component:'page',body:[hero] };
// @ts-expect-error Content types cannot be nested in this field.
page.body = [page];
// @ts-expect-error Inline option values are a literal union.
hero.theme = 'invalid';
// @ts-expect-error Required fields cannot be omitted.
const incomplete: HeroBlok = { _uid:'3',component:'hero',children:[] };
hero.image = { assetId:'asset',alt:'Alternative text' };
hero.link = { type:'story',storyId:'story' };
hero.body = { type:'doc',content:[{ type:'paragraph',content:[{ type:'text',text:'Safe' }] }] };
hero.count = null; hero.enabled = ''; hero.tags = ['two'];
`);
    const check = spawnSync(resolve('node_modules/.bin/tsc'),['--strict','--noEmit','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',source],{ cwd:dir,encoding:'utf8' });
    expect(check.status,check.stdout + check.stderr).toBe(0);
  } finally { rmSync(dir,{ recursive:true,force:true }); }
});
it('rejects invalid identifiers, collisions, fields, and missing nested schema references',() => {
  for (const mutate of [
    (value:BlokSchema) => { value.components[0].name = 'bad;export'; },
    (value:BlokSchema) => { value.components[0].name = 'hero_'; },
    (value:BlokSchema) => { value.components[0].fields[0].name = 'constructor'; },
    (value:BlokSchema) => { value.components[0].fields[0].allowedDefinitionIds = ['missing']; },
    (value:BlokSchema) => { value.components[0].fields.push(value.components[0].fields[0]); },
    (value:BlokSchema) => { value.components[1].kind = 'content-type'; },
  ]) { const changed = structuredClone(schema); mutate(changed); expect(() => generateTypes(changed)).toThrow(); }
  expect(() => generateTypes({ components:[{ name:'injected' }] })).toThrow();
  expect(generateTypes({ components:[] })).toContain('export type BlokComponent = never;');
});
it('generates tag-restricted unions, including never when no nestable block matches',() => {
  const tagged = structuredClone(schema);
  tagged.components[0].tags = ['layout'];
  tagged.components[1].tags = ['layout'];
  tagged.components[0].fields = [{ name:'body',type:'blocks',allowedTags:['layout','marketing'] }];
  expect(generateTypes(tagged)).toContain('"body": Array<HeroBlok>');
  tagged.components[1].tags = [];
  expect(generateTypes(tagged)).toContain('"body": Array<never>');
  tagged.components[0].fields[0].allowedTags = [];
  expect(generateTypes(tagged)).toContain('"body": BlokNestable[]');
  tagged.components[0].fields[0].allowedTags = [''];
  expect(() => generateTypes(tagged)).toThrow();
  tagged.components[0].fields[0].allowedTags = ['layout'];
  tagged.components[1].tags = ['layout','layout'];
  expect(() => generateTypes(tagged)).toThrow();
});
