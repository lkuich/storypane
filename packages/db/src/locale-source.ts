import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  canonicalJson,
  StorypaneError,
  type BlockDraft,
  type LocaleSnapshot,
  type LocaleSourceChange,
  type LocaleSourceInput,
  type LocaleSourceReview,
} from '@storypane/core';

export type LocaleSourceState = {
  baseline: LocaleSnapshot;
  mappings: Record<string, string | null>;
  needs_translation: string[];
};
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const children = (s: LocaleSnapshot, id: string, field?: string) =>
  s.blocks
    .filter((b) => b.parentId === id && (!field || b.parentField === field))
    .sort(
      (a, b) => (a.parentField ?? '').localeCompare(b.parentField ?? '') || a.position - b.position,
    );
const title = (s: LocaleSnapshot, b: BlockDraft) => {
  const name = s.definitions.find((d) => d.versionId === b.schemaVersionId)?.displayName ?? 'Block';
  const text = b.fields.title;
  return typeof text === 'string' && text ? `${name} · ${text}` : name;
};
export function descendants(s: LocaleSnapshot, id: string): BlockDraft[] {
  const byParent = new Map<string, BlockDraft[]>();
  for (const block of s.blocks)
    if (block.parentId)
      byParent.set(block.parentId, [...(byParent.get(block.parentId) ?? []), block]);
  const ids = new Set<string>(),
    pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (ids.has(current)) continue;
    ids.add(current);
    for (const child of byParent.get(current) ?? []) pending.push(child.id);
  }
  return s.blocks.filter((block) => ids.has(block.id));
}
export function localeSourceReview(
  source: LocaleSnapshot,
  target: LocaleSnapshot,
  state: LocaleSourceState | null,
  blockId?: string,
): LocaleSourceReview {
  if (!state) blockId = undefined;
  const mappings = state?.mappings ?? {};
  const changes: LocaleSourceChange[] = [];
  const baseline = state?.baseline;
  const scope = blockId ? new Set(descendants(target, blockId).map((b) => b.id)) : null;
  if (blockId && !target.blocks.some((b) => b.id === blockId))
    throw new StorypaneError('not_found', 'Block not found');
  const sourceScope = scope
    ? new Set(
        Object.entries(mappings)
          .filter(([, id]) => id && scope.has(id))
          .map(([id]) => id),
      )
    : null;
  if (sourceScope)
    for (const id of [...sourceScope])
      for (const b of descendants(source, id)) sourceScope.add(b.id);
  const visible = (id: string) => !sourceScope || sourceScope.has(id);
  const oldById = new Map(baseline?.blocks.map((b) => [b.id, b]));
  const currentById = new Map(source.blocks.map((b) => [b.id, b]));
  const targetById = new Map(target.blocks.map((b) => [b.id, b]));
  const added = new Set<string>();
  if (baseline)
    for (const b of source.blocks) {
      if (!visible(b.id)) continue;
      const old = oldById.get(b.id),
        local = targetById.get(mappings[b.id] ?? '');
      if (!local) {
        // An acknowledged omission stays quiet until that source subtree changes again.
        if (
          old &&
          same(
            descendants(baseline, b.id)
              .map(({ revision: _, ...v }) => v)
              .sort((a, b) => a.id.localeCompare(b.id)),
            descendants(source, b.id)
              .map(({ revision: _, ...v }) => v)
              .sort((a, b) => a.id.localeCompare(b.id)),
          )
        )
          continue;
        if (b.parentId && !targetById.has(mappings[b.parentId] ?? '')) continue;
        if (!b.parentId) continue;
        const items = descendants(source, b.id).filter(
          (item) => !targetById.has(mappings[item.id] ?? ''),
        );
        items.forEach((item) => added.add(item.id));
        changes.push({
          id: `add:${b.id}`,
          sourceId: b.id,
          targetId: null,
          kind: 'add',
          title: title(source, b),
          safe: !old,
          detail: old
            ? 'Removed or omitted locally. Adding it restores a copy.'
            : 'New section · copied content needs translation',
        });
        continue;
      }
      const definition = source.definitions.find((d) => d.versionId === b.schemaVersionId);
      const fields = [...new Set([...Object.keys(old?.fields ?? {}), ...Object.keys(b.fields)])]
        .filter((name) => !same(old?.fields[name], b.fields[name]))
        .map((name) => ({
          name,
          label: definition?.fields.find((f) => f.name === name)?.label ?? name,
          before: old?.fields[name] ?? null,
          source: b.fields[name] ?? null,
          local: local.fields[name] ?? null,
          conflict:
            !same(local.fields[name], old?.fields[name]) &&
            !same(local.fields[name], b.fields[name]),
        }));
      if (fields.length || old?.schemaVersionId !== b.schemaVersionId)
        changes.push({
          id: `content:${b.id}`,
          sourceId: b.id,
          targetId: local.id,
          kind: 'content',
          title: title(source, b),
          safe:
            !!old &&
            fields.every((f) => !f.conflict) &&
            local.schemaVersionId === b.schemaVersionId,
          detail: fields.some((f) => f.conflict)
            ? 'Localized content changed · review before replacing'
            : 'Only changed source fields will be updated',
          fields,
          ...(local.schemaVersionId !== b.schemaVersionId
            ? { blocked: 'Align the block schemas before applying this update.' }
            : {}),
        });
      if (
        b.parentId &&
        (old
          ? b.parentId !== old.parentId || b.parentField !== old.parentField
          : mappings[b.parentId] !== local.parentId || b.parentField !== local.parentField)
      )
        changes.push({
          id: `move:${b.id}`,
          sourceId: b.id,
          targetId: local.id,
          kind: 'move',
          title: title(source, b),
          safe: false,
          detail: 'Move to the source section. Local fields are preserved.',
        });
    }
  if (baseline)
    for (const old of baseline.blocks) {
      if (!visible(old.id) || currentById.has(old.id) || !old.parentId) continue;
      if (old.parentId && !currentById.has(old.parentId)) continue;
      const local = targetById.get(mappings[old.id] ?? '');
      changes.push({
        id: `remove:${old.id}`,
        sourceId: old.id,
        targetId: local?.id ?? null,
        kind: 'remove',
        title: title(baseline, old),
        safe: false,
        detail: 'Removed from source. Removing it here also deletes its localized descendants.',
      });
    }
  if (baseline)
    for (const b of source.blocks) {
      if (!visible(b.id) || added.has(b.id)) continue;
      const old = oldById.get(b.id),
        targetId = mappings[b.id];
      if (!old || !targetId || !targetById.has(targetId)) continue;
      const fields = new Set(
        [...children(source, b.id), ...children(baseline, b.id)].map((c) => c.parentField!),
      );
      for (const field of fields) {
        const order = children(source, b.id, field).map((c) => c.id),
          previous = children(baseline, b.id, field).map((c) => c.id);
        // Additions/removals have their own decisions. Reorder only the shared children.
        const shared = order.filter((id) => previous.includes(id)),
          oldShared = previous.filter((id) => order.includes(id));
        if (!same(shared, oldShared))
          changes.push({
            id: `order:${b.id}:${field}`,
            sourceId: b.id,
            targetId,
            kind: 'order',
            title: `${title(source, b)} · ${field}`,
            safe: false,
            detail: `Source order: ${children(source, b.id, field)
              .map((c) => title(source, c))
              .join(' → ')}. Local-only blocks keep their slots.`,
            field,
          });
      }
    }
  const token = createHash('sha256')
    .update(
      canonicalJson({
        source: source.blocks,
        target: target.blocks,
        definitions: source.definitions,
        state,
        blockId: blockId ?? null,
      }),
    )
    .digest('hex');
  return {
    token,
    linked: !!state,
    source: { ...source, leases: [] },
    mappings,
    changes,
    needsTranslation: (state?.needs_translation ?? [])
      .filter((id) => targetById.has(id) && (!scope || scope.has(id)))
      .map((id) => ({ id, title: title(target, targetById.get(id)!) })),
  };
}

export async function applyLocaleSource(
  client: PoolClient,
  source: LocaleSnapshot,
  target: LocaleSnapshot,
  state: LocaleSourceState | null,
  input: LocaleSourceInput,
): Promise<string[]> {
  const review = localeSourceReview(
    source,
    target,
    state,
    input.action === 'update' ? input.blockId : undefined,
  );
  if (input.token !== review.token)
    throw new StorypaneError(
      'stale_revision',
      'Source or locale changed. Refresh these updates before applying them.',
    );
  const next: LocaleSourceState = state
    ? structuredClone(state)
    : {
        baseline: { ...structuredClone(source), leases: [], access: undefined },
        mappings: { [source.locale.rootBlockId]: target.locale.rootBlockId },
        needs_translation: [],
      };
  const blocks = structuredClone(target.blocks),
    changed = new Set<string>();
  const groups = new Set<string>();
  const find = (id: string) => blocks.find((b) => b.id === id);
  const sourceBlock = (id: string) => source.blocks.find((b) => b.id === id)!;
  function copy(id: string, parentId: string, field: string, position: number): void {
    const b = sourceBlock(id);
    if (!b) throw new StorypaneError('invalid', 'Source block not found');
    if (next.mappings[id] && find(next.mappings[id]!)) return;
    const newId = randomUUID();
    next.mappings[id] = newId;
    blocks.push({
      ...structuredClone(b),
      id: newId,
      parentId,
      parentField: field,
      position,
      revision: 1,
    });
    changed.add(newId);
    changed.add(parentId);
    groups.add(`${parentId}:${field}`);
    next.needs_translation.push(newId);
    for (const child of children(source, id))
      copy(child.id, newId, child.parentField!, child.position);
  }
  function acknowledge(b: BlockDraft, part: 'fields' | 'position' | 'all') {
    const old = next.baseline.blocks.find((item) => item.id === b.id);
    if (!old) {
      const copied = structuredClone(b);
      if (b.parentId) {
        const siblings = children(next.baseline, b.parentId, b.parentField!);
        const sourceSiblings = children(source, b.parentId, b.parentField!);
        const following = sourceSiblings
          .slice(sourceSiblings.findIndex((item) => item.id === b.id) + 1)
          .find((item) => siblings.some((old) => old.id === item.id));
        const position = following
          ? siblings.findIndex((item) => item.id === following.id)
          : siblings.length;
        siblings.splice(position, 0, copied);
        siblings.forEach((item, index) => {
          item.position = index;
        });
      }
      next.baseline.blocks.push(copied);
    } else if (part === 'fields') {
      old.fields = structuredClone(b.fields);
      old.schemaVersionId = b.schemaVersionId;
    } else if (part === 'position') {
      next.baseline.blocks = next.baseline.blocks.filter((item) => item.id !== old.id);
      acknowledge(
        { ...old, parentId: b.parentId, parentField: b.parentField, position: b.position },
        'all',
      );
    } else Object.assign(old, structuredClone(b));
  }
  if (input.action === 'copy') {
    if (state || target.blocks.length !== 1)
      throw new StorypaneError(
        'invalid',
        'Create from Default is only available for an empty, unlinked locale. Link an existing locale instead.',
      );
    const root = find(target.locale.rootBlockId)!;
    if (root.schemaVersionId !== sourceBlock(source.locale.rootBlockId).schemaVersionId)
      throw new StorypaneError('invalid', 'The page schemas must match.');
    if (input.copyRoot) {
      root.fields = structuredClone(sourceBlock(source.locale.rootBlockId).fields);
      changed.add(root.id);
      next.needs_translation.push(root.id);
    }
    for (const id of new Set(input.blockIds)) {
      const b = sourceBlock(id);
      if (!b || b.parentId !== source.locale.rootBlockId)
        throw new StorypaneError('invalid', 'Choose top-level source sections.');
      copy(id, root.id, b.parentField!, b.position);
    }
    for (const b of source.blocks) next.mappings[b.id] ??= null;
  } else if (input.action === 'link') {
    if (state) throw new StorypaneError('invalid', 'This locale is already linked.');
    const used = new Set([target.locale.rootBlockId]);
    function pair(sourceId: string, targetId: string) {
      const b = sourceBlock(sourceId),
        local = find(targetId);
      if (
        !b ||
        !local ||
        used.has(targetId) ||
        Object.hasOwn(next.mappings, sourceId) ||
        b.definitionId !== local.definitionId
      )
        throw new StorypaneError('invalid', 'Choose each matching section once.');
      next.mappings[sourceId] = targetId;
      used.add(targetId);
      const a = children(source, sourceId),
        c = children(target, targetId);
      if (
        a.length !== c.length ||
        a.some(
          (item, i) =>
            item.parentField !== c[i].parentField || item.definitionId !== c[i].definitionId,
        )
      )
        throw new StorypaneError(
          'invalid',
          'Matched sections must have the same nested structure. Leave adapted sections unlinked.',
        );
      a.forEach((item, i) => pair(item.id, c[i].id));
    }
    for (const p of input.pairs) {
      if (
        sourceBlock(p.sourceId)?.parentId !== source.locale.rootBlockId ||
        find(p.targetId)?.parentId !== target.locale.rootBlockId
      )
        throw new StorypaneError(
          'invalid',
          'Match top-level sections; their descendants are linked together.',
        );
      pair(p.sourceId, p.targetId);
    }
    for (const b of source.blocks) next.mappings[b.id] ??= null;
  } else {
    if (!state) throw new StorypaneError('invalid', 'Link this locale first.');
    if (new Set(input.decisions.map((d) => d.id)).size !== input.decisions.length)
      throw new StorypaneError('invalid', 'Choose one decision per change.');
    const decisions = input.decisions
      .map((d) => {
        const change = review.changes.find((c) => c.id === d.id);
        if (!change)
          throw new StorypaneError(
            'stale_revision',
            'This change is no longer available in the selected scope.',
          );
        if (d.action === 'apply' && change.blocked)
          throw new StorypaneError('invalid', change.blocked);
        return { ...d, change };
      })
      .sort(
        (a, b) =>
          ['add', 'content', 'move', 'remove', 'order'].indexOf(a.change.kind) -
          ['add', 'content', 'move', 'remove', 'order'].indexOf(b.change.kind),
      );
    for (const { action, change: c } of decisions) {
      const b = sourceBlock(c.sourceId),
        local = c.targetId ? find(c.targetId) : undefined;
      if (c.kind === 'add') {
        const incoming: BlockDraft[] = [];
        const collect = (item: BlockDraft) => {
          if (next.mappings[item.id] && find(next.mappings[item.id]!)) return;
          incoming.push(item);
          for (const child of children(source, item.id)) collect(child);
        };
        collect(b);
        if (action === 'apply') {
          const parent = next.mappings[b.parentId!];
          if (!parent || !find(parent))
            throw new StorypaneError(
              'invalid',
              'Add the source parent section before adding this block.',
            );
          const siblings = blocks
            .filter((item) => item.parentId === parent && item.parentField === b.parentField)
            .sort((a, b) => a.position - b.position);
          const sourceSiblings = children(source, b.parentId!, b.parentField!);
          const nextSibling = sourceSiblings
            .slice(sourceSiblings.findIndex((item) => item.id === b.id) + 1)
            .map((item) => next.mappings[item.id])
            .find((id) => siblings.some((item) => item.id === id));
          const position = nextSibling
            ? siblings.findIndex((item) => item.id === nextSibling)
            : siblings.length;
          siblings.slice(position).forEach((item) => {
            item.position++;
            changed.add(item.id);
          });
          copy(b.id, parent, b.parentField!, position);
        }
        for (const item of incoming) {
          acknowledge(item, 'all');
          next.mappings[item.id] ??= null;
        }
      } else if (c.kind === 'content') {
        if (action === 'apply' && local) {
          for (const f of c.fields ?? []) {
            if (Object.hasOwn(b.fields, f.name))
              local.fields[f.name] = structuredClone(b.fields[f.name]);
            else delete local.fields[f.name];
          }
          changed.add(local.id);
          next.needs_translation.push(local.id);
        }
        acknowledge(b, 'fields');
      } else if (c.kind === 'move') {
        if (action === 'apply' && local) {
          const parent = next.mappings[b.parentId!];
          if (!parent || !find(parent))
            throw new StorypaneError(
              'invalid',
              'Add the destination section before moving this block.',
            );
          groups.add(`${local.parentId}:${local.parentField}`);
          groups.add(`${parent}:${b.parentField}`);
          changed.add(local.parentId!);
          changed.add(parent);
          changed.add(local.id);
          local.parentId = parent;
          local.parentField = b.parentField;
          const siblings = blocks
            .filter(
              (item) =>
                item.id !== local.id &&
                item.parentId === parent &&
                item.parentField === b.parentField,
            )
            .sort((a, b) => a.position - b.position);
          const sourceSiblings = children(source, b.parentId!, b.parentField!);
          const following = sourceSiblings
            .slice(sourceSiblings.findIndex((item) => item.id === b.id) + 1)
            .map((item) => next.mappings[item.id])
            .find((id) => siblings.some((item) => item.id === id));
          siblings.splice(
            following ? siblings.findIndex((item) => item.id === following) : siblings.length,
            0,
            local,
          );
          siblings.forEach((item, index) => {
            item.position = index;
            changed.add(item.id);
          });
        }
        acknowledge(b, 'position');
      } else if (c.kind === 'remove') {
        if (action === 'apply' && local) {
          const removed = descendants({ ...target, blocks }, local.id);
          if (removed.some((item) => source.blocks.some((s) => next.mappings[s.id] === item.id)))
            throw new StorypaneError(
              'invalid',
              'Move the surviving source blocks out before removing this section.',
            );
          groups.add(`${local.parentId}:${local.parentField}`);
          changed.add(local.parentId!);
          for (const item of removed) {
            blocks.splice(
              blocks.findIndex((v) => v.id === item.id),
              1,
            );
            changed.add(item.id);
          }
        }
        next.baseline.blocks = next.baseline.blocks.filter(
          (item) =>
            source.blocks.some((s) => s.id === item.id) ||
            !descendants(state.baseline, c.sourceId).some((r) => r.id === item.id),
        );
      } else if (c.kind === 'order') {
        const order = children(source, b.id, c.field)
          .map((item) => next.mappings[item.id])
          .filter(
            (id): id is string =>
              !!id &&
              !!find(id) &&
              find(id)!.parentId === c.targetId &&
              find(id)!.parentField === c.field,
          );
        if (action === 'apply') {
          const slots = blocks
            .filter((item) => item.parentId === c.targetId && item.parentField === c.field)
            .sort((a, b) => a.position - b.position);
          let index = 0;
          slots.forEach((item, position) => {
            if (order.includes(item.id)) {
              const moved = find(order[index++])!;
              moved.position = position;
              changed.add(moved.id);
            }
          });
          changed.add(c.targetId!);
          groups.add(`${c.targetId}:${c.field}`);
        }
        for (const child of children(source, b.id, c.field)) {
          const old = next.baseline.blocks.find((item) => item.id === child.id);
          if (old) old.position = child.position;
        }
      }
    }
    for (const id of input.reviewedIds)
      if (!review.needsTranslation.some((item) => item.id === id))
        throw new StorypaneError('invalid', 'Only mark content in this review as translated.');
    next.needs_translation = next.needs_translation.filter((id) => !input.reviewedIds.includes(id));
  }
  // Normalizing every group also closes gaps after explicit deletions and moves.
  for (const parent of blocks)
    for (const field of new Set(
      blocks
        .filter((b) => b.parentId === parent.id && groups.has(`${parent.id}:${b.parentField}`))
        .map((b) => b.parentField),
    ))
      blocks
        .filter((b) => b.parentId === parent.id && b.parentField === field)
        .sort((a, b) => a.position - b.position)
        .forEach((b, i) => {
          if (b.position !== i) {
            b.position = i;
            changed.add(b.id);
          }
        });
  for (const b of blocks)
    if (changed.has(b.id))
      await client.query(
        'INSERT INTO block_drafts(id,locale_id,schema_version_id,parent_id,parent_field,position,fields,revision) VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id,parent_field=EXCLUDED.parent_field,position=EXCLUDED.position,fields=EXCLUDED.fields,revision=block_drafts.revision+1',
        [
          b.id,
          target.locale.id,
          b.schemaVersionId,
          b.parentId,
          b.parentField,
          b.position,
          JSON.stringify(b.fields),
        ],
      );
  for (const b of target.blocks)
    if (!find(b.id))
      await client.query('DELETE FROM block_drafts WHERE locale_id=$1 AND id=$2', [
        target.locale.id,
        b.id,
      ]);
  next.baseline.definitions = [
    ...new Map(
      [...next.baseline.definitions, ...source.definitions].map((d) => [d.versionId, d]),
    ).values(),
  ];
  next.needs_translation = [...new Set(next.needs_translation)].filter((id) => !!find(id));
  await client.query(
    'INSERT INTO locale_sources(locale_id,source_locale_id,baseline,mappings,needs_translation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(locale_id) DO UPDATE SET baseline=EXCLUDED.baseline,mappings=EXCLUDED.mappings,needs_translation=EXCLUDED.needs_translation',
    [
      target.locale.id,
      source.locale.id,
      JSON.stringify(next.baseline),
      JSON.stringify(next.mappings),
      JSON.stringify(next.needs_translation),
    ],
  );
  return [...changed];
}
