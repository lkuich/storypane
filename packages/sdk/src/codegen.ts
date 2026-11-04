import type { BlokSchema, BlokSchemaField } from './types.js';

const kinds = ['nestable','content-type','universal'];
const fieldTypes = ['text','number','datetime','boolean','option','options','asset','link','blocks'];
const formats = ['singleline','textarea','richtext','markdown'];
const identifier = /^[a-z][a-z0-9_]{0,79}$/;
const reserved = new Set(['component','_uid','__proto__','constructor','prototype']);
const typeName = (name:string) => name.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('') + 'Blok';
const strings = (value:unknown, max:number) => Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && item.length <= 500);
const tags = (value:unknown) => strings(value,50) && (value as string[]).every(tag => tag.trim().length > 0 && tag.length <= 64) && new Set(value as string[]).size === (value as string[]).length;
const record = (value:unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate downloaded/local JSON before interpolating it into source code. */
export function parseBlokSchema(value:unknown): BlokSchema {
  if (!record(value) || !Array.isArray(value.components) || value.components.length > 10000) throw new Error('Expected a schema with a components array');
  const names = new Set<string>(), ids = new Set<string>();
  for (const component of value.components) {
    if (!record(component) || typeof component.name !== 'string' || !identifier.test(component.name) ||
      typeof component.id !== 'string' || !component.id || component.id.length > 100 || !kinds.includes(String(component.kind)) ||
      !Number.isSafeInteger(component.version) || Number(component.version) < 1 || !Array.isArray(component.fields) || component.fields.length > 200 ||
      (component.tags !== undefined && !tags(component.tags))) throw new Error('Invalid component schema');
    const name = typeName(component.name);
    if (names.has(name) || ids.has(component.id)) throw new Error(`Duplicate component or TypeScript name: ${component.name}`);
    names.add(name); ids.add(component.id);
    const fields = new Set<string>();
    for (const field of component.fields) {
      if (!record(field) || typeof field.name !== 'string' || !identifier.test(field.name) || reserved.has(field.name) || fields.has(field.name) ||
        !fieldTypes.includes(String(field.type)) || (field.required !== undefined && typeof field.required !== 'boolean') ||
        (field.format !== undefined && !formats.includes(String(field.format))) ||
        (field.options !== undefined && !strings(field.options,1000)) ||
        (field.allowedDefinitionIds !== undefined && !strings(field.allowedDefinitionIds,500)) ||
        (field.allowedTags !== undefined && !tags(field.allowedTags))) throw new Error(`Invalid field schema in ${component.name}`);
      if (Array.isArray(field.allowedTags) && field.allowedTags.length && Array.isArray(field.allowedDefinitionIds) && field.allowedDefinitionIds.length) throw new Error(`Conflicting block restrictions in ${component.name}`);
      fields.add(field.name);
    }
  }
  const schema = value as unknown as BlokSchema;
  for (const component of schema.components) for (const field of component.fields) {
    if (field.type === 'blocks') for (const id of field.allowedDefinitionIds ?? []) {
      const target = schema.components.find(item => item.id === id);
      if (!target || target.kind === 'content-type') throw new Error(`Invalid nested block reference in ${component.name}.${field.name}`);
    }
  }
  return schema;
}

export function generateTypes(value:unknown): string {
  const { components } = parseBlokSchema(value);
  const sorted = [...components].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const helpers = new Set<string>();
  const union = (names:string[]) => [...new Set(names)].join(' | ') || 'never';
  function fieldType(field:BlokSchemaField): string {
    switch (field.type) {
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'datetime': return 'string';
      case 'text': if (field.format !== 'richtext') return 'string'; helpers.add('BlokRichText'); return 'BlokRichText';
      case 'asset': helpers.add('BlokAsset'); return 'BlokAsset';
      case 'link': helpers.add('BlokLink'); return 'BlokLink';
      case 'option': return field.options ? union(field.options.map(value => JSON.stringify(value))) : 'string';
      case 'options': return `Array<${field.options ? union(field.options.map(value => JSON.stringify(value))) : 'string'}>`;
      case 'blocks': return field.allowedDefinitionIds?.length || field.allowedTags?.length
        ? `Array<${union(sorted.filter(item => item.kind !== 'content-type' && (!field.allowedDefinitionIds?.length || field.allowedDefinitionIds.includes(item.id)) && (!field.allowedTags?.length || field.allowedTags.some(tag => item.tags?.includes(tag)))).map(item => typeName(item.name)))}>`
        : 'BlokNestable[]';
    }
  }
  const interfaces = sorted.map(component => `export interface ${typeName(component.name)} {\n  _uid: string;\n  component: ${JSON.stringify(component.name)};\n${component.fields.map(field => {
    const type = fieldType(field), required = field.required || field.type === 'blocks';
    // Empty optional values are retained by the CMS; drafts can also omit required fields.
    const empty = required ? '' : type === 'string' ? ' | null' : ' | null | ""';
    return `  ${JSON.stringify(field.name)}${required ? '' : '?'}: ${type}${empty};`;
  }).join('\n')}\n}`);
  return [
    '// Generated by @blok/sdk. Do not edit; run your blok:generate script.',
    '// Describes current schemas and valid publications. Drafts may be incomplete; older publications retain their original schema.',
    helpers.size ? `import type { ${[...helpers].sort().join(', ')} } from '@blok/sdk';` : '',
    ...interfaces,
    `export interface BlokComponentMap {\n${sorted.map(item => `  ${JSON.stringify(item.name)}: ${typeName(item.name)};`).join('\n')}\n}`,
    `export type BlokComponent = ${union(sorted.map(item => typeName(item.name)))};`,
    `export type BlokNestable = ${union(sorted.filter(item => item.kind !== 'content-type').map(item => typeName(item.name)))};`,
    `export type BlokContentType = ${union(sorted.filter(item => item.kind !== 'nestable').map(item => typeName(item.name)))};`,
    '',
  ].filter((line,index) => line || index > 2).join('\n\n');
}
