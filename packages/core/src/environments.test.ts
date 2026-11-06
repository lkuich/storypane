import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  reconcileSchemas,
  validatePortableDefinitions,
  type PortableDefinition,
} from './environments';
const field = randomUUID(),
  second = randomUUID();
const base: PortableDefinition[] = [
  {
    id: randomUUID(),
    parentDefinitionId: null,
    schema: {
      name: 'page',
      displayName: 'Page',
      kind: 'content-type',
      fields: [
        { id: field, name: 'title', label: 'Title', type: 'text', format: 'singleline' },
        { id: second, name: 'body', label: 'Body', type: 'blocks' },
      ],
    },
  },
];
it('merges separate changes by stable identity, retaining renames and nesting restrictions', () => {
  const dev = structuredClone(base),
    prod = structuredClone(base);
  dev[0].schema.fields[0].name = 'headline';
  prod[0].schema.fields[1] = { ...prod[0].schema.fields[1], type: 'blocks', maxItems: 3 };
  const result = reconcileSchemas(base, dev, prod);
  expect(result.conflicts).toEqual([]);
  expect(result.definitions[0].schema.fields).toMatchObject([
    { id: field, name: 'headline' },
    { id: second, maxItems: 3 },
  ]);
  expect(() => validatePortableDefinitions(result.definitions)).not.toThrow();
});
it('requires a choice for a changed field removed by the other developer', () => {
  const dev = structuredClone(base),
    prod = structuredClone(base);
  dev[0].schema.fields[0].name = 'headline';
  prod[0].schema.fields.shift();
  const result = reconcileSchemas(base, dev, prod);
  expect(result.conflicts).toHaveLength(1);
  expect(
    reconcileSchemas(base, dev, prod, { [result.conflicts[0].path]: 'dev' }).definitions[0].schema
      .fields[0].name,
  ).toBe('headline');
  expect(
    reconcileSchemas(base, dev, prod, { [result.conflicts[0].path]: 'prod' }).definitions[0].schema
      .fields,
  ).toHaveLength(1);
});
it('retains independently inserted fields and detects competing order changes', () => {
  const b = structuredClone(base),
    dev = structuredClone(base),
    prod = structuredClone(base);
  const third = { id: randomUUID(), name: 'third', label: 'Third', type: 'boolean' as const };
  b[0].schema.fields.push(third);
  dev[0].schema.fields = [third, ...dev[0].schema.fields];
  prod[0].schema.fields = [prod[0].schema.fields[1], third, prod[0].schema.fields[0]];
  expect(reconcileSchemas(b, dev, prod).conflicts[0].path).toMatch(/\.fields.order$/);
  const inserted = structuredClone(base);
  inserted[0].schema.fields.splice(1, 0, third);
  expect(
    reconcileSchemas(base, base, inserted).definitions[0].schema.fields.map((f) => f.id),
  ).toEqual([field, third.id, second]);
});
it('rejects hierarchy cycles and missing nesting references after reconciliation', () => {
  const defs = structuredClone(base);
  defs.push({
    ...structuredClone(base[0]),
    id: randomUUID(),
    schema: { ...base[0].schema, name: 'child' },
    parentDefinitionId: base[0].id,
  });
  defs[0].parentDefinitionId = defs[1].id;
  expect(() => validatePortableDefinitions(defs)).toThrow();
  defs[0].parentDefinitionId = null;
  defs[0].schema.fields[1] = {
    id: second,
    name: 'body',
    label: 'Body',
    type: 'blocks',
    allowedDefinitionIds: [randomUUID()],
  };
  expect(() => validatePortableDefinitions(defs)).toThrow('Missing block');
});

it('offers a complete schema choice when independent changes create a hierarchy cycle or dangling nested block', () => {
  const b = structuredClone(base);
  b.push({
    id: randomUUID(),
    parentDefinitionId: null,
    schema: { name: 'child', displayName: 'Child', kind: 'nestable', fields: [] },
  });
  const dev = structuredClone(b),
    prod = structuredClone(b);
  dev[0].parentDefinitionId = b[1].id;
  prod[1].parentDefinitionId = b[0].id;
  const cycle = reconcileSchemas(b, dev, prod);
  expect(cycle.conflicts.map((c) => c.path)).toEqual(['blocks.structure']);
  expect(reconcileSchemas(b, dev, prod, { 'blocks.structure': 'prod' })).toEqual({
    definitions: prod,
    conflicts: [],
  });
  dev[0].parentDefinitionId = null;
  dev[0].schema.fields[1] = {
    ...dev[0].schema.fields[1],
    type: 'blocks',
    allowedDefinitionIds: [b[1].id],
  };
  prod.pop();
  expect(reconcileSchemas(b, dev, prod).conflicts.map((c) => c.path)).toEqual(['blocks.structure']);
  expect(reconcileSchemas(b, dev, prod, { 'blocks.structure': 'dev' })).toEqual({
    definitions: dev,
    conflicts: [],
  });
});
