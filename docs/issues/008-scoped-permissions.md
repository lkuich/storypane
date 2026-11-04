# 008 — Content-scoped read, edit, and publish permissions

Status: TODO  
Source: comparison gap 8  
Related: [lifecycle](001-story-lifecycle.md), [webhooks](002-webhooks.md),
[scheduling](003-scheduled-publishing.md), [media](004-production-media.md)

## Problem and current implementation

Custom roles can choose broad capabilities, but cannot express “edit French only,”
“manage the blog folder,” or “edit copy but not the pricing field.” Every member
currently reads every story in the space.

- [Core permissions](../../packages/core/src/index.ts) and
  [space_roles](../../packages/db/migrations/008_space_roles.sql) contain six
  space-wide flags. Each member has one role; preserve that model.
- [Store authorization](../../packages/db/src/store.ts) rechecks sessions and
  membership from Postgres, but has no content target in the permission decision.
- [Role settings](../../apps/web/src/features/spaces/role-settings.tsx) expose
  checkboxes. [The request context](../../apps/web/src/lib/context.ts) returns only
  the broad permission list, and UI callers use can(space, permission).
- [StoryRoom.broadcast](../../apps/realtime/src/index.ts) rechecks membership but
  then sends the same full commit snapshot to authorized editor sockets. Merely
  hiding fields in the UI would leak content over HTTP/history/realtime.
- Field/schema migrations already provide stable field and definition IDs. Use
  those IDs instead of mutable field names, slugs, or display labels.

## Proposed permission model

Add an explicit content:read capability and allow scopes for read, edit, and publish
on each custom role. Admin remains unrestricted and is the only role allowed to
manage roles/members. Preserve the existing space-wide asset/schema/datasource/
settings capabilities; asset-folder permissions are outside this issue.

For each content capability, support these scope dimensions:

| Dimension | Meaning                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| Location  | All stories, or a union of selected folder subtrees and explicit story IDs; represent the space root explicitly |
| Locale    | All locales, or selected stable space-locale IDs                                                                |
| Block     | All block types, or selected stable definition IDs                                                              |
| Field     | All fields, or selected stable field IDs within definitions                                                     |

An unrestricted dimension matches all. An explicit empty selection matches none.
Selections within a dimension are OR; dimensions combine with AND. Location's
folder/story selections are one union, not intersecting requirements. No matching
scope means deny. Use allow scopes only in v1, with no deny-rule precedence or
multiple-role merging. Unknown/deleted IDs must never become unrestricted.

Read permission is required in addition to edit/publish permission. UI and server
must reject or render ineffective grants that could never satisfy this rule.
Folder scope includes descendants using actual ancestry, not string-prefix slugs;
rename preserves access, and moving a subtree can change access.

Backfill every existing role, including custom read-only roles, with unrestricted
read and unrestricted scopes for its existing capabilities. Built-in Editor and
Viewer retain current behavior. Creating a new custom role requires explicit scope
review; no migration silently removes users' access or introduces publish access.

Example: a translator role can read all content but edit/publish only French in
the Blog subtree. An author role can read the whole locale while editing selected
text fields, with no publishing capability.

## Enforcement semantics

- Put target-aware policy evaluation in the store. Pass stable space/story/locale/
  block/field context; never trust permission decisions or role names supplied by
  a client. Existing can() calls remain useful only for broad navigation gates.
- Filter story/locale lists, counts, search results, reference labels, personal
  pins, presence, asset usage, and migration-impact displays before returning them.
  A hidden story's direct URL behaves like not-found. Ancestor folder navigation
  must not expose hidden siblings or their counts.
- Within a readable locale, hidden blocks/fields appear only as restricted
  placeholders containing the minimum opaque structural identity needed by the
  editor. Omit values and derived labels from snapshots, checkpoints, publication
  review JSON, commit responses, errors, and clipboard/export data. Filter actor
  and lease details for inaccessible content as well.
- Saving an allowed field preserves unreadable/uneditable fields in the database.
  Do not treat omitted redacted fields as deletion or accept hidden values echoed
  from stale clients. Compare changed field IDs server-side and reject unauthorized
  changes. Define a projected editor DTO separately from the complete internal
  snapshot so clients cannot accidentally round-trip hidden data as an empty value.
- Insert/reorder/remove/move require edit permission on the relevant parent list
  and affected child content. Removing a block, restoring a page, importing, pasting,
  or duplicating cannot bypass restrictions on descendant fields. Deny a whole
  operation when it includes unauthorized changes; do not partially apply it.
- Publishing a locale checkpoint requires read and publish access to every value
  and structural block it would expose. There is no partial-field publication.
  Unpublish and whole-story delete similarly require authority over their entire
  scope. A role limited to editing some fields can hand off publication to another
  authorized user without adding an approval workflow.
- Creating a story requires creation/edit access in its destination; moving one
  requires access in both source and destination. Folder mutations must authorize
  every affected descendant/path change, not only the folder object. Whole-story
  metadata changes require access across its affected locales.
- Adding/changing a reference requires read access to its target. Keep existing
  hidden references intact, display a restricted placeholder, and never expand them
  in previews, options, or errors. Do not rewrite stored references on role changes.

## Realtime, preview, and credential boundaries

Re-evaluate permissions on HTTP requests, lease acquisition/renewal, heartbeat,
snapshot sync, mutation replay, and before each outgoing commit. Deliver an
actor-specific projected snapshot, not a shared full commit payload. Close a
socket when it loses access to the story/locale; remove inaccessible leases and
editor indicators. Retain unsent user input as unsent without retrying forbidden
writes. Permission revocation cannot recall content already received by a user.

An iframe renderer currently expects full content. In v1, editor preview requires
full read access to the locale and every referenced story it expands. Disable
preview with an explanatory message for partial readers; do not hand a full
snapshot to the iframe. Recheck existing preview sessions on refresh/streaming,
including references assembled by previewStory. Field-restricted editing in the
CMS can still work with form view.

Published and server-preview delivery tokens remain intentionally space-wide
service credentials, separate from individual editor roles. Scoped editors cannot
create, list sensitive details of, or use privileged CMS endpoints to mint those
credentials. Require unrestricted content read plus the existing management
capability for any API that exposes whole-space content or integration credentials;
keep role management and webhook administration admin-only. Audit schema migration
review and management-token paths for indirect content disclosure. A UI-only
restriction is insufficient.

Publicly published content and 004's opted-in public media are public regardless
of CMS read restrictions. This issue does not turn published sites into private
member portals. Scheduler execution rechecks the creator's current scoped
permission, and bulk actions apply exactly the same policy as single-item actions.

## Implementation reach and rollout

- Core read capability, scope schemas, effective permissions, and projected editor
  response types; role migration and registration, SQL checks, seed defaults, and
  session/context responses. Preserve existing roles and invitation assignments.
- Store authorization callers: reads, queries/counts, references/options, lease
  methods, commands/receipts, history, migration reviews, paths/folders, lifecycle,
  schedules, asset usage, preview creation/expansion, and credential administration.
- CMS routes, WebSocket upgrade checks, and per-recipient StoryRoom output; no
  reusable full-snapshot broadcast for differently scoped users.
- Role UI scope pickers with search and a plain-language summary; editor fields,
  block actions, outline, history/review, list/bulk actions, and disabled preview
  explanations. Server-provided effective permissions drive controls.
- Existing fixtures and role/member tests, DB/store tests, realtime tests, editor
  recovery tests, and two-user browser coverage. SDK public-delivery contracts stay
  unchanged; document their service-credential boundary explicitly.
- No new provider, identity service, deployment binding, or policy DSL is needed.

Implement location/locale scopes first, then block/field scopes and projections.
Do not expose a read restriction in the UI until every HTTP/realtime/preview
surface that could bypass it is enforced. Both milestones are required to mark
this issue DONE; write-only UI restrictions do not satisfy the specification.

## Acceptance tests

- [ ] Upgrade preserves Admin/Editor/Viewer and all existing custom-role behavior.
- [ ] Folder ancestry, explicit story exceptions, locale/block/field combinations,
      empty scopes, missing IDs, and renames obey the documented matching rules.
- [ ] A French-only editor cannot change/publish another locale through direct API,
      import, duplicate, restore, bulk operation, old receipt, or scheduled job.
- [ ] Hidden content is absent from lists/counts, direct reads, history/review JSON,
      errors, options, reference expansion, asset usage, clipboard, and live commits.
- [ ] Saving a visible field preserves hidden fields; structural operations cannot
      delete or relocate protected descendants. Whole-checkpoint publish fails when
      any required read/publish permission is missing.
- [ ] Revocation during an active lease/socket/preview ends unauthorized access
      before further data is delivered; unrelated authorized editors keep working.
- [ ] Moving folders/stories changes effective access consistently; old slug URLs,
      stale clients, and deferred jobs cannot retain the old grant.
- [ ] Restricted users cannot obtain broad credentials or read migration data as
      a bypass. Public delivery retains its separately documented semantics.
- [ ] Browser tests demonstrate a full-access editor and restricted collaborator
      editing together without data disclosure, hidden-field loss, or unsafe retries.

## Reference

[Storyblok roles](https://www.storyblok.com/docs/manuals/roles) support permissions
across content, blocks, fields, and languages. The allow-scope semantics and staged
implementation above are proposed Storypane decisions.
