import type { BlockDefinition } from '@storypane/core';

export type DefinitionSort = {
  column: 'name' | 'kind' | 'fields' | 'updated' | 'references';
  direction: 'asc' | 'desc';
};

export function definitionDescendants(definitions: BlockDefinition[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const item of definitions) {
    if (!item.parentDefinitionId) continue;
    const siblings = children.get(item.parentDefinitionId) ?? [];
    siblings.push(item.id);
    children.set(item.parentDefinitionId, siblings);
  }
  const result = new Set<string>(),
    pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    pending.push(...(children.get(current) ?? []));
  }
  return result;
}

export function definitionTreeRows(
  definitions: BlockDefinition[],
  collapsed = new Set<string>(),
  search = '',
  sort: DefinitionSort = { column: 'name', direction: 'asc' },
  references: Record<string, number> = {},
) {
  const byId = new Map(definitions.map((item) => [item.id, item]));
  const children = new Map<string | null, BlockDefinition[]>();
  const visible = new Set<string>();
  const query = search.trim().toLowerCase();
  const ordered = [...definitions].sort((a, b) => {
    const compared =
      sort.column === 'kind'
        ? a.kind.localeCompare(b.kind)
        : sort.column === 'fields'
          ? a.fields.length - b.fields.length
          : sort.column === 'updated'
            ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
            : sort.column === 'references'
              ? (references[a.id] ?? 0) - (references[b.id] ?? 0)
              : a.displayName.localeCompare(b.displayName);
    return (
      compared * (sort.direction === 'asc' ? 1 : -1) ||
      a.displayName.localeCompare(b.displayName) ||
      a.id.localeCompare(b.id)
    );
  });
  for (const item of ordered) {
    const parent = item.parentDefinitionId ?? null;
    const siblings = children.get(parent) ?? [];
    siblings.push(item);
    children.set(parent, siblings);
    if (query && `${item.displayName} ${item.name}`.toLowerCase().includes(query)) {
      let current: BlockDefinition | undefined = item;
      while (current && !visible.has(current.id)) {
        visible.add(current.id);
        current = byId.get(current.parentDefinitionId ?? '');
      }
    }
  }
  const pending = (children.get(null) ?? [])
    .map((definition) => ({ definition, depth: 0 }))
    .reverse();
  const rows: { definition: BlockDefinition; depth: number; hasChildren: boolean }[] = [];
  while (pending.length) {
    const row = pending.pop()!;
    if (query && !visible.has(row.definition.id)) continue;
    const nested = children.get(row.definition.id) ?? [];
    rows.push({ ...row, hasChildren: nested.length > 0 });
    if (query || !collapsed.has(row.definition.id))
      for (let index = nested.length - 1; index >= 0; index--)
        pending.push({ definition: nested[index], depth: row.depth + 1 });
  }
  return rows;
}
