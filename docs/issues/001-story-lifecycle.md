# 001 — Story lifecycle and bulk actions

Status: TODO  
Source: comparison gap 1  
Related: [webhooks](002-webhooks.md), [scheduling](003-scheduled-publishing.md),
[media](004-production-media.md), [permissions](008-scoped-permissions.md)

## Problem and current implementation

Editors can create, move, edit, and publish stories, but cannot unpublish,
duplicate, or delete whole stories, or select several stories for an action.

- [The command contract](../../packages/core/src/index.ts) supports
  publishCheckpoint and block/page restoration, but no unpublish command.
- [StorypaneStore](../../packages/db/src/store.ts) publishes immutable snapshots
  by changing story_locales.published_version_id. Existing publications/history
  can remain intact when that pointer is cleared.
- [ContentList](../../apps/web/src/features/content/content-list.tsx) has no
  selection or bulk-action state. Location editing already handles translated
  paths and folder restrictions.
- [Initial foreign keys](../../packages/db/migrations/001_initial.sql) cascade a
  physical story deletion through locales, checkpoints, and publications. Do not
  implement the user-facing Delete action with that cascade.

## Proposed behavior

| Action | Scope and result | Authorization |
| --- | --- | --- |
| Unpublish | Explicitly selected locales; clear their live pointers, retain drafts/history, and record the action | Publish permission on each affected locale |
| Duplicate | Copy all existing locale drafts into a new story in the same space; new story, locale, block, and checkpoint IDs; always unpublished | Read the complete source and edit/create in the destination |
| Delete | Soft-delete the whole story, unpublish every locale, revoke its previews/leases, and cancel pending schedules | Edit all affected content; also publish permission if any locale is live or scheduled |
| Restore deleted story | Restore from the Deleted filter, keeping the story unpublished; never reactivate old schedules | Edit/create in the restored destination |
| Bulk actions | Publish, unpublish, move, duplicate, and delete selected stories, with an explicit locale choice for publication actions | Same checks as each single-item action |

Deletion adds deleted_at/deleted_by to stories. Keep source rows, references,
checkpoints, publications, and R2 bytes. Keep deleted slugs reserved in v1, making
that visible in collision errors. A minimal Deleted filter and Restore action
provide recovery; permanent deletion and retention policies are outside this issue.

Duplication copies the last saved draft, preserving schema identities, field
values, locale mappings, and external asset/story references. Story references
still point to their original targets, including self-references; do not silently
rewrite links between duplicated stories. Do not copy pins, leases, receipts,
publication pointers, or schedules. Require a destination and collision-free slug;
bulk duplication chooses a unique suffix and records the chosen result for retries.

Unpublish review shows affected live URLs and warns about incoming published story
references. Require acknowledgment if references exist. Delete is blocked while
another active story's current draft or publication references the target; links
within the deleted story and historical-only references do not block it. Check
typed link and story-option fields rather than matching arbitrary UUID strings.
Do not disregard references from other selected stories: a bulk item may fail.
After 008, blockers from unreadable stories are reported without their names/paths.

## API, storage, and concurrency

- Add unpublishLocale to the existing locale command endpoint, requiring the
  reviewed publication ID (nullable for an already-unpublished locale). A newer
  publication produces a stale-review error instead of being removed.
- Add CMS routes for POST stories/:id/duplicate, DELETE stories/:id, and POST
  stories/:id/restore. Validate payloads in core and enforce space membership in
  the store. Deletion review supplies the complete expected locale/checkpoint and
  publication set; a new locale or concurrent change invalidates the review.
- Add POST stories/bulk with at most 50 explicit story targets. Never expand a
  client filter into an unbounded server-side selection. Return a result/error
  for every item, and preserve failed selections for retry.
- Each story action is transactional, including all its selected locales. Bulk
  processing allows partial success between stories and reports it explicitly.
  Bulk publication uses fixed reviewed checkpoint IDs, not whatever draft is
  newest when the request arrives.
- Persist request IDs and canonical request hashes for whole-story operations;
  existing receipts are locale/checkpoint-specific and cannot cover every action.
  Scope receipts to space and actor. The same ID/body returns the committed result;
  ID reuse with different input fails. Recheck authorization even on replay.
- Preserve the store's space/path/locale lock order; take multiple locale locks in
  stable ID order. All reference creation and delete checks need a common lock
  discipline so a reference cannot appear between checking and soft-deleting.
  Serialize schedule execution and lifecycle actions on the same locale locks.
- Flush the initiating editor's unsent input before destructive review. Refuse
  deletion while another editor holds an affected lease. A stale tab must never
  save to or publish a deleted story.
- Soft-deleted stories disappear from normal lists, counts, options, delivery,
  preview creation, presence, and media eligibility. Historical access is confined
  to the authorized deleted-story view. Existing sockets receive invalidation and
  close; their next heartbeat also detects deletion if notification was missed.
- Exclude tombstones from active schema-migration content plans. On restoration,
  migrate the retained drafts to the deployed schema using the existing restore
  rules; block and explain invalid content instead of silently destroying it.
  Folder deletion must continue respecting retained story foreign keys.
- Move preserves the existing rule: live URLs change only when republished.
  Unpublish/delete take effect in the delivery API immediately after commit;
  generated sites need a rebuild through 002. Do not promise automatic redirects.

## Implementation reach

- Core commands, story summaries/deleted state, validators, and receipt/result types.
- DB migration plus [migration registration](../../packages/db/src/migrate.ts);
  StorypaneStore lifecycle methods, list/count/option queries, reference validation,
  path handling, preview/delivery reads, migration planning, and receipts.
- [CMS routes](../../apps/web/src/app/api/cms/[...path]/route.ts), worker WebSocket
  authorization, and [StoryRoom](../../apps/realtime/src/index.ts) invalidation.
- ContentList selection/review/results, StoryLocationDialog reuse, StoryWorkspace
  unpublish/delete actions, navigation guards, and accessible confirmations.
- Existing DB, realtime, content-filter, editor, and preview tests; fixtures must
  distinguish active, unpublished, and deleted stories. Update README and SDK
  delivery/rebuild guidance. No new deployment binding is required.

## Acceptance tests

- [ ] Unpublishing one locale preserves other locales, drafts, and history.
- [ ] Reviewed IDs fence concurrent edits/publications; failed operations roll back.
- [ ] A lost response and retry never duplicate a story or repeat side effects.
- [ ] Duplication preserves locale structure with fresh IDs and no live publication.
- [ ] Delete preserves history/bytes, rejects incoming active references, and
  prevents new references, stale-tab saves, preview access, and delivery access.
- [ ] Restore stays unpublished, handles intervening schema migrations, and keeps
  old schedules cancelled. Reserved-slug errors explain the deleted owner safely.
- [ ] Bulk failures are per-story, actionable, and safe to retry; locale selection
  never silently publishes or unpublishes other translations.
- [ ] Viewer, cross-space, scoped-role, active-lease, and schedule-race cases fail
  closed. Browser coverage exercises selection, review, partial failure, and recovery.

## Reference

[Storyblok story actions](https://www.storyblok.com/docs/manuals/stories) and
[unpublishing](https://www.storyblok.com/docs/api/management/stories/unpublish-a-story)
establish the comparison. Soft deletion and the exact batch contract above are
Storypane design decisions.
