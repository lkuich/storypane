import { canonicalJson, type BlockDraft, type LocaleSnapshot } from '@storypane/core';

export type ComponentChange = {
  block: BlockDraft;
  before?: BlockDraft;
  kind: 'added' | 'updated' | 'removed' | 'moved';
  fields: string[];
  moved: boolean;
};

export function publicationChanges(next: LocaleSnapshot, live: LocaleSnapshot | null) {
  const before = new Map(live?.blocks.map((block) => [block.id, block]));
  const after = new Map(next.blocks.map((block) => [block.id, block]));
  const changes: ComponentChange[] = [];
  function samePlace(a: BlockDraft, b: BlockDraft) {
    return a.parentId === b.parentId && a.parentField === b.parentField;
  }
  function sharedOrder(block: BlockDraft, blocks: BlockDraft[], other: Map<string, BlockDraft>) {
    return blocks
      .filter(
        (item) =>
          samePlace(item, block) && other.has(item.id) && samePlace(item, other.get(item.id)!),
      )
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .findIndex((item) => item.id === block.id);
  }
  for (const block of next.blocks) {
    const previous = before.get(block.id);
    if (!previous) {
      changes.push({ block, kind: 'added', fields: Object.keys(block.fields), moved: false });
      continue;
    }
    const fields = [
      ...new Set([...Object.keys(previous.fields), ...Object.keys(block.fields)]),
    ].filter((name) => canonicalJson(previous.fields[name]) !== canonicalJson(block.fields[name]));
    const moved =
      !samePlace(previous, block) ||
      sharedOrder(previous, live!.blocks, after) !== sharedOrder(block, next.blocks, before);
    const updated = fields.length > 0 || previous.definitionId !== block.definitionId;
    if (updated || moved)
      changes.push({ block, before: previous, kind: updated ? 'updated' : 'moved', fields, moved });
  }
  for (const block of live?.blocks ?? [])
    if (!after.has(block.id))
      changes.push({
        block,
        before: block,
        kind: 'removed',
        fields: Object.keys(block.fields),
        moved: false,
      });
  return changes;
}
