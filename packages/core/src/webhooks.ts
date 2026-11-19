import { z } from 'zod';

export const webhookEventTypes = [
  'story.saved',
  'story.published',
  'story.unpublished',
  'story.deleted',
  'story.moved',
  'asset.updated',
  'schema.deployed',
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];
export const vercelDeployEvents = ['vercel.publish', 'vercel.release'] as const;
type VercelDeployEvent = (typeof vercelDeployEvents)[number];
export const webhookInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z.url().max(2000),
    events: z
      .array(z.enum(webhookEventTypes))
      .min(1)
      .max(webhookEventTypes.length)
      .refine((values) => new Set(values).size === values.length, 'Duplicate event'),
    enabled: z.boolean(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export const webhookRevisionSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const vercelDeployHookInputSchema = webhookInputSchema.extend({
  kind: z.literal('vercel'),
  url: z.string().trim().min(1).max(2000).optional(),
  events: z
    .array(z.enum(vercelDeployEvents))
    .max(vercelDeployEvents.length)
    .refine((values) => new Set(values).size === values.length, 'Duplicate event'),
});
export const webhookEventDataSchema = z
  .object({
    storyId: z.uuid().optional(),
    localeId: z.uuid().optional(),
    locale: z.string().max(80).optional(),
    checkpointId: z.uuid().optional(),
    publicationId: z.uuid().optional(),
    revision: z.number().int().nonnegative().optional(),
    path: z.string().max(2048).optional(),
    oldPath: z.string().max(2048).optional(),
    migrationVersion: z.number().int().nonnegative().optional(),
    assetId: z.uuid().optional(),
    metadataRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export const webhookEventInputSchema = z
  .object({
    spaceId: z.uuid(),
    actorId: z.string().min(1).max(500).optional(),
    type: z.enum([...webhookEventTypes, ...vercelDeployEvents]),
    key: z.string().min(1).max(300),
    data: webhookEventDataSchema,
  })
  .strict();
export type WebhookEventInput = z.infer<typeof webhookEventInputSchema>;
export type WebhookEvent = {
  version: 1;
  id: string;
  type: WebhookEventType | 'webhook.test';
  occurredAt: string;
  spaceId: string;
  actorId?: string;
  data: z.infer<typeof webhookEventDataSchema>;
};
export type WebhookEndpoint = {
  id: string;
  name: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type WebhookDestination =
  | (WebhookEndpoint & { kind?: never })
  | (Omit<WebhookEndpoint, 'url' | 'events'> & {
      kind: 'vercel';
      events: VercelDeployEvent[];
    });
export type WebhookDelivery = {
  id: string;
  eventId: string;
  type: WebhookEvent['type'] | VercelDeployEvent | 'vercel.rebuild';
  status: 'pending' | 'delivering' | 'succeeded' | 'failed' | 'cancelled';
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
  completedAt: string | null;
  httpStatus: number | null;
  error: string | null;
  endpointRevision: number;
  attempts: {
    number: number;
    startedAt: string;
    completedAt: string | null;
    httpStatus: number | null;
    error: string | null;
  }[];
};
