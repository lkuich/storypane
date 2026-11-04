import { describe, expect, it } from 'vitest';
import {
  defaultFields,
  definitionInputSchema,
  deliverySettingsSchema,
  isBlockAllowed,
  jsonSchema,
  spaceLocaleInputSchema,
  validateFields,
  type DefinitionInput,
} from './index.js';

describe('schema and content validation', () => {
  it('requires a configured default and validates named preview targets and fixed origins', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const target = { id, name: ' Production ', url: 'https://example.com/{locale}/{slug}' };
    const settings = { previewUrls: [target], defaultPreviewId: id };
    expect(deliverySettingsSchema.parse(settings).previewUrls[0].name).toBe('Production');
    expect(
      deliverySettingsSchema.safeParse({ previewUrls: [], defaultPreviewId: null }).success,
    ).toBe(true);
    for (const patch of [
      { defaultPreviewId: null },
      { previewUrls: [] },
      { previewUrls: [target, target] },
      {
        previewUrls: [
          target,
          { ...target, id: '22222222-2222-4222-8222-222222222222', name: 'production' },
        ],
      },
    ])
      expect(deliverySettingsSchema.safeParse({ ...settings, ...patch }).success).toBe(false);
    for (const url of [
      '',
      'javascript:alert(1)',
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com/#fragment',
      'https://{slug}.example.com',
    ]) {
      expect(
        deliverySettingsSchema.safeParse({ ...settings, previewUrls: [{ ...target, url }] })
          .success,
      ).toBe(false);
    }
    expect(
      deliverySettingsSchema.safeParse({
        ...settings,
        previewUrls: [
          { ...target, url: 'http://localhost:3132/preview?slug={slug}&locale={locale}' },
        ],
      }).success,
    ).toBe(true);
  });
  it('validates locale URL prefixes and reserves the empty slug for Default', () => {
    expect(spaceLocaleInputSchema.parse({ name: ' French ', slug: 'fr-CA' })).toEqual({
      name: 'French',
      slug: 'fr-CA',
    });
    for (const slug of ['', '/fr', 'fr ca', '../fr', 'fr?draft=1', 'fr#preview', 'a'.repeat(31)])
      expect(spaceLocaleInputSchema.safeParse({ name: 'French', slug }).success).toBe(false);
  });
  const schema: DefinitionInput = {
    name: 'example',
    displayName: 'Example',
    kind: 'universal',
    fields: [
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        format: 'singleline',
        required: true,
        maxLength: 10,
      },
      { name: 'price', label: 'Price', type: 'number', min: 0, max: 100, decimals: 2 },
      { name: 'date', label: 'Date', type: 'datetime', mode: 'date' },
      { name: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
      { name: 'body', label: 'Body', type: 'blocks' },
      { name: 'rich', label: 'Rich text', type: 'text', format: 'richtext' },
      { name: 'link', label: 'Link', type: 'link' },
      {
        name: 'choices',
        label: 'Choices',
        type: 'options',
        source: { type: 'inline', items: [] },
        maxItems: 2,
      },
    ],
  };
  it('preserves incomplete drafts but blocks incomplete publication', () => {
    expect(validateFields(schema, {})).toEqual([]);
    expect(validateFields(schema, {}, true)).toContainEqual({ path: 'title', message: 'Required' });
    expect(defaultFields(schema)).toEqual({ enabled: false });
  });
  it('preserves typed numbers/booleans and validates real date-only values', () => {
    expect(
      validateFields(
        schema,
        { title: 'Hello', price: 12.34, enabled: false, date: '2024-02-29' },
        true,
      ),
    ).toEqual([]);
    const issues = validateFields(schema, { price: '12', enabled: 'false', date: '2025-02-29' });
    expect(issues.map((i) => i.path)).toEqual(['price', 'date', 'enabled']);
    expect(validateFields(schema, { price: 1.234 })).toContainEqual({
      path: 'price',
      message: 'Maximum 2 decimals',
    });
  });
  it('rejects unknown fields, direct nested content writes, and duplicate selections', () => {
    expect(
      validateFields(schema, { surprise: 1, body: [], choices: ['one', 'one'] }).map((i) => i.path),
    ).toEqual(['surprise', 'body', 'choices']);
  });
  it('accepts Tiptap documents and rejects unsafe links', () => {
    expect(
      validateFields(schema, {
        rich: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] }],
            },
          ],
        },
      }),
    ).toEqual([]);
    expect(
      validateFields(schema, {
        rich: {
          type: 'doc',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      }),
    ).toHaveLength(1);
    expect(
      validateFields(schema, { link: { type: 'external', url: 'file:///private/file' } }),
    ).toHaveLength(1);
  });
  it('rejects duplicate/reserved field names and inconsistent limits', () => {
    expect(
      definitionInputSchema.safeParse({ ...schema, fields: [schema.fields[0], schema.fields[0]] })
        .success,
    ).toBe(false);
    expect(
      definitionInputSchema.safeParse({
        ...schema,
        fields: [{ name: 'component', label: 'Component', type: 'boolean' }],
      }).success,
    ).toBe(false);
    expect(
      definitionInputSchema.safeParse({
        ...schema,
        fields: [{ name: 'n', label: 'Number', type: 'number', min: 5, max: 1 }],
      }).success,
    ).toBe(false);
  });
  it('validates tags and matches any selected tag while preserving unrestricted and explicit block rules', () => {
    const field = {
      name: 'body',
      label: 'Body',
      type: 'blocks' as const,
      allowedTags: ['layout', 'marketing'],
    };
    const child = {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'nestable' as const,
      tags: ['marketing'],
    };
    expect(isBlockAllowed(field, child)).toBe(true);
    expect(isBlockAllowed(field, { ...child, tags: ['other'] })).toBe(false);
    expect(isBlockAllowed(field, { ...child, tags: undefined })).toBe(false);
    expect(isBlockAllowed(field, { ...child, kind: 'content-type' })).toBe(false);
    expect(isBlockAllowed({ ...field, allowedTags: [] }, { ...child, tags: undefined })).toBe(true);
    expect(
      isBlockAllowed({ ...field, allowedTags: undefined, allowedDefinitionIds: [child.id] }, child),
    ).toBe(true);
    expect(definitionInputSchema.parse({ ...schema, tags: [' layout '] }).tags).toEqual(['layout']);
    for (const tags of [
      [''],
      ['a', 'a'],
      ['a'.repeat(65)],
      Array.from({ length: 51 }, (_, i) => String(i)),
    ]) {
      expect(definitionInputSchema.safeParse({ ...schema, tags }).success).toBe(false);
      expect(
        definitionInputSchema.safeParse({ ...schema, fields: [{ ...field, allowedTags: tags }] })
          .success,
      ).toBe(false);
    }
    expect(
      definitionInputSchema.safeParse({
        ...schema,
        fields: [{ ...field, allowedDefinitionIds: [child.id] }],
      }).success,
    ).toBe(false);
  });
  it('rejects excessively deep JSON without recursively overflowing the stack', () => {
    let value: unknown = 'leaf';
    for (let i = 0; i < 100; i++) value = [value];
    expect(jsonSchema.safeParse(value).success).toBe(false);
    expect(jsonSchema.safeParse({ price: Number.NaN }).success).toBe(false);
  });
  it('enforces required and length constraints on rich text content', () => {
    const required = {
      ...schema,
      fields: [
        {
          name: 'rich',
          label: 'Rich',
          type: 'text' as const,
          format: 'richtext' as const,
          required: true,
          maxLength: 5,
        },
      ],
    };
    expect(
      validateFields(required, { rich: { type: 'doc', content: [{ type: 'paragraph' }] } }, true),
    ).toContainEqual({ path: 'rich', message: 'Required' });
    expect(
      validateFields(required, {
        rich: { type: 'doc', content: [{ type: 'text', text: 'Too long' }] },
      }),
    ).toContainEqual({ path: 'rich', message: 'Maximum 5 characters' });
  });
});
