import { z } from 'zod';

export const pageMapQuerySchema = z
  .object({
    root: z.uuid().optional(),
    locale: z.string().max(80).optional(),
    mode: z.enum(['published', 'draft']).default('published'),
    direction: z.enum(['outgoing', 'incoming', 'both']).default('outgoing'),
    depth: z.coerce.number().int().min(1).max(4).default(2),
    references: z.enum(['true', 'false']).default('false'),
    search: z.string().max(200).default(''),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export type PageMapQuery = z.infer<typeof pageMapQuerySchema>;
export const pageMapNodeSchema = z.object({
  id: z.uuid(),
  localeId: z.uuid(),
  title: z.string(),
  url: z.string(),
  locale: z.string(),
  localeName: z.string(),
  fallback: z.boolean(),
  status: z.enum(['published', 'draft', 'changed']),
  incoming: z.number().int().nonnegative(),
  outgoing: z.number().int().nonnegative(),
});
export type PageMapNode = z.infer<typeof pageMapNodeSchema>;
export const pageMapEdgeSchema = z.object({
  source: z.uuid(),
  target: z.uuid(),
  kind: z.enum(['link', 'reference']),
  count: z.number().int().positive(),
  usages: z
    .array(z.object({ blockId: z.uuid(), block: z.string(), field: z.string(), label: z.string() }))
    .max(100),
});
export type PageMapEdge = z.infer<typeof pageMapEdgeSchema>;
export const pageMapResponseSchema = z.object({
  nodes: z.array(pageMapNodeSchema).max(100),
  edges: z.array(pageMapEdgeSchema).max(500),
  truncated: z.boolean(),
  limits: z.object({ nodes: z.literal(100), edges: z.literal(500) }),
});
export type PageMapResponse = z.infer<typeof pageMapResponseSchema>;
export const pageMapPagesSchema = z.object({
  pages: z.array(pageMapNodeSchema).max(50),
  nextOffset: z.number().int().nullable(),
  restricted: z.boolean(),
});
export type PageMapPages = z.infer<typeof pageMapPagesSchema>;
