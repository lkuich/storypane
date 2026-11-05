import type { BlockDefinition } from '@storypane/core';

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
) {
  const byId = new Map(definitions.map((item) => [item.id, item]));
  const children = new Map<string | null, BlockDefinition[]>();
  const visible = new Set<string>();
  const query = search.trim().toLowerCase();
  for (const item of [...definitions].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
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
