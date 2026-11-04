# Storypane: first implementation and subagent assignments

Status: implemented and integrated locally. Docker Postgres, Workers, Durable
Objects, R2, authentication, editor, schemas, locales, history, and media library
are running. See README for setup and the verification commands. Design review
and remote deployment remain separate steps.

## Agreed foundation

- Postgres is authoritative for JSONB schemas, drafts, history, and publications.
  Use local PostgreSQL 18 in Docker first; move to Neon when deploying remotely.
- Keep the Cloudflare target: Workers for the application/API, Durable Objects
  for realtime coordination, and R2 for assets. Develop against local bindings.
- Use a pnpm TypeScript monorepo. Next.js App Router code targets Workers through
  Cloudflare's recommended vinext build. Vinext is a Next.js API implementation
  in beta; the coordinator must verify routing, cookies, route handlers, and
  shared bindings before feature work. Do not claim full Next.js runtime parity.
- Local application port: 3130. Local Postgres: 127.0.0.1:55432. Do not reuse or
  reset the user's other running applications/databases.
- Each locale is an independent page with its own structure and publication.
  Default's locale slug is `""`; story URL slugs are separate. Use an internal
  locale ID in APIs and room keys so empty slugs do not create ambiguous routes.
- Import from Default copies selected subtrees once, with fresh block IDs.
- Exclusive editing is per block instance and locale. Pause offline, preserve
  unsent input, and reconcile on reconnect. No offline collaborative merge.
- Restore a page or an individual block into new draft history. Publish a reviewed,
  immutable checkpoint while later work continues in the draft.

## Ownership

| Owner                         | Owns                                                                              | Delivers                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Coordinator                   | Root configuration, manifests/lockfile, auth, app route shells, integration tests | Runnable monorepo, shared identity/space permissions, local Cloudflare bindings, integrated release  |
| Data & collaboration subagent | `packages/core`, `packages/db`, `apps/realtime`                                   | Contracts, schema validation, transactions, history, publishing, leases, WebSocket protocol          |
| Editor subagent               | Editor/schema/content/datasource features in `apps/web`; `packages/ui`            | Accessible schema builder, field editors, locale authoring, collaboration states, history/publish UI |
| DAM subagent                  | Asset features in `apps/web`; `packages/assets`                                   | R2 upload service, media library, folders, picker, metadata and content delivery                     |

Only the coordinator edits root/app package manifests, dependency versions, the
lockfile, and deployment configuration. The data subagent owns all migrations,
including asset tables specified by the DAM subagent. Shared contracts have one
owner in `packages/core`; consumers request changes rather than duplicating them.
Each agent owns tests for its behavior. The coordinator owns cross-feature tests.

## Work order

### 0. Coordinator: runtime, identity, and contract handoff

- Establish the pnpm workspace, TypeScript, Vitest, Playwright, and a local
  Cloudflare runtime with persisted Durable Object/R2 state and Postgres binding.
- Use `cf` for the new project and `cloudflare.config.ts`. Pin supported tooling:
  the inspected cf beta requires Node ^22.23, ^24.22, or ^26.12; the current
  machine runs Node 24.7. Upgrade the task runtime before application setup.
- Explicitly target account `c813587edc389800e834e0c261a91ef5`
  (`loren.jk3@gmail.com`). Do not change another project's default CLI login.
- Integrate database-backed cookie sessions with Better Auth, invite-only users,
  and space membership. Seed two local editors for concurrency testing. Admins
  manage schemas/datasources; editors manage content/assets/publishing. Account
  provisioning is currently an operator task; invitation/member-management UI is deferred.
  Keep test identities out of deployed configuration and authorize each request.
- Supply all agents with the same authenticated actor/session/space context,
  database access, environment bindings, and error format.
- Freeze the contracts below with the data agent before feature branches diverge.
  Editor and DAM may use typed fixtures while backend work proceeds.

### 1. Data & collaboration subagent

- Version block definitions as immutable JSONB schemas with stable definition IDs
  and flags permitting nestable, content-type, or universal use. Store schema
  version references with content. Do not destructively rewrite existing content
  when a definition changes.
- Store story identity, locale identity, current block rows, authoritative editing
  leases, immutable checkpoints, and immutable publications. Each block has a UUID,
  JSONB field values, definition version, parent field, order, and block revision.
  Store nesting once and assemble the nested JSON at API boundaries.
- Start with a full locale snapshot per accepted autosave batch. Preserve actor,
  locale sequence, mutation ID, reason, and schema versions. This intentionally
  favors simple recovery over storage efficiency; measure before adding deltas
  or retention. Add the required `shortcut:` comment at snapshot creation.
- Use `pg` and short database transactions. Serialize mutations briefly on the
  locale row to create a consistent snapshot and sequence. Compare affected block
  revisions, not a global page revision, so unrelated edits do not conflict.
- Leases last 45 seconds and renew every 15 seconds. Validate membership,
  session, opaque lease token, expiry, expected revisions, and payload shape on
  every mutation. Tokens from expired/released sessions cannot write.
- Durable Objects handle authenticated rooms keyed by space/story/locale,
  presence, and hibernating WebSockets. Persist first; acknowledge and broadcast
  only after commit. Include locale revision in heartbeats; on sequence gaps or
  reconnect return a current snapshot. A missed broadcast must not lose a commit.
- Use mutation IDs for idempotent retries. Reusing an ID with different content
  or actor fails. Reject stale writes and preserve the client's unsent buffer.
- Structural operations take short parent-list leases and respect locks on
  affected subtrees. Check cycles, allowed nesting, descendant locks, and parent
  revisions in the same transaction. Reading a parent never locks its children.
- Drafts may have incomplete required values. Publishing validates the selected
  checkpoint against its referenced schemas, copies its JSON into a new
  publication, and updates the published pointer atomically.
- Imports clone subtrees with new instance IDs but retain asset/story references.
  Block restore restores its historical subtree without changing siblings; page
  restore requires no competing locale leases. Both create new checkpoints.
- Implement managed KV datasources and a common option resolver for inline
  options, datasources, external JSON, and story references. External sources use
  `{items: [{value: string, label: string}]}`; validate responses, enforce bounded
  requests, and reject private-network/unsafe redirects for server-side fetches.

### 2. Editor subagent

- First slice: content list, create/open a page, Default locale, Hero/Footer
  composition, Text/Blocks fields, keyboard reorder, and autosave. Use a form
  editor with a block tree and field panel. Visual iframe preview comes later.
- Build the block definition library and schema editor with Nestable, Content
  Type, and Universal radio cards. Support ordered fields, labels, descriptions,
  defaults, and relevant validation constraints.
- Complete the field matrix after the slice works: Text with single-line,
  textarea, richtext, or markdown format; Number; Date/Time; Boolean; Single/Multi
  Option; Asset; Link; Blocks. Use Tiptap JSON for richtext and strings for
  markdown. Store actual numbers/booleans; preserve date-only values separately
  from UTC timestamps. Link values distinguish story, external URL, email, asset.
- Resolve choices through the shared options API. Handle pagination, loading,
  failed external sources, and selected references that are no longer available
  without silently clearing saved values.
- Acquire a lease before enabling edits. Autosave with 500 ms trailing debounce
  and a two-second maximum delay. Flush before release/navigation; show pending,
  saved, error, disconnected, locked, and conflict states accurately.
- Preserve unsent changes in browser storage scoped to user/space/story/locale.
  Reconnect and reacquire before retrying; replay only matching block revisions.
  Keep unrelated incoming changes from resetting focused input.
- Implement locale tabs, selected-subtree import, page/block history restore,
  and review/publish of a fixed checkpoint. Later edits remain draft.
- Reuse only needed UGC Scout Radix/Tailwind primitives. Include labels,
  keyboard operations, focus management, error descriptions, and announcements.

### 3. DAM subagent

- Extract library behavior from UGC Scout's
  `src/app/(dashboard)/brand/scout-storage/scout-storage-client.tsx` and upload UI
  from `src/components/brand/scout-storage-upload.tsx`. The existing resumable
  helper is Supabase TUS-specific: reuse its behavior, replace the transport.
- Remove brand, Supabase, Stripe, delivery archive, and expiration dependencies.
  Use shared space authorization. Give the data agent asset/folder/placement/
  upload-session table definitions; do not create a second migration system.
- Implement R2 multipart uploads through authenticated Worker routes with 10 MiB
  streamed parts, retry/progress/cancel, and resumable session state. Use the same
  R2 binding API locally and in Cloudflare. Preserve the source's 1 GiB limit.
- Start with image upload -> finalization -> library -> picker -> story Asset
  field, then add video/document support, folders, metadata, and archive.
- Verify ownership, actual size/type, completed object, and folder membership
  before exposing an asset. Completion is idempotent and recoverable if R2
  succeeds before the database commit. Never buffer a whole video in memory.
- Provide paginated search/listing, grid/list UI, folder breadcrumbs/placements,
  metadata editing, image/video previews, video range requests, document download,
  and an accessible picker. Retain two folder levels and many-to-many placements.
- Persist immutable asset IDs; replacing a file creates a new ID. Archive hides
  an asset from new selections but preserves historical references and bytes.
  Do not implement physical asset purge in the first release.

## Shared interfaces

- Shared types and runtime validators: block definition/version, field definition,
  block draft, locale snapshot, lease, checkpoint, publication, asset reference,
  option item, permissions, and validation errors.
- Command names: `saveBlock`, `insertBlock`, `moveBlock`, `deleteBlock`,
  `importBlocks`, `restoreBlock`, `restorePage`, `publishCheckpoint`.
- Mutation envelope: `{mutationId, expectedRevisions, leaseTokens, payload}`.
  Session authentication supplies the actor; never trust an actor ID in a payload.
- Commit response/event: `{mutationId, localeRevision, changedBlockIds,
checkpointId}`. Sync returns a current snapshot and active leases. Clients
  ignore old events and resync on gaps.
- Error codes: `unauthenticated`, `forbidden`, `locked`, `stale_revision`,
  `invalid`, `unavailable`, with field-level validation details when applicable.
- Asset field: `{assetId: string, alt?: string}`. Persist neither signed URLs nor
  storage keys in story content. Delivery resolves stable IDs to content URLs;
  private editor previews require authorization.
- Options endpoint: `{items: [{value: string, label: string}], nextCursor?: string}`.
  Story options use stable story IDs. Selected values are not expanded snapshots.
- Text is one editor family with a format discriminator; changing its format
  must not silently coerce existing content, especially richtext JSON to strings.

## Integration and acceptance gates

1. Foundation: health-checked Docker Postgres, runnable local Workers application,
   persisted local bindings, and authenticated space isolation.
2. Vertical slice: two browser sessions edit Hero and Footer independently; a
   second writer cannot change a leased block. Closing an editor releases/expires
   its lease and stale tokens cannot write.
3. Recovery: interrupt a connection, restart the Durable Object, fail the database,
   and simulate commit-before-broadcast failure. Preserve acknowledged data and
   unsent input; never display Saved before commit. Deduplicate retried mutations.
4. Locale/history: independent structures, fresh IDs on import, sibling-preserving
   block restore, safe structural conflicts, and exact-checkpoint publication while
   the current draft advances. Schema edits must not erase old content.
5. Fields/assets: complete requested field serialization, option source failures,
   cross-space authorization, image/video/PDF upload, retry and finalization
   recovery, video seeking, accessible selection, and archived historical assets.
6. Run typecheck, focused unit/integration tests, two-browser Playwright journeys,
   and the actual Cloudflare build. Cloud provisioning and staging smoke tests
   follow once a reachable database and account-specific capabilities are ready.

Deferred: standalone Docker app deployment, Neon provisioning, offline merging,
customer-site visual preview, plugin marketplace, billing, and history pruning.

## Reference checks

- [Cloudflare Next.js/vinext guidance](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)
- [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [R2 multipart API](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)
- [Better Auth installation](https://better-auth.com/docs/installation)
- [Tiptap JSON persistence](https://tiptap.dev/docs/editor/core-concepts/persistence)

Verified on 2026-11-03:

- Production build and generated-binding TypeScript check pass. Both Workers
  run locally from the built output on port 3130.
- 55 unit/Postgres integration tests pass across 9 files. Seven Playwright
  journeys pass against the production build: R2 transport and browser picker,
  concurrent editors, offline recovery, lost-response/reload deduplication,
  locale imports/restoration, and typed schema/datasource publishing.
- Local setup was rerun successfully without resetting content. The lockfile
  installs with `--frozen-lockfile`; local credentials and runtime state are ignored.
- Docker Compose configuration validates; the local Postgres container is healthy on
  127.0.0.1:55432, running PostgreSQL 18.6. A transactional JSONB round-trip passed.
- Existing Wrangler authentication identifies the selected Gmail account and
  includes `workers:write` and `workers_scripts:write` scopes.
- Read-only Workers, R2, and Hyperdrive API calls succeeded using the selected
  account and its existing credential. No cloud resource was created or deployed;
  resource-specific creation, quotas, and billing eligibility remain untested.
- The cf default login is a different account. Verification supplied the selected
  account and credential to the command process without copying secrets into this
  repository or changing either CLI's stored default login.
