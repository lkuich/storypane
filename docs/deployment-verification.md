# Fresh-install acceptance

Deployment actions remain gated until this checklist is recorded against a fresh
provider project, CMS revision, database and private bucket. Local unit/build
checks do not count as fresh-deployment acceptance. Never test against production
content merely to complete a checklist.

- Sign in with the operator's Clerk instance; create an empty space.
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
- Configure an allowed HTTPS webhook receiver; verify signatures, delivery retries,
  logs and persistent outbox state after restart.
- Restart/redeploy the application; verify content, memberships, publication history,
  assets and pending schedules persist. Re-run migrations and confirm no replay/data
  loss. Check `/api/ready` returns 503 with an unavailable database and 200 after recovery.
- Railway: confirm one replica and sleeping disabled; verify simultaneous WebSocket
  editing while scheduled jobs and uploads run. Cloudflare: confirm realtime deploys
  first, query caching is disabled, and bindings use only this installation's resources.

Record actual results, failures and evidence. Update the website provider status
and deployment skill together only when every required step passes.

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

Fresh Cloudflare/Railway acceptance, signed-in browser editing on the Node runtime,
and the shareable hosted Railway template remain **unverified and gated** at the
owner's request. Website hosting, DNS, repository rename and public access remain
separate. These local results do not enable either provider's deployment action.
