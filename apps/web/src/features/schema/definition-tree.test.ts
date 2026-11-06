import { expect, it } from 'vitest';
import type { BlockDefinition } from '@storypane/core';
import { definitionDescendants, definitionTreeRows, type DefinitionSort } from './definition-tree';

const definition = (id: string, parentDefinitionId?: string): BlockDefinition => ({
  id,
  parentDefinitionId,
  name: id,
  displayName: id,
  kind: 'nestable',
  fields: [],
  versionId: id,
  version: 1,
  createdAt: '',
});

it('preserves ancestor context when searching collapsed branches and restores collapse afterwards', () => {
  const definitions = [
    definition('z'),
    definition('grandchild', 'child'),
    definition('child', 'a'),
    definition('a'),
  ];
  const collapsed = new Set(['a']);
  expect(definitionTreeRows(definitions, collapsed).map((row) => row.definition.id)).toEqual([
    'a',
    'z',
  ]);
  expect(
    definitionTreeRows(definitions, collapsed, 'grandchild').map((row) => [
      row.definition.id,
      row.depth,
    ]),
  ).toEqual([
    ['a', 0],
    ['child', 1],
    ['grandchild', 2],
  ]);
  expect(definitionTreeRows(definitions, collapsed).map((row) => row.definition.id)).toEqual([
    'a',
    'z',
  ]);
  expect([...definitionDescendants(definitions, 'a')]).toEqual(['a', 'child', 'grandchild']);
});

it.each<DefinitionSort['column']>(['name', 'kind', 'fields', 'updated', 'references'])(
  'sorts %s in both directions within each parent without mutating definitions',
  (column) => {
    const first: BlockDefinition = {
      ...definition('a'),
      kind: 'content-type',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const last: BlockDefinition = {
      ...definition('z'),
      kind: 'universal',
      fields: [{ name: 'title', label: 'Title', type: 'text', format: 'singleline' }],
      createdAt: '2026-02-01T00:00:00Z',
    };
    const definitions = [
      last,
      { ...last, id: 'child-z', parentDefinitionId: 'a' },
      { ...first, id: 'child-a', parentDefinitionId: 'a' },
      first,
    ];
    const counts = { z: 12, 'child-z': 10, 'child-a': 2 };
    const rows = (direction: DefinitionSort['direction']) =>
      definitionTreeRows(definitions, new Set(), '', { column, direction }, counts).map((row) => [
        row.definition.id,
        row.depth,
      ]);
    expect(rows('asc')).toEqual([
      ['a', 0],
      ['child-a', 1],
      ['child-z', 1],
      ['z', 0],
    ]);
    expect(rows('desc')).toEqual([
      ['z', 0],
      ['a', 0],
      ['child-z', 1],
      ['child-a', 1],
    ]);
    expect(definitions.map((item) => item.id)).toEqual(['z', 'child-z', 'child-a', 'a']);
    expect(
      definitionTreeRows(
        definitions,
        new Set(['a']),
        '',
        { column, direction: 'desc' },
        counts,
      ).map((row) => row.definition.id),
    ).toEqual(['z', 'a']);
  },
);

it('breaks equal values by name, then id, and keeps search ancestor context when sorted', () => {
  const definitions = [definition('z'), definition('b', 'z'), definition('a', 'z')];
  const sort: DefinitionSort = { column: 'references', direction: 'desc' };
  expect(
    definitionTreeRows(definitions, new Set(), '', sort).map((row) => row.definition.id),
  ).toEqual(['z', 'a', 'b']);
  expect(
    definitionTreeRows(definitions, new Set(['z']), 'b', sort).map((row) => row.definition.id),
  ).toEqual(['z', 'b']);
  definitions[1].displayName = 'a';
  expect(
    definitionTreeRows(definitions, new Set(), '', sort).map((row) => row.definition.id),
  ).toEqual(['z', 'a', 'b']);
});
