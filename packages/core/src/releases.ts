import { z } from 'zod';
import type { PublicationSchedule } from './index.js';

export type ContentRelease = {
  id: string;
  name: string;
  dueAt: string;
  timezone: string;
  status: 'scheduled' | 'held' | 'published' | 'cancelled';
  revision: number;
  error: string | null;
  canManage: boolean;
  items: Array<
    PublicationSchedule & {
      storyName: string;
      localeName: string;
      localeSlug: string;
      draftRevision: number;
      draftChanged: boolean;
    }
  >;
};

export const releaseInputSchema = z
  .object({
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    dueAt: z.iso.datetime(),
    timezone: z.string().min(1).max(100),
    localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    revision: z.number().int().positive().optional(),
  })
  .strict();
