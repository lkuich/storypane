import { z } from 'zod';
import type { Json, LocaleSnapshot } from './index.js';
const token = z.string().length(64);
export const localeSourceInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('copy'),
      token,
      blockIds: z.array(z.uuid()).max(1000),
      copyRoot: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('link'),
      token,
      pairs: z.array(z.object({ sourceId: z.uuid(), targetId: z.uuid() }).strict()).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      token,
      blockId: z.uuid().optional(),
      decisions: z
        .array(z.object({ id: z.string().max(150), action: z.enum(['apply', 'keep']) }).strict())
        .max(3000),
      reviewedIds: z.array(z.uuid()).max(1000).default([]),
    })
    .strict(),
]);
export type LocaleSourceInput = z.infer<typeof localeSourceInputSchema>;
export type LocaleSourceChange = {
  id: string;
  sourceId: string;
  targetId: string | null;
  kind: 'content' | 'add' | 'remove' | 'move' | 'order';
  title: string;
  safe: boolean;
  detail: string;
  blocked?: string;
  field?: string;
  fields?: {
    name: string;
    label: string;
    before: Json;
    source: Json;
    local: Json;
    conflict: boolean;
  }[];
};
export type LocaleSourceReview = {
  token: string;
  linked: boolean;
  source: LocaleSnapshot;
  mappings: Record<string, string | null>;
  changes: LocaleSourceChange[];
  needsTranslation: { id: string; title: string }[];
};
