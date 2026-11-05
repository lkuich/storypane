import { expect, it } from 'vitest';
import type { BlockDefinition } from '@storypane/core';
import { definitionDescendants, definitionTreeRows } from './definition-tree';

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
