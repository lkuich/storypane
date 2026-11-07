import { z } from 'zod';

const userId = z.string().min(1).max(256);
const uniqueUsers = z
  .array(userId)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate member');
export const teamInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    memberIds: uniqueUsers,
    minimumApprovals: z.number().int().min(1).max(500),
  })
  .strict()
  .refine(
    (team) => team.minimumApprovals <= team.memberIds.length,
    'Minimum approvals cannot exceed the number of members',
  );
export type Team = z.infer<typeof teamInputSchema> & { id: string };
export const discussionInputSchema = z
  .object({
    storyId: z.uuid(),
    localeId: z.uuid(),
    blockId: z.uuid().nullable().default(null),
    kind: z.enum(['review', 'comment']),
    message: z.string().trim().max(10000).default(''),
    reviewerIds: uniqueUsers.default([]),
    teamIds: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate team')
      .default([]),
    mentionIds: uniqueUsers.default([]),
    expectedVersion: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'review' && !value.reviewerIds.length && !value.teamIds.length)
      context.addIssue({ code: 'custom', message: 'Choose at least one reviewer or team' });
    if (
      value.kind === 'comment' &&
      (!value.message || value.reviewerIds.length || value.teamIds.length)
    )
      context.addIssue({
        code: 'custom',
        message: 'A discussion needs a message and no review assignments',
      });
  });
export const discussionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), expectedVersion: z.string().min(1).max(64) }).strict(),
  z
    .object({
      action: z.literal('request_changes'),
      mentionIds: uniqueUsers.default([]),
      expectedVersion: z.string().min(1).max(64),
      message: z.string().trim().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      action: z.literal('reply'),
      message: z.string().trim().min(1).max(10000),
      mentionIds: uniqueUsers.default([]),
    })
    .strict(),
  z.object({ action: z.enum(['withdraw', 'resolve', 'reopen']) }).strict(),
]);
export type DiscussionAction = z.infer<typeof discussionActionSchema>;
export type ReviewPerson = { id: string; name: string; email: string; canReview: boolean };
export type ReviewDirectory = { members: ReviewPerson[]; teams: Team[]; version: string };
export type Discussion = {
  id: string;
  storyId: string;
  storyName: string;
  localeId: string;
  locale: string;
  localeName: string;
  blockId: string | null;
  blockName: string | null;
  kind: 'review' | 'comment';
  requesterId: string;
  requesterName: string;
  createdAt: string;
  status:
    'pending' | 'changes_requested' | 'approved' | 'withdrawn' | 'published' | 'open' | 'resolved';
  version: string;
  changed: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  reviewerIds: string[];
  teams: (Team & { approvals: number })[];
  reviewers: { id: string; name: string; decision: 'approve' | 'request_changes' | null }[];
  messages: {
    id: string;
    userId: string;
    name: string;
    body: string;
    mentionIds: string[];
    event: string;
    contentVersion: string | null;
    contentRevision: number | null;
    createdAt: string;
  }[];
};
