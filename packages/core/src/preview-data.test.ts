import { expect, it } from 'vitest';
import {
  definitionInputSchema,
  defaultFields,
  migrationChanges,
  portableDefinitions,
  reconcileSchemas,
  type BlockDefinition,
  type DefinitionInput,
} from './index';

const schema: DefinitionInput = {
  name: 'hero',
  displayName: 'Hero',
  kind: 'nestable',
  fields: [
    {
      id: crypto.randomUUID(),
      name: 'title',
      label: 'Title',
      type: 'text',
      format: 'singleline',
      defaultValue: 'Authored default',
    },
    { id: crypto.randomUUID(), name: 'items', label: 'Items', type: 'blocks' },
  ],
};
it('keeps bounded preview data separate from inserted defaults and in schema transfers', () => {
  const previewData = {
    title: 'Preview only',
    items: [{ _uid: 'preview-child', component: 'hero', title: 'Nested sample' }],
  };
  const parsed = definitionInputSchema.parse({ ...schema, previewData });
  expect(parsed.previewData).toEqual(previewData);
  expect(defaultFields(parsed)).toEqual({ title: 'Authored default' });
  const definition: BlockDefinition = {
    ...schema,
    id: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    version: 1,
    createdAt: '',
  };
  const changed = { ...definition, previewData };
  expect(migrationChanges([definition], [changed])).toMatchObject([
    { kind: 'changed', after: { previewData } },
  ]);
  expect(
    reconcileSchemas(
      portableDefinitions([definition]),
      portableDefinitions([changed]),
      portableDefinitions([definition]),
    ).definitions[0].schema.previewData,
  ).toEqual(previewData);
});
it('rejects malformed, oversized, or mismatched samples and accepts an omitted sample', () => {
  for (const previewData of [
    null,
    [],
    {},
    { title: 42 },
    { unknown: 'value' },
    { _uid: 'override' },
    { component: 'other' },
    { items: ['invalid'] },
    { title: 'x'.repeat(100_001) },
  ])
    expect(definitionInputSchema.safeParse({ ...schema, previewData }).success).toBe(false);
  expect(definitionInputSchema.safeParse(schema).success).toBe(true);
});
