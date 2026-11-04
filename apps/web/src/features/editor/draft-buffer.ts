import {
  commandSchema,
  type BlockDraft,
  type BlockAccess,
  type Command,
  type Json,
} from '@storypane/core';

export type SaveAttempt = {
  migrationVersion?: number;
  mutationId: string;
  baseRevision: number;
  fields: Record<string, Json>;
  generation: number;
  leaseToken: string;
};
export type DraftBuffer = {
  baseRevision: number;
  fields: Record<string, Json>;
  generation: number;
  attempt?: SaveAttempt;
};
export type DraftBuffers = Record<string, DraftBuffer>;

export function hasForbiddenDraftFields(
  buffer: DraftBuffer,
  block: BlockDraft | undefined,
  access: BlockAccess | undefined,
): boolean {
  if (!access) return false;
  return (
    !access.edit ||
    Object.entries(buffer.fields).some(
      ([name, value]) =>
        access.fields[name]?.read === false ||
        (access.fields[name]?.edit === false &&
          JSON.stringify(value) !== JSON.stringify(block?.fields[name])),
    )
  );
}

export function editBuffer(
  previous: DraftBuffer | undefined,
  block: BlockDraft,
  name: string,
  value: Json,
): DraftBuffer {
  return {
    ...(previous?.attempt ? { attempt: previous.attempt } : {}),
    baseRevision: previous?.baseRevision ?? block.revision,
    fields: { ...(previous?.fields ?? block.fields), [name]: value },
    generation: (previous?.generation ?? 0) + 1,
  };
}

export function acknowledgeBuffer(
  buffer: DraftBuffer,
  generation: number,
  revision: number,
): DraftBuffer | null {
  if (buffer.generation === generation) return null;
  const { attempt: _attempt, ...pending } = buffer;
  return { ...pending, baseRevision: revision };
}

export function readBuffers(raw: string | null): DraftBuffers {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const valid: DraftBuffers = {};
    for (const [id, buffer] of Object.entries(value)) {
      if (!buffer || typeof buffer !== 'object') continue;
      const item = buffer as Partial<DraftBuffer>;
      if (
        Number.isInteger(item.baseRevision) &&
        item.baseRevision! >= 0 &&
        Number.isInteger(item.generation) &&
        item.generation! > 0 &&
        item.fields &&
        typeof item.fields === 'object' &&
        !Array.isArray(item.fields)
      )
        valid[id] = item as DraftBuffer;
    }
    return valid;
  } catch {
    return {};
  }
}

export function readPendingCommand(raw: string | null): Command | null {
  if (!raw) return null;
  try {
    const result = commandSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function localDatetime(iso: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function utcDatetime(local: string): string | null {
  const date = new Date(local);
  return local && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
