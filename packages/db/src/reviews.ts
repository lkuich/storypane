import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  StorypaneError,
  canonicalJson,
  blockAllowed,
  parseInput,
  snapshotAllowed,
  type Actor,
  type LocaleSnapshot,
  type Team,
  type Discussion,
  type ReviewDirectory,
  type DiscussionAction,
} from '@storypane/core';
import { z } from 'zod';
import { loadContentAccess, projectSnapshot } from './content-access.js';

type Thread = {
  id: string;
  space_id: string;
  locale_id: string;
  block_id: string | null;
  block_name: string | null;
  kind: 'review' | 'comment';
  requester_id: string;
  reviewer_ids: string[];
  teams: Team[];
  initial_version: string;
  scope_snapshot: LocaleSnapshot;
  closed: 'withdrawn' | 'published' | 'resolved' | null;
  closed_version: string | null;
  created_at: Date;
};
export type ReadSnapshot = (storyId: string, localeId: string) => Promise<LocaleSnapshot>;
function targetBlocks(snapshot: LocaleSnapshot, blockId: string | null) {
  if (!blockId) return snapshot.blocks;
  const ids = new Set([blockId]);
  let size = 0;
  while (size !== ids.size) {
    size = ids.size;
    for (const block of snapshot.blocks)
      if (block.parentId && ids.has(block.parentId)) ids.add(block.id);
  }
  return snapshot.blocks.filter((block) => ids.has(block.id));
}
export function reviewVersion(snapshot: LocaleSnapshot, blockId: string | null, revisions = true) {
  const blocks = targetBlocks(snapshot, blockId)
    .map(({ revision, ...block }) => ({
      ...block,
      ...(revisions ? { revision } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(
      canonicalJson({
        blocks,
        ...(!blockId
          ? {
              url: snapshot.locale.urlSlug,
              root: snapshot.locale.rootBlockId,
              name: snapshot.story.name,
            }
          : {}),
      }),
    )
    .digest('hex');
}
async function canRead(
  client: PoolClient,
  actor: Actor,
  snapshot: LocaleSnapshot,
  blockId: string | null,
) {
  const access = await loadContentAccess(client, actor);
  const projected = projectSnapshot(access, snapshot);
  const blocks = targetBlocks(snapshot, blockId);
  return blockId && blocks.length
    ? blocks.every(
        (block) =>
          blockAllowed(access, snapshot, block, 'content:read') &&
          projected.access.blocks[block.id]?.complete,
      )
    : snapshotAllowed(access, snapshot, 'content:read') && projected.access.complete;
}
export async function assertDiscussionAccess(
  client: PoolClient,
  actor: Actor,
  snapshot: LocaleSnapshot,
  blockId: string | null,
) {
  if (!(await canRead(client, actor, snapshot, blockId)))
    throw new StorypaneError(
      'forbidden',
      'Discussions require read access to all content in their scope',
    );
}
export async function listTeams(client: PoolClient, spaceId: string): Promise<Team[]> {
  return (
    await client.query(
      'SELECT id,name,member_ids AS "memberIds",minimum_approvals AS "minimumApprovals" FROM teams WHERE space_id=$1 ORDER BY lower(name),id',
      [spaceId],
    )
  ).rows;
}
export async function saveTeam(
  client: PoolClient,
  spaceId: string,
  input: Omit<Team, 'id'>,
  id?: string,
) {
  const members = (
    await client.query(
      'SELECT user_id FROM memberships WHERE space_id=$1 AND user_id=ANY($2::text[])',
      [spaceId, input.memberIds],
    )
  ).rows;
  if (members.length !== input.memberIds.length)
    throw new StorypaneError('invalid', 'Choose members from this space');
  const result = id
    ? await client.query(
        'UPDATE teams SET name=$3,member_ids=$4,minimum_approvals=$5 WHERE space_id=$1 AND id=$2 RETURNING id',
        [spaceId, id, input.name, input.memberIds, input.minimumApprovals],
      )
    : await client.query(
        'INSERT INTO teams(space_id,name,member_ids,minimum_approvals) VALUES($1,$2,$3,$4) RETURNING id',
        [spaceId, input.name, input.memberIds, input.minimumApprovals],
      );
  if (!result.rowCount) throw new StorypaneError('not_found', 'Team not found');
  return { ...input, id: result.rows[0].id };
}
export async function reviewDirectory(
  client: PoolClient,
  actor: Actor,
  snapshot: LocaleSnapshot,
  blockId: string | null,
): Promise<ReviewDirectory> {
  await assertDiscussionAccess(client, actor, snapshot, blockId);
  const people = (
    await client.query(
      `SELECT u.id,u.name,u.email,r.permissions FROM memberships m JOIN "user" u ON u.id=m.user_id JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role WHERE m.space_id=$1 ORDER BY u.name,u.id`,
      [actor.spaceId],
    )
  ).rows;
  const members: ReviewDirectory['members'] = [];
  for (const person of people) {
    try {
      if (await canRead(client, { ...actor, userId: person.id }, snapshot, blockId))
        members.push({
          id: person.id,
          name: person.name,
          email: person.email,
          canReview: person.id !== actor.userId && person.permissions.includes('content:review'),
        });
    } catch (error) {
      if (!(error instanceof StorypaneError) || !['forbidden', 'not_found'].includes(error.code))
        throw error;
    }
  }
  return {
    members,
    teams: await listTeams(client, actor.spaceId),
    version: reviewVersion(snapshot, blockId),
  };
}
async function eligibleReviewers(
  client: PoolClient,
  actor: Actor,
  thread: Thread,
  snapshot: LocaleSnapshot,
) {
  const ids = [
    ...new Set([...thread.reviewer_ids, ...thread.teams.flatMap((team) => team.memberIds)]),
  ];
  const members = (
    await client.query(
      `SELECT u.id,u.name FROM memberships m JOIN "user" u ON u.id=m.user_id JOIN space_roles r ON r.space_id=m.space_id AND r.id=m.role WHERE m.space_id=$1 AND u.id=ANY($2::text[]) AND 'content:review'=ANY(r.permissions)`,
      [actor.spaceId, ids],
    )
  ).rows;
  const eligible: { id: string; name: string }[] = [];
  for (const member of members) {
    if (member.id === thread.requester_id) continue;
    try {
      if (
        (await canRead(client, { ...actor, userId: member.id }, snapshot, thread.block_id)) &&
        (await canRead(
          client,
          { ...actor, userId: member.id },
          thread.scope_snapshot,
          thread.block_id,
        ))
      )
        eligible.push(member);
    } catch (error) {
      if (!(error instanceof StorypaneError) || !['forbidden', 'not_found'].includes(error.code))
        throw error;
    }
  }
  return eligible;
}
async function state(client: PoolClient, actor: Actor, thread: Thread, snapshot: LocaleSnapshot) {
  const version = thread.closed_version ?? reviewVersion(snapshot, thread.block_id);
  const eligible = await eligibleReviewers(client, actor, thread, snapshot);
  const decisions = (
    await client.query(
      'SELECT user_id,decision,version FROM review_decisions WHERE discussion_id=$1',
      [thread.id],
    )
  ).rows;
  const valid = decisions.filter(
    (decision) =>
      decision.version === version &&
      (thread.closed || eligible.some((member) => member.id === decision.user_id)),
  );
  const approved = new Set(
    valid.filter((decision) => decision.decision === 'approve').map((decision) => decision.user_id),
  );
  const teams = thread.teams.map((team) => ({
    ...team,
    approvals: team.memberIds.filter((id) => approved.has(id)).length,
  }));
  const passed =
    thread.reviewer_ids.every((id) => approved.has(id)) &&
    teams.every((team) => team.approvals >= team.minimumApprovals);
  const status: Discussion['status'] =
    thread.closed ??
    (thread.kind === 'comment'
      ? 'open'
      : passed
        ? 'approved'
        : valid.some((decision) => decision.decision === 'request_changes')
          ? 'changes_requested'
          : 'pending');
  const names = (
    await client.query('SELECT id,name FROM "user" WHERE id=ANY($1::text[])', [
      [...new Set([...thread.reviewer_ids, ...thread.teams.flatMap((team) => team.memberIds)])],
    ])
  ).rows;
  return {
    version,
    status,
    teams,
    changed: thread.initial_version !== version,
    canDecide:
      !thread.closed &&
      thread.kind === 'review' &&
      status !== 'approved' &&
      eligible.some((member) => member.id === actor.userId) &&
      !valid.some(
        (decision) => decision.user_id === actor.userId && decision.decision === 'approve',
      ),
    reviewers: [
      ...new Set([...thread.reviewer_ids, ...thread.teams.flatMap((team) => team.memberIds)]),
    ].map((id) => ({
      id,
      name: names.find((member) => member.id === id)?.name ?? 'Former member',
      decision: valid.find((decision) => decision.user_id === id)?.decision ?? null,
    })),
  };
}
export async function listDiscussions(
  client: PoolClient,
  actor: Actor,
  read: ReadSnapshot,
  query: { storyId?: string; localeId?: string } = {},
): Promise<Discussion[]> {
  const access = await loadContentAccess(client, actor);
  const threads = (
    await client.query<Thread>(
      'SELECT d.* FROM discussions d JOIN story_locales l ON l.id=d.locale_id JOIN stories s ON s.id=l.story_id WHERE d.space_id=$1 AND s.deleted_at IS NULL AND ($2::uuid IS NULL OR s.id=$2) AND ($3::uuid IS NULL OR l.id=$3) ORDER BY d.created_at DESC,d.id',
      [actor.spaceId, query.storyId ?? null, query.localeId ?? null],
    )
  ).rows;
  const result: Discussion[] = [];
  const snapshots = new Map<string, LocaleSnapshot>();
  for (const thread of threads) {
    const locale = access.locales.find((item) => item.id === thread.locale_id);
    if (!locale) continue;
    let snapshot = snapshots.get(locale.id);
    if (!snapshot) {
      snapshot = await read(locale.storyId, locale.id);
      snapshots.set(locale.id, snapshot);
    }
    try {
      await assertDiscussionAccess(client, actor, snapshot, thread.block_id);
      await assertDiscussionAccess(client, actor, thread.scope_snapshot, thread.block_id);
    } catch (error) {
      if (error instanceof StorypaneError && ['forbidden', 'not_found'].includes(error.code))
        continue;
      throw error;
    }
    const status = await state(client, actor, thread, snapshot);
    const messages = (
      await client.query(
        `SELECT c.id,c.user_id AS "userId",coalesce(u.name,'Former member') AS name,c.body,c.mention_ids AS "mentionIds",c.event,c.content_version AS "contentVersion",c.content_revision AS "contentRevision",c.created_at AS "createdAt" FROM discussion_messages c LEFT JOIN "user" u ON u.id=c.user_id WHERE c.discussion_id=$1 ORDER BY c.created_at,c.id`,
        [thread.id],
      )
    ).rows;
    const requester = (
      await client.query('SELECT name FROM "user" WHERE id=$1', [thread.requester_id])
    ).rows[0];
    result.push({
      id: thread.id,
      storyId: snapshot.story.id,
      storyName: snapshot.story.name,
      localeId: snapshot.locale.id,
      locale: snapshot.locale.slug,
      localeName: snapshot.locale.name,
      blockId: thread.block_id,
      blockName: thread.block_name,
      kind: thread.kind,
      requesterId: thread.requester_id,
      requesterName: requester?.name ?? 'Former member',
      createdAt: thread.created_at.toISOString(),
      ...status,
      canWithdraw: !thread.closed && thread.requester_id === actor.userId,
      canDelete: (access.admin || thread.requester_id === actor.userId) && !actor.managementTokenId,
      reviewerIds: thread.reviewer_ids,
      messages: messages.map((message) => ({
        ...message,
        contentRevision: message.contentRevision == null ? null : Number(message.contentRevision),
        createdAt: message.createdAt.toISOString(),
      })),
    });
  }
  return result;
}
async function addMessage(
  client: PoolClient,
  actor: Actor,
  id: string,
  event: string,
  body = '',
  mentionIds: string[] = [],
  snapshot?: LocaleSnapshot,
  blockId: string | null = null,
) {
  await client.query(
    'INSERT INTO discussion_messages(discussion_id,user_id,event,body,mention_ids,content_version,content_revision) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      id,
      actor.userId,
      event,
      body,
      mentionIds,
      snapshot ? reviewVersion(snapshot, blockId) : null,
      snapshot?.revision ?? null,
    ],
  );
}
export async function createDiscussion(
  client: PoolClient,
  actor: Actor,
  snapshot: LocaleSnapshot,
  input: ReturnType<typeof import('@storypane/core').discussionInputSchema.parse>,
) {
  const directory = await reviewDirectory(client, actor, snapshot, input.blockId);
  if (input.expectedVersion !== directory.version)
    throw new StorypaneError(
      'stale_revision',
      'Content changed. Refresh before requesting review.',
    );
  if (input.blockId && !snapshot.blocks.some((block) => block.id === input.blockId))
    throw new StorypaneError('not_found', 'Block not found');
  const teams = input.teamIds.map((id) => directory.teams.find((team) => team.id === id));
  const eligible = new Set(
    directory.members.filter((member) => member.canReview).map((member) => member.id),
  );
  if (
    input.reviewerIds.some((id) => !eligible.has(id)) ||
    teams.some(
      (team) =>
        !team || team.memberIds.filter((id) => eligible.has(id)).length < team.minimumApprovals,
    )
  )
    throw new StorypaneError(
      'invalid',
      'Each reviewer must have review access; teams must have enough eligible members other than the requester.',
    );
  if (input.mentionIds.some((id) => !directory.members.some((member) => member.id === id)))
    throw new StorypaneError('invalid', 'Mentioned users must have access to this content');
  const block = snapshot.blocks.find((item) => item.id === input.blockId);
  const blockName = block
    ? snapshot.definitions.find((definition) => definition.versionId === block.schemaVersionId)
        ?.displayName
    : null;
  const row = (
    await client.query(
      'INSERT INTO discussions(space_id,locale_id,block_id,block_name,kind,requester_id,reviewer_ids,teams,initial_version,scope_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [
        actor.spaceId,
        snapshot.locale.id,
        input.blockId,
        blockName,
        input.kind,
        actor.userId,
        input.reviewerIds,
        JSON.stringify(teams),
        directory.version,
        JSON.stringify({
          ...snapshot,
          blocks: targetBlocks(snapshot, input.blockId),
          definitions: snapshot.definitions.filter((definition) =>
            targetBlocks(snapshot, input.blockId).some(
              (block) => block.schemaVersionId === definition.versionId,
            ),
          ),
          leases: [],
        }),
      ],
    )
  ).rows[0];
  await addMessage(
    client,
    actor,
    row.id,
    input.kind === 'review' ? 'requested' : 'comment',
    input.message,
    input.mentionIds,
  );
  return { id: row.id };
}
export async function discussionTarget(client: PoolClient, actor: Actor, id: string) {
  parseInput(z.uuid(), id);
  const row = (
    await client.query<Thread & { story_id: string }>(
      'SELECT d.*,l.story_id FROM discussions d JOIN story_locales l ON l.id=d.locale_id WHERE d.id=$1 AND d.space_id=$2',
      [id, actor.spaceId],
    )
  ).rows[0];
  if (!row) throw new StorypaneError('not_found', 'Discussion not found');
  return row;
}
export async function actOnDiscussion(
  client: PoolClient,
  actor: Actor,
  thread: Thread,
  snapshot: LocaleSnapshot,
  input: DiscussionAction,
) {
  await assertDiscussionAccess(client, actor, snapshot, thread.block_id);
  await assertDiscussionAccess(client, actor, thread.scope_snapshot, thread.block_id);
  if ('mentionIds' in input && input.mentionIds.length) {
    const directory = await reviewDirectory(client, actor, snapshot, thread.block_id);
    for (const id of input.mentionIds) {
      if (
        !directory.members.some((member) => member.id === id) ||
        !(await canRead(client, { ...actor, userId: id }, thread.scope_snapshot, thread.block_id))
      )
        throw new StorypaneError('invalid', 'Mentioned users must have access to this content');
    }
  }
  if (input.action === 'withdraw') {
    if (thread.kind !== 'review' || thread.requester_id !== actor.userId || thread.closed)
      throw new StorypaneError('forbidden', 'Only the requester can withdraw an active review');
    await client.query("UPDATE discussions SET closed='withdrawn' WHERE id=$1", [thread.id]);
  } else if (input.action === 'resolve' || input.action === 'reopen') {
    if (thread.kind !== 'comment')
      throw new StorypaneError(
        'invalid',
        'Reviews are completed by approval, not by resolving discussions',
      );
    await client.query('UPDATE discussions SET closed=$2 WHERE id=$1', [
      thread.id,
      input.action === 'resolve' ? 'resolved' : null,
    ]);
  } else if (input.action === 'reply') {
    if (thread.closed)
      throw new StorypaneError('invalid', 'Reopen this discussion before replying');
  } else if (input.action === 'approve' || input.action === 'request_changes') {
    const status = await state(client, actor, thread, snapshot);
    if (!status.canDecide)
      throw new StorypaneError('forbidden', 'This review is not awaiting your approval');
    if (input.expectedVersion !== status.version)
      throw new StorypaneError(
        'stale_revision',
        'Content changed while you were reviewing. Refresh and review the current content.',
      );
    await client.query(
      'INSERT INTO review_decisions(discussion_id,user_id,version,decision) VALUES($1,$2,$3,$4) ON CONFLICT(discussion_id,user_id,version) DO UPDATE SET decision=EXCLUDED.decision',
      [thread.id, actor.userId, status.version, input.action],
    );
  }
  await addMessage(
    client,
    actor,
    thread.id,
    input.action,
    'message' in input ? input.message : '',
    'mentionIds' in input ? input.mentionIds : [],
    snapshot,
    thread.block_id,
  );
}
export async function assertReviewsApproved(
  client: PoolClient,
  actor: Actor,
  current: LocaleSnapshot,
  candidate: LocaleSnapshot,
  pinned = false,
) {
  const threads = (
    await client.query<Thread>(
      "SELECT * FROM discussions WHERE locale_id=$1 AND space_id=$2 AND kind='review' AND closed IS NULL",
      [current.locale.id, actor.spaceId],
    )
  ).rows;
  const publication = current.locale.publishedVersionId
    ? ((
        await client.query('SELECT snapshot FROM publications WHERE id=$1 AND locale_id=$2', [
          current.locale.publishedVersionId,
          current.locale.id,
        ])
      ).rows[0]?.snapshot as LocaleSnapshot | undefined)
    : undefined;
  for (const thread of threads) {
    if (
      thread.block_id &&
      publication &&
      reviewVersion(candidate, thread.block_id, false) ===
        reviewVersion(publication, thread.block_id, false)
    )
      continue;
    const version = reviewVersion(candidate, thread.block_id);
    // Requests for later drafts do not apply to an already pinned release version.
    if (
      pinned &&
      thread.initial_version !== version &&
      !(
        await client.query(
          'SELECT 1 FROM review_decisions WHERE discussion_id=$1 AND version=$2 LIMIT 1',
          [thread.id, version],
        )
      ).rowCount
    )
      continue;
    const status = await state(client, actor, thread, pinned ? candidate : current);
    if (
      status.status !== 'approved' ||
      status.version !== reviewVersion(candidate, thread.block_id)
    )
      throw new StorypaneError(
        'invalid',
        'Publishing is blocked by an outstanding review. All assigned reviewers and team approval requirements must approve this content version.',
      );
  }
}
export async function completePublishedReviews(
  client: PoolClient,
  actor: Actor,
  candidate: LocaleSnapshot,
) {
  const threads = (
    await client.query<Thread>(
      "SELECT * FROM discussions WHERE locale_id=$1 AND space_id=$2 AND kind='review' AND closed IS NULL",
      [candidate.locale.id, actor.spaceId],
    )
  ).rows;
  for (const thread of threads) {
    const status = await state(client, actor, thread, candidate);
    if (
      status.status === 'approved' &&
      status.version === reviewVersion(candidate, thread.block_id)
    ) {
      await client.query(
        "UPDATE discussions SET closed='published',closed_version=$2 WHERE id=$1",
        [thread.id, status.version],
      );
      await addMessage(client, actor, thread.id, 'published');
    }
  }
}
