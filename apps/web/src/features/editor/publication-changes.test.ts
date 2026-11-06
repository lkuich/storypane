import { describe, expect, it } from 'vitest';
import type { BlockDraft, LocaleSnapshot } from '@storypane/core';
import { publicationChanges } from './publication-changes';

const block = (id: string, position = 0, fields: BlockDraft['fields'] = {}): BlockDraft => ({
  id,
  position,
  fields,
  definitionId: 'component',
  schemaVersionId: 'schema',
  parentId: 'root',
  parentField: 'body',
  revision: 1,
});
const snapshot = (...blocks: BlockDraft[]) => ({ blocks }) as LocaleSnapshot;

describe('publication changes', () => {
  it('compares content rather than revision numbers, JSON key order or schema version IDs', () => {
    const live = snapshot(
      block('a', 0, { link: { type: 'external', url: 'https://example.com' } }),
    );
    const next = structuredClone(live);
    next.blocks[0].revision = 99;
    next.blocks[0].schemaVersionId = 'new-schema';
    next.blocks[0].fields.link = { url: 'https://example.com', type: 'external' };
    expect(publicationChanges(next, live)).toEqual([]);
  });
  it('lists just the changed nested component and its changed fields', () => {
    const root = { ...block('root'), parentId: null, parentField: null };
    const live = snapshot(
      root,
      block('hero', 0, { title: 'Before', description: 'Same' }),
      block('footer', 1),
    );
    const next = structuredClone(live);
    next.blocks[1].fields.title = 'After';
    expect(publicationChanges(next, live)).toMatchObject([
      { block: { id: 'hero' }, kind: 'updated', fields: ['title'], moved: false },
    ]);
  });
  it('reports additions and removals without marking shifted siblings as moved', () => {
    const live = snapshot(block('a'), block('removed', 1), block('b', 2));
    const next = snapshot(block('added'), block('a', 1), block('b', 2));
    expect(publicationChanges(next, live).map(({ block, kind }) => [block.id, kind])).toEqual([
      ['added', 'added'],
      ['removed', 'removed'],
    ]);
  });
  it('detects sibling reorder and moving between containers, without listing descendants', () => {
    const live = snapshot(block('a'), block('b', 1), { ...block('child'), parentId: 'a' });
    const reordered = snapshot(block('a', 1), block('b'), live.blocks[2]);
    expect(publicationChanges(reordered, live).map(({ block, kind }) => [block.id, kind])).toEqual([
      ['a', 'moved'],
      ['b', 'moved'],
    ]);
    const moved = structuredClone(live);
    moved.blocks[0].parentField = 'sidebar';
    moved.blocks[0].fields.title = 'Edited too';
    expect(publicationChanges(moved, live)).toMatchObject([
      { block: { id: 'a' }, kind: 'updated', moved: true, fields: ['title'] },
    ]);
  });
  it('keeps rich text formatting and array order changes, and removed fields', () => {
    const live = snapshot(
      block('a', 0, { body: { type: 'text', text: 'Hi' }, items: ['a', 'b'], old: true }),
    );
    const next = snapshot(
      block('a', 0, {
        body: { type: 'text', text: 'Hi', marks: [{ type: 'bold' }] },
        items: ['b', 'a'],
      }),
    );
    expect(publicationChanges(next, live)[0].fields).toEqual(['body', 'items', 'old']);
  });
  it('treats a first publication as added and compares older checkpoints to live', () => {
    const older = snapshot(block('a', 0, { title: 'Original' }));
    expect(publicationChanges(older, null)[0].kind).toBe('added');
    const live = snapshot(block('a', 0, { title: 'Current live' }), block('new'));
    expect(publicationChanges(older, live).map(({ kind }) => kind)).toEqual(['updated', 'removed']);
  });
});
