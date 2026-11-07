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

## rc.3 release checks — 2026-11-06

Checked source revision `57d539d` with the rc.3 version/documentation changes,
using Node 24.22.0 and pnpm 12.4.2:

- 519 Vitest tests passed, including the local PostgreSQL database suites; 22
  opt-in checks were skipped (dedicated isolation/Railway clusters and live services).
  Release CI supplies the dedicated database clusters before creating artifacts.
- Lint/format, SDK/app/both-example type checks and the Node production build
  passed. The production dependency audit reported no known vulnerabilities.
- The rc.3 packed SDK passed a clean consumer installation, all public entrypoints,
  CLI startup, type declaration presence and license checks.
- Four browser checks passed against the local CMS: page-map expansion/loading,
  locale navigation, unsaved-edit protection, cancellation and personal preview
  defaults/save-error recovery. These include responsive layouts and keyboard access.

The tagged [release CI](https://github.com/lkuich/storypane/actions/runs/42338962456)
passed for `7f23422`, including the dedicated installation/isolation/Railway
PostgreSQL checks, production and Docker builds, and packed SDK verification:
539 tests passed, with only two opt-in live-service tests skipped. The separate
[npm publication run](https://github.com/lkuich/storypane/actions/runs/42339252786)
repeated full CI and published rc.3 through OIDC with provenance.

A clean install from npm loaded all five SDK entrypoints and started the CLI.
The registry package checksum matched the attached GitHub release archive, and
npm provenance attestations were present. The `rc` channel resolves to rc.3;
`latest` remains on rc.2. npm processing delayed availability for a few minutes
after the successful upload.

These checks do not establish a fresh installation or full hosted acceptance.
The outstanding hosted workflows and backup/restore rehearsal listed above remain
unverified for this candidate.

## Authentication provider boundary — 2026-11-06

Checked the working tree based on `e30a7e0` with the shared authentication adapter,
explicit external identity mapping and provider-switching changes:

- 543 Vitest tests passed; six opt-in checks were skipped. Separate disposable
  PostgreSQL 18 clusters exercised ordinary database tests and installation
  isolation/legacy migration. No existing application database was used.
- After the final session-routing and provider-switch changes, 28 focused tests
  passed. Custom-provider coverage checks HTTP delegation, local role authority,
  duplicate-email rejection, explicit identity links, no automatic access grants,
  revoked preview/realtime access, disabled local accounts, migration replay,
  incomplete-mapping rejection and retained mappings after session invalidation.
- SDK/app/both-example type checks, lint and the Node production build passed.
- Five distinct Chrome browser checks passed against a separate disposable local
  production installation: local sign-in/invitation/logout, workspace loading,
  redirect sign-in preserving invitation context, rejection of external sign-in
  paths, and redirect-provider sign-out failure/retry. Keyboard access and
  390/768/1440px layouts passed. The redirect provider was a browser fixture.

Installation migration `003_authentication_providers` permits validated provider
names without changing existing migration history or identity records. It was
applied only to disposable fixtures during these checks. Existing local and
Clerk installations were not migrated or switched.

This verifies the application boundary, not a real Okta or other custom provider's
token exchange, callbacks, session service or upstream revocation. Clerk remote
checks were mocked. Fresh hosted acceptance, backup/restore rehearsal and the
other production reliability gaps remain outstanding.

## Operational recovery rehearsal — 2026-11-06

Checked pushed CMS revision `cdab8c5` using the published Railway template in a
new disposable project, `storypane-operational-acceptance`
(`02ea3bf6-9f2b-41d9-8d19-6f4b8db4ace1`). It provisioned PostgreSQL, a private
bucket and the Node application with one replica and sleeping disabled. The
installation used local authentication, two isolated spaces and sample content;
no existing user installation or production content was changed.

- Fresh setup, administrator sign-in, deployed schema, manual invitation and a
  separate editor account passed. The existing browser regression passed two
  editors saving separate blocks, conflicting locks, checkpoint publication with
  later drafts, and offline/reconnect recovery with preserved unsent input.
- The private multipart regression passed size validation, owner-only upload
  state, resume, repeated completion, byte-identical originals, HEAD/ranges and
  archive retention. An upload interrupted across a real app restart resumed
  from its stored first part and completed byte-identically.
- Hosted HTTP and real WebSocket snapshots omitted restricted fields. Removing
  content access disconnected the editor socket; removing the originating
  editor's access disconnected its authenticated preview socket.
- The hosted minute scheduler published both approved page revisions in a
  scheduled release after restart. Later edits stayed in the drafts. This checks
  that restart scenario, not the complete release failure/concurrency matrix.
- Disabling connections to one space database produced degraded readiness while
  the other space remained usable. Restoring it recovered access. Disabling the
  installation database returned 503; recovery returned 200 and preserved the
  existing session.
- With the disposable application stopped, a coordinated logical backup captured
  the installation database, both space databases, the provider's empty default
  database, database roles, private originals, configuration and encryption keys.
  Backup took 33 seconds. The three originals totalled 21,462,739 bytes.
- Restoration into separate local PostgreSQL 18 and S3-compatible storage took
  8 seconds for data restoration and comparison. Every public table's row count
  and canonical row hash matched the source, as did database role flags/password
  hashes and every original's SHA-256. The first comparison incorrectly depended
  on database collation; consistent row ordering resolved it without changing data.
- The restored installation decrypted the original registry connections and
  updated their endpoints through `Installation.updateConnection`. Transactional
  migrations reran successfully. Sign-in with both original passwords, both
  spaces, approved publications/later drafts, private original downloads, WebP
  thumbnails and the existing delivery/management tokens passed. Authenticated
  preview worked; a foreign preview origin was rejected. A held foreign lease
  appeared in scoped HTTP/WebSocket snapshots without its token.

The restored target was local, not a second hosted failover installation. These
small-fixture timings are not production recovery objectives. No fixture writes
occurred between stopping the source and backup; no loss was observed in the
captured records or originals. Pending release execution was checked across app
restart before backup; pending jobs/outbox recovery from backup was not exercised.
Private dumps, manifests and assertion scripts are retained locally under ignored
`artifacts/operational-confidence/`; credentials and session states are not public
evidence. The temporary hosted project and restore containers were removed after
verification.

For repeatable collaboration/media checks, see the
[hosted browser test instructions](../README.md#checks-and-contributions). The provider build
[CI run](https://github.com/lkuich/storypane/actions/runs/42344373632) passed for
`cdab8c5`; this hosted rehearsal supplements that run.

Full acceptance remains open: signed hosted webhook delivery/retries/outbox
recovery, real SMTP and upstream identity-provider revocation, the remaining
schema/CLI/preview/release matrix, pending-job restore, a fresh hosted restore,
independent security review and representative production load benchmarks.
Keep the single-replica constraint until shared room transport is implemented and
verified. This record supersedes the matching outstanding items in earlier dated
records; it does not declare the release production-ready.

## Webhook process recovery regressions — 2026-11-06

Checked the working tree based on `44953b6` with a fresh Node production build,
a disposable local PostgreSQL 18 installation and a temporary public HTTPS tunnel.
The new repeatable suite is `tests/webhooks.recovery.ts`, run through
`playwright.operational.config.ts`; it creates fresh credentials and cleans up its
own processes/container without using an existing installation.

- The full Playwright regression passed in 2.3 minutes. It configured the webhook
  through signed-in settings, independently verified HMAC at the receiver, returned
  503 and waited for the real backoff/minute scheduler across a forced process
  restart. The event ID and exact payload remained stable; the retry had a fresh
  timestamp/signature and both HTTP results appeared in delivery history.
- A publication with later draft edits was accepted by the receiver before the
  sender was force-killed. After claim expiry, restart recovery redelivered the
  same event and completed its interrupted attempt history. Receiver deduplication
  produced one effect, and token-authorized delivery contained only the approved
  publication. Later drafts remained unpublished; credentials did not appear in
  the payload.
- Settings passed 390/768/1440px overflow checks and keyboard opening/dismissal of
  delivery logs. Both existing webhook component browser tests also passed.
- Eight new Vitest cases cover dispatcher failures across spaces/ticks, invalid
  Retry-After values, recovery with the original encryption key and an exhausted
  claim at the front of a queue. All 68 focused tests across five files passed
  against a separate disposable database; type checks, lint and production build
  passed.
- The queue regression first failed: an exhausted interrupted claim returned the
  same signal as an empty queue, stopping the batch before other due work. The
  dispatcher now continues within its existing batch limit after marking that
  delivery failed. No public contracts, retry limits or stored keys changed.

Initial browser runs exposed test setup/selector errors and intermittent tunnel
connectivity. The corrected fixture waits for committed setup requests and tunnel
registration, bounds network waits and prefers IPv4 on this test host. Production
DNS/private-address validation, HTTPS and signature checks remain enabled. Traces
are disabled to avoid capturing the one-time signing secret.

See [the repeatable commands and prerequisites](webhooks.md#real-https-and-process-crash-regression).
This verifies a local production Node build through public HTTPS. It does not
complete Railway webhook acceptance, receiver database disaster recovery or
production load testing. The broader acceptance checklist remains open.

## Repeatable operational regressions

The checks from the operational rehearsal now live in
`tests/operational.recovery.ts`, alongside `tests/webhooks.recovery.ts`. They cover
recipient-filtered HTTP/WebSocket snapshots with a real foreign lease, editor and
preview revocation, a two-page scheduled release and multipart upload across a
forced process exit, database outages, and a coordinated backup/restore with a
pending signed outbox delivery. The restore target is separate local PostgreSQL
and S3-compatible storage, even when the source is Railway.

Run the full local suite with Node 24.22+, Docker, Google Chrome, `cloudflared` and
outbound HTTPS available:

```sh
pnpm build
pnpm exec vitest run tests/recovery-data.test.ts
pnpm exec playwright test --config playwright.operational.config.ts
```

For a fresh Railway source, authenticate the Railway CLI and choose the billing
workspace explicitly:

```sh
STORYPANE_RAILWAY_TEST_WORKSPACE_ID=<workspace-id> \
  node --import tsx scripts/test-railway.ts
```

The runner deploys the published `storypane` template, which builds `main`, creates
fresh administrator credentials, a database TCP proxy and a temporary SSH key,
then runs the same suite. It changes the webhook allowlist only on that generated
project and removes its project and SSH key afterwards. Railway charges apply.
It never uses the CLI's linked project. The crash check requires the published
image's single Node process as PID 1, and verifies that process start time changes.

The suite uses real minute ticks and retry delays; allow several minutes. It
stops the generated source during backup, captures all databases/roles, originals
and runtime keys, compares every public table and original before endpoint
rewrites, reruns transactional migrations and tests the restored application.
The test enqueues one owned test delivery through the existing database service
after stopping the source, so it remains pending in the backup. The restore also
exercises the preserved token hashes and webhook encryption key.
Unit tests check the row comparison against collation/property-order differences,
lost/duplicated/changed rows, nested content order and scalar types. They also
reject unrelated projects and invalid target origins before destructive testing.

Private dumps, keys, logs and manifests stay under ignored
`artifacts/operational-runs/` with restricted permissions. Do not publish that
directory. Test media uses an isolated 256 MiB temporary filesystem; fixtures
remove only their own containers. Traces remain disabled for signing secrets.
These small-fixture checks do not establish production recovery times, a second
hosted restore, production load limits or the complete acceptance checklist above.
