# Fresh-install acceptance

Complete this checklist before declaring a deployment production-ready. Record
the provider project, CMS revision, database, and private bucket. The public
Railway release-candidate template has the scoped hosted checks recorded below;
it is available for evaluation while broader acceptance remains outstanding.
Local unit/build checks do not count as fresh-deployment acceptance. Never test
against production content merely to complete a checklist.

- Start fresh Docker with no Clerk keys or SMTP. Bootstrap through the hidden CLI
  prompt, sign in, create/attach two databases, accept an invitation, sign out,
  recover an account and verify old sessions are rejected.
- Separately verify explicit Clerk mode, preserved identity IDs, provider switches
  requiring operator migration, revoked sessions and disabled accounts.
- Verify each space role is denied CONNECT to the other databases. Exercise
  wrong-space CMS/delivery/management requests, media and preview routing, and
  independent migrations, unavailable spaces and interrupted provisioning retries.
- Create protected production and two linked dev spaces. Check both block-library
  parents and nested-block restrictions survive cloning, while bulk content/media,
  members, tokens and webhooks do not. Review the schema-default dependencies.
- Deploy in one dev, review/promote against production content, and confirm direct
  production schema writes remain blocked. Verify drafts stay unpublished, the
  second dev reports behind, and sync handles conflicting fields and parent moves.
  Exercise the CLI with separate dev/production credentials and an interrupted
  transfer retry; verify production-generated frontend types and environment switching.
- Rehearse the legacy split and pre-write rollback with multiple spaces, histories,
  draft/published content, permissions, tokens, schedules and media references.
  Run both example sites with the migrated URLs and tokens.
- Invite a second editor; create a scoped viewer. Verify HTTP and live snapshots
  omit restricted content, session revocation expires access, and lease tokens
  never reach another editor.
- Open two browsers on the same page; edit separate blocks concurrently, observe
  presence/autosave, reject conflicting locks, disconnect/reconnect and recover
  committed state without losing preserved unsent input.
- Open a configured preview; verify authenticated live changes, referenced content,
  origin binding and revoked/expired preview sessions.
- Upload multiple files, pause/resume multipart upload, complete after restart,
  fetch original/ranged/HEAD responses, and verify image variants and focal crops.
  Confirm private and unpublished media cannot be read anonymously. Opt into public
  media and verify only currently published assets are exposed.
- Publish a reviewed checkpoint while later edits remain drafts. Schedule another
  checkpoint, wait for a minute tick, and verify permissions are rechecked.
- Create a release with two pages and nested content, edit later drafts, and verify
  only approved versions go live together. Test an explicitly selected linked page,
  stale reviews, moving a member, publishing one page now, cancellation, timezone
  transitions, lost-response retries and concurrent scheduler instances. Revoke
  one approver's access or change the schema: the whole release must remain
  unpublished and held until reviewed and resumed. Verify scoped users cannot
  inspect hidden release members. Upgrade old pending/failed/completed schedules
  without losing checkpoints, publication history or shared-database split data.
- Configure an allowed HTTPS webhook receiver; verify signatures, delivery retries,
  logs and persistent outbox state after restart.
- Restart/redeploy the application; verify content, memberships, publication history,
  assets and pending schedules persist. Re-run migrations and confirm no replay/data
  loss. Check `/api/ready` returns 503 with an unavailable installation database and 200
  after recovery; an unavailable space reports degraded health while healthy spaces
  and their background jobs continue.
- Railway: confirm one replica and sleeping disabled; verify simultaneous WebSocket
  editing while scheduled jobs and uploads run. Cloudflare is the static marketing
  website host only; the CMS Worker runtime is unsupported by this layout.

Record actual results, failures, and evidence. Update the website provider status
and deployment skill together, distinguishing scoped checks from full acceptance.
Only claim full acceptance when every required step passes.

## Local verification — 2026-11-05

Checked the working tree based on `08de902cf21358ff68542cff4c2445acae3843c4`.
Concurrent schema and management API work was preserved.

- 417 Vitest tests across 50 files passed using a disposable Postgres container;
  the opt-in S3 integration test used a disposable local MinIO container.
- Full `pnpm typecheck` passed, including SDK and both example applications.
- Cloudflare production build, Node production build and Docker build passed.
- The container served the sign-in page without browser errors. `/api/ready`
  returned 200, then 503 while its database was stopped, then 200 after restart;
  all 24 migration records remained. Anonymous editor/preview WebSocket upgrades
  and foreign-origin editor upgrades were rejected.
- Deployment command exercised in an isolated temporary checkout with a fake CLI:
  configuration-only checks made no changes, reconnects preserved encryption keys,
  migrations preceded builds, and realtime preceded web. No cloud command ran.
- Customization recipe exercised in an isolated source clone: signed publication
  invoked the existing build receiver exactly once; unsigned requests failed.
- Both downloadable skills passed the skill validator and their archives matched
  source. The Astro site built all four pages and passed local link/asset checks,
  360/390/768/1440px overflow checks, keyboard navigation, primary color contrast,
  reduced motion, clipboard success/failure handling and browser-error checks.

Fresh Railway acceptance, signed-in browser editing on the Node runtime, and the
shareable hosted Railway template remain **unverified and gated** at the owner's
request. Cloudflare CMS deployment is unsupported; Cloudflare Workers Static Assets hosts only the
static website. Website hosting, DNS, repository rename and public access remain
separate. These local results do not enable a Railway deployment action.

## Installation layout verification — 2026-11-05

The earlier shared-database/Cloudflare results above do not verify this layout.
For the Node installation/space split in this working tree:

- 442 Vitest tests passed (54 files); the opt-in S3 test was skipped in that run
  and passed separately against disposable MinIO. The suite included real
  PostgreSQL isolation, local authentication, invitation replay, revocation,
  interrupted provisioning, separate migrations and legacy split/rollback tests.
- TypeScript, ESLint and formatting checks passed. The SDK, Node production build,
  Astro and Next example builds passed. Both examples also built/served against a
  migrated multi-space fixture, preserving published content while excluding later drafts.
- A disposable Docker installation with no Clerk keys or SMTP passed CLI bootstrap,
  browser sign-in, manual invitation/new-account acceptance, non-admin provisioning
  rejection, logout, replay denial, and keyboard/responsive checks at 390/768/1440px.
  CLI recovery invalidated the old password and existing session.
- The management API, CLI and stdio MCP adapter passed live read/write, scope,
  wrong-space and revocation checks against the disposable local-auth installation.
  MCP protocol tests also rejected escaped paths without sending credentials.
- The existing local Clerk installation was restored at `http://127.0.0.1:3130`:
  four spaces, three identities, 260 stories and 424 asset records were copied.
  All copied table values/counts, references and histories validated before switching.
  442 private objects (2,085,151,826 bytes) were copied and SHA-256 verified.
  Source database, original media, configuration and keys were retained privately.
- Existing Clerk identity validation, management API/CLI/MCP reads and revocation,
  both examples' unchanged delivery tokens, published original media, and an
  authenticated preview WebSocket worked against the restored installation.
  Node development mode starts the same collaboration and background services as
  production; anonymous preview upgrades were rejected in both modes.

This is not full production acceptance: live SMTP delivery, a fresh Railway
installation, the complete two-editor browser workflow and real Clerk account/session
revocation still need the checklist above. Clerk revocation has automated coverage;
no real user account was disabled to test it. Cloudflare CMS deployment remains
unsupported; Cloudflare Workers Static Assets website hosting is a separate static-site setup.

## Content release verification — 2026-11-06

- The full Vitest run passed 503 tests, including real PostgreSQL installation
  isolation and legacy splits both before and after migration 027. The optional
  S3 integration and live management-session suites were skipped in that run.
- Focused lifecycle checks cover approved nested snapshots, linked references,
  concurrent runners, transaction rollback, stale reviews, permission changes,
  held-release recovery, cancellation history and content-scope-safe retries.
- An isolated local-auth installation passed the release browser flow against the
  Node production build: scheduling two pages, later draft editing, updating
  approval, moving a member, publishing it immediately and cancelling the group.
  Light/dark layouts passed at 360/768/1440px; dialog focus, Tab and Escape passed.
- Type checks, lint, and the SDK/Node production build passed. The release guide
  includes an actual UI capture using disposable sample content.

These results verify releases locally. They do not replace the fresh provider
acceptance checklist above or verify a new Railway installation.

## RC package and local checks — 2026-11-06

Checked the `0.1.0-rc.1` source candidate with Node 24.22.0 and pnpm 12.4.2.
These are local release checks, not fresh hosted-install acceptance:

- 503 Vitest tests passed; two opt-in live-service tests were skipped (S3 transport
  and live management API/CLI/MCP). A dedicated disposable PostgreSQL cluster
  exercised authentication, invitation/recovery, database isolation, and legacy split.
- Lint/format, SDK/app/both-example type checks, Node production build and Docker
  image build passed. The packed SDK installed outside the monorepo and loaded
  every public entrypoint; its CLI, type declarations, and license were checked.
- The production dependency audit reported no known advisories after Vite/fflate
  patch updates. The development-only minimatch advisory is recorded in the
  [release guide](releases-and-versioning.md#dependency-review-for-rc1).
- Website production build and all 13 checks passed, including documentation links,
  metadata, responsive/keyboard access, copy failures, and reduced-motion behavior.

Fresh hosted acceptance, authenticated end-to-end browser acceptance for this
candidate, backup-restore rehearsal, an independent security audit and production
load benchmarks remain outstanding. The provider deployment gates remain closed.

### rc.2 clean-fixture correction

The rc.1 GitHub release gate rejected three legacy suites that still required
`blok_test`. Their guards/default URLs now match the documented `POSTGRES_DB`
and `storypane_test` setup while retaining the localhost/test-database restriction.
All 74 affected lifecycle/webhook tests passed against a new disposable cluster
with no existing databases. The rc.2 packed SDK consumer check and lint passed.
No rc.1 package was published; the failed tag remains in history. GitHub release
CI must pass before publishing rc.2. This does not change hosted acceptance status.

## Railway template checks — 2026-11-06

Checked CMS revision `ab0da7a` with the real Storypane template `storypane` in a new
Railway project, `storypane-template-acceptance`. The template builds `main`, not
a pinned release. These checks establish a working RC deployment path; they do
**not** complete the full production acceptance checklist above.

- The actual template provisioned the application, PostgreSQL, and a new private
  Railway bucket. Independent generated secrets and service references resolved;
  the pre-deploy runner created the isolated installation database and first
  administrator. `/api/ready` returned 200. No Clerk keys or SMTP were configured.
- Browser acceptance passed local sign-in, creation of two spaces, manual
  invitation and new-account acceptance, non-admin provisioning rejection,
  sign-out, and invitation replay denial. Keyboard login and 390/768/1440px checks
  passed without browser errors. A first attempt hit the local five-second
  cold-page assertion timeout; the rerun used a 30-second hosted-page timeout.
- HTTP acceptance on the new deployment passed original upload to its private
  bucket, byte-identical download, HEAD, byte ranges, and a WebP thumbnail.
  Anonymous access to the private asset was rejected.
- Protected production and two linked dev spaces passed cloning of block-library
  parents and nested-block restrictions without copying story content. A dev
  migration deployed and promoted to production; direct production schema writes
  were denied. The other dev reported behind and synced successfully.
- Removing all three bootstrap administrator inputs and redeploying completed
  successfully. The existing administrator session, spaces, promoted schemas,
  story content, and original media remained intact. One app replica and sleeping
  disabled are the template defaults.
- Five focused PostgreSQL tests cover fresh setup, dedicated database/role checks,
  refusal of shared databases, interrupted and concurrent bootstrap retries,
  preserved passwords/sessions/migrations, and rejection of changed credentials.
  CI runs these against its own fresh PostgreSQL service. Type checks, lint, and
  the Node/SDK production build passed for the setup change.

Still outstanding **on this Railway deployment**: the complete two-editor/reconnect
workflow, preview and content-scope matrix, conflict resolution and dual CLI
credentials, scheduled releases and webhooks, account recovery/provider switching,
interrupted multipart resume, database outage recovery, and backup/restore rehearsal.
Existing local coverage for several of these is recorded above; it does not count
as hosted acceptance. Independent security review and production load benchmarks
also remain outstanding. Cloudflare edge image optimization was not provisioned;
origin image transformations were checked.
