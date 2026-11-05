import { z } from 'zod';

export const managementScopes = [
  'read',
  'content:edit',
  'content:publish',
  'assets:write',
  'schemas:write',
  'datasources:write',
  'settings:write',
  'admin',
] as const;
export type ManagementScope = (typeof managementScopes)[number];

export const managementTokenInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z
      .array(z.enum(managementScopes))
      .min(1)
      .max(managementScopes.length)
      .refine((items) => items.includes('read'), 'Read access is required')
      .refine((items) => new Set(items).size === items.length, 'Duplicate permission'),
  })
  .strict();
