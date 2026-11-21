import { z } from 'zod';
import type { PublicationSchedule } from './index.js';

export type ContentRelease = {
  id: string;
  name: string;
  dueAt: string | null;
  immediate: boolean;
  timezone: string;
  status: 'draft' | 'scheduled' | 'held' | 'published' | 'cancelled';
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

const scheduledReleaseInput = z
  .object({
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    dueAt: z.iso.datetime(),
    timezone: z.string().min(1).max(100),
    localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    revision: z.number().int().positive().optional(),
  })
  .strict();

const untimedReleaseInput = scheduledReleaseInput.pick({
  requestId: true,
  name: true,
  timezone: true,
  revision: true,
});

export const releaseInputSchema = z.union([
  scheduledReleaseInput,
  untimedReleaseInput.extend({ draft: z.literal(true) }),
  untimedReleaseInput.extend({ now: z.literal(true) }),
]);
