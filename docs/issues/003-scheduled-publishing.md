# 003 — Schedule a reviewed locale checkpoint

Status: TODO  
Source: comparison gap 3  
Related: [lifecycle](001-story-lifecycle.md), [webhooks](002-webhooks.md),
[permissions](008-scoped-permissions.md)

## Problem and current implementation

Publishing currently requires an editor to be present at launch time.
[StoryWorkspace](../../apps/web/src/features/editor/story-workspace.tsx) already
reviews a fixed checkpoint, and [StorypaneStore](../../packages/db/src/store.ts)
validates that checkpoint's deployed schema, references, and published-URL
uniqueness before changing the publication pointer.

Keep those semantics. Scheduling must never accidentally publish later autosaves.
The current store authenticates interactive sessions; a job scheduled for tomorrow
cannot reuse today's browser session or forge an admin Actor.

## Proposed behavior

- Add Schedule beside Publish in the existing fixed-checkpoint review. Display
  locale, revision, live URL, publication date/time, and IANA timezone. Default to
  the browser's timezone; show the resolved offset before confirmation.
- One pending schedule per story locale. Replacing a schedule requires reviewing
  the replacement checkpoint. Editing only the time keeps the same checkpoint.
- Later edits remain drafts and the editor explicitly shows “Scheduled revision
  N; newer draft changes are not included.” An unpublished page remains unavailable
  publicly until execution; an already-live page keeps its old publication.
- Show pending/failed schedules in the content list and editor, with reschedule,
  cancel, and Publish now actions. Publish now uses the scheduled checkpoint after
  review. Other immediate publishing cancels the pending schedule atomically, so
  an old job cannot overwrite it later.
- Each locale is scheduled independently. No multi-page release, approval flow,
  recurring schedule, or scheduled unpublish in this issue.
- Reject past times and nonexistent daylight-saving times. For ambiguous local
  times, require an explicit offset choice. Store the resolved UTC instant and
  the chosen IANA timezone; later timezone-setting changes do not move the job.

## Persistence and execution

Add publication_schedules containing space/story/locale/checkpoint IDs, deployed
schema version, creator user ID, due_at UTC, timezone, status, revision,
attempt_count, next_attempt_at, completed publication ID, and safe error details.
Statuses are pending, published, cancelled, and failed. A partial unique index
permits only one pending schedule per locale. Preserve completed/cancelled records
for history; replacing one creates a new schedule ID.

Use the existing CMS locale route pattern for list/create/update/cancel actions,
with core validation, request IDs, and expected schedule revisions for retries and
concurrent changes. Scheduling requires read access to the full checkpoint and
publish permission for that locale. Cancellation/rescheduling uses current publish
permission, not ownership alone.

The scheduled Worker checks due rows once per minute. Reuse 002's cron entry point
if present; there is no browser timer. Treat one-minute cadence as a normal latency
target, not an exact-time guarantee. Use database time for the due decision and
process overdue work after an outage.

For each candidate, acquire the existing space/path/locale locks in their normal
order, then lock and recheck the pending schedule (SKIP LOCKED where appropriate).
Do not invert lock order by holding a schedule lock while waiting for the locale.
In one short transaction:

1. Recheck pending status/revision, due time, story not deleted, and the creator's
   current membership and content permissions. Expired browser sessions do not
   cancel valid jobs; removed members or lost permission fail them visibly.
2. Require the checkpoint's schema version to remain deployed. Do not silently
   migrate or swap scheduled content. An intervening schema deployment marks the
   schedule failed and requires a new review, even if the schema change was safe.
3. Run the same complete publish validation and URL-collision checks as manual
   publication, then create the publication and update its pointer.
4. Mark the schedule published with its publication ID, record publication history,
   and enqueue 002's event in the same transaction when webhooks are implemented.

Extract only the shared transactional publication operation from publishCheckpoint.
Interactive callers continue checking their sessions; the internal scheduler
explicitly authorizes the stored creator without accepting user-provided identity.
Never add a public “skip authorization” parameter.

Row locks plus transactional status updates prevent double publication. A crash
before commit leaves a pending job; a crash after commit cannot publish it again.
Validation, deletion, permission, or URL failures are terminal and visible. Retry
transient infrastructure failures up to five total attempts at 1, 5, 15, and 60
minute intervals, then mark failed for review. If Postgres itself is unavailable,
the still-pending row is retried on a later tick.

Cancellation, unpublish, deletion, and manual publish serialize on the same locks:
if cancellation commits first the runner cannot publish; if publication wins, the
UI reports the completed action instead of falsely reporting cancellation.
Unpublish/delete also cancel future jobs, preventing an unexpected reappearance.

After commit, notify active editors through a trusted internal invalidation path
that reloads persisted state for each authorized subscriber. The existing notify
route assumes an interactive Actor; do not fabricate a session to use it. Missed
notifications recover through the existing heartbeat/sync protocol.

## Implementation reach

- Core schedule/status schemas; DB migration and registration, scheduling methods,
  shared publication validation, history, retry bookkeeping, and creator checks.
- CMS schedule routes; StoryWorkspace review/actions, content list status/filter,
  timezone input and error states, realtime invalidation, and preview refresh.
- Worker scheduled handler/configuration, generated binding types, local testing
  and deployment instructions. Use the existing Hyperdrive/Postgres connection.
- Lifecycle actions, schema deployment, and permission changes must integrate the
  cancellation/failure rules. SDK consumers continue receiving normal publications.
- Extend DB/realtime tests and editor browser tests. Inject/control time in tests;
  do not make the suite wait for real minutes.

## Acceptance tests

- [ ] The reviewed checkpoint publishes while later drafts remain unpublished.
- [ ] No public change occurs before due_at; independent locale schedules do not
      affect each other. Browser closure/session expiry does not stop a valid job.
- [ ] Concurrent ticks and crash/retry cases create one publication and one event.
- [ ] Cancel/reschedule/publish-now/unpublish/delete races follow transaction order
      and cannot resurrect stale content.
- [ ] Revoked membership/permissions, schema changes, and newly occupied live URLs
      produce visible failure without replacing the current publication.
- [ ] DST gaps/overlaps and non-local timezones resolve to the reviewed UTC instant.
- [ ] Transient retry exhaustion is visible; worker downtime leaves jobs recoverable.
- [ ] Scheduled changes refresh the editor and trigger a site's webhook rebuild;
      local scheduled invocation and the deployed cron are explicitly verified.

## References

[Storyblok scheduling](https://www.storyblok.com/docs/manuals/visual-editor#schedule-story-publication)
supports future publication. Pinning a checkpoint rather than incorporating later
saves is the proposed Storypane behavior.

[Cloudflare scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
provide the execution entry point; Postgres remains authoritative for jobs and
their completion.
