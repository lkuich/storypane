import { expect, it } from 'vitest';
import { defaultFields, definitionInputSchema, seoBlockPreset } from './index.js';

it('uses editable standard fields with opt-in Markdown and normal indexing defaults', () => {
  const definition = definitionInputSchema.parse(seoBlockPreset);
  expect(definition.kind).toBe('nestable');
  expect(new Set(definition.fields.map((field) => field.name)).size).toBe(7);
  expect(definition.fields.every((field) => !field.required)).toBe(true);
  expect(defaultFields(definition)).toMatchObject({
    robots_index: 'index',
    robots_follow: 'follow',
    markdown_enabled: false,
  });
});
