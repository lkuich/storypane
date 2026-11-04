# 002 — Durable outbound webhooks

Status: IN PROGRESS — implemented; release verification pending

Source: comparison gap 2  
Related: [lifecycle](001-story-lifecycle.md), [scheduling](003-scheduled-publishing.md),
[media](004-production-media.md), [permissions](008-scoped-permissions.md)

## Problem and starting implementation

Published content can change without notifying a generated site to rebuild or
invalidate its cache. The existing CMS-to-Durable-Object notification updates
editors; it is not a durable outbound integration mechanism.

[StorypaneStore](../../packages/db/src/store.ts) already owns transactional
publication and schema deployment. [The worker](../../apps/web/src/worker.ts)
currently exports only fetch; there is no scheduled delivery runner or outbox.
[External options](../../packages/db/src/external-options.ts) provide an existing
public-host validation policy to reuse, but their JSON-fetch function is not a
webhook transport.

## Proposed behavior

Admins configure endpoints in Settings → Webhooks: name, HTTPS URL, subscribed
events, enabled state, and signing secret. Show the generated secret once, allow
rotation, and show recent deliveries with status, time, HTTP result, and a safe
error summary. Include Send test and Retry failed delivery actions using the same
durable dispatcher as real events.

Initial events:

| Event             | When it is recorded                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| story.saved       | A committed draft change, including structural edits and restoration; exclude publication bookkeeping checkpoints |
| story.published   | A locale's current publication changes, manually, in bulk, or on schedule                                         |
| story.unpublished | A live locale is unpublished, including as part of story deletion                                                 |
| story.deleted     | The whole story is soft-deleted                                                                                   |
| story.moved       | A story's draft location/path changes; include old/new paths and make clear publication did not change            |
| asset.updated     | Editor changes asset metadata/focal point that can affect rendered output                                         |
| schema.deployed   | A schema migration commits; signals a rebuild even when it changed existing live publications                     |

Draft events are opt-in; the normal rebuild subscription uses publication,
unpublication, deletion, asset updates, and schema deployment. Emit one schema
deployment event with migration version, rather than thousands of synthetic
publish events. Receipt replays and no-op draft/metadata saves must not emit
duplicate logical events. An explicit republish with a new request ID creates a
new publication and event, preserving the existing reviewed-publication contract.

Payload version 1 contains event ID/type/time, space ID, actor ID when applicable,
and relevant story/locale/checkpoint/publication IDs, revision and path information.
Use stable IDs for locale identity, with the locale slug as descriptive metadata.
Do not include draft content, asset bytes, session data, or credentials. Capture
the payload at commit time; later edits must not change a queued event.

## Durability and delivery contract

- Add endpoint configuration, immutable event/outbox rows, and per-endpoint
  delivery/attempt rows. Insert events and eligible deliveries in the same Postgres
  transaction as the content change. Unique event/delivery keys make retries safe.
- Start with a once-per-minute scheduled worker that drains bounded batches.
  Share only its cron entry point with 003; each feature keeps its own DB routine.
  A request-time wakeup may improve latency but cannot be the durability mechanism.
- Claim deliveries using row locks with SKIP LOCKED and a persisted claim token /
  expiry. Commit the claim before HTTP I/O. Only the current claim may record a
  result; expired claims become retryable after a crash. Do not hold a database
  transaction open while contacting an endpoint.
- Delivery is at least once and not globally ordered. A response lost after the
  receiver accepted the event can produce a duplicate with the same event ID.
  Document deduplication and recommend fetching current content for rebuilds.
- Send POST JSON. Any 2xx is success; redirects are failures and are never followed.
  Retry network errors, timeouts, 408, 429, and 5xx. Use five total attempts with
  retry delays of 1, 5, 15, and 60 minutes; a valid Retry-After may extend the delay
  up to 24 hours. Other 4xx are terminal. Failed deliveries remain visible and
  manually retryable with the same event ID.
- Bound requests to a 10-second timeout and response reads to 16 KiB. Retain status
  and sanitized error summaries, not arbitrary response bodies. Keep delivery logs
  for 30 days; cleanup must not remove pending work or events it still references.
- Disable/delete stops new attempts. URL, subscription, or secret changes cancel
  queued deliveries for the old endpoint revision; manual redelivery explicitly
  targets the current configuration. Recheck revision immediately before sending.
  An HTTP request already in flight cannot be recalled.

## Security and authorization

- Configuration, test, retry, logs, and secret rotation are admin-only in v1.
- Sign exact body bytes with HMAC-SHA256 over timestamp + '.' + body. Send a
  documented versioned signature header, timestamp header, and stable event-ID
  header. Receivers verify the signature and reject stale timestamps; each retry
  gets a fresh timestamp/signature. Use platform crypto, not a signing dependency.
- Store secrets encrypted with a Worker-bound encryption key, never as plaintext
  API responses or logs. Hash-only storage cannot support signing. Missing key
  configuration must disable configuration/sending rather than bypass signing.
- Require operator-approved exact public HTTPS hostnames in a separate
  WEBHOOK_HOSTS configuration. Reject credentials, non-443 ports, IP literals,
  local/reserved names, and private/reserved DNS results on every attempt; reject
  redirects. Reuse the existing address validator. The allowlist is part of the
  trust boundary: DNS preflight alone does not prevent DNS rebinding, so arbitrary
  tenant-controlled hosts require a stronger outbound transport before adoption.
- Disable pending work when its endpoint/space no longer exists. Keep internal
  dispatch inaccessible from an unauthenticated production HTTP route.

## Implementation reach

- Core payload/config validation and event types; DB migration/registration and
  store hooks in checkpoint changes, publication, lifecycle, asset metadata, and
  schema deployment. Asset writes currently use their own service transactions;
  include outbox recording inside those transactions as well.
- New webhook CMS routes and settings panel using existing UI controls.
- Worker scheduled handler, Cloudflare cron configuration, WEBHOOK_HOSTS and
  encryption-key binding; update generated types, env examples, setup/deployment
  instructions, and local scheduled-handler testing guidance.
- DB tests for atomic events/claims; transport tests with mocked HTTP/DNS/clock;
  signature verifier example; one browser journey for configure/test/failure/retry.
- Existing CMS and scheduled publication must call the same event-recording path.
  Do not introduce Cloudflare Workflows or a separate message broker for this slice.

## Acceptance tests

- [x] Failed/rolled-back mutations produce no deliveries; committed mutations
      survive a worker restart and emit one logical event per transition.
- [x] Concurrent dispatchers, expired claims, lost responses, and retry exhaustion
      preserve at-least-once delivery with a stable ID and bounded attempts.
- [x] Manual, bulk, scheduled, and schema-driven live-content changes trigger the
      documented events; normal draft autosave never triggers a publish event.
- [x] Signature verification passes for exact bytes and fails for tampered/replayed
      requests; no secrets appear in configuration reads, payloads, errors, or logs.
- [x] Private DNS, disallowed hosts, redirects, oversized responses, and stalled
      endpoints are rejected without blocking content mutations.
- [x] Disable/configuration changes fence queued claims; admin and space isolation
      are enforced on every configuration/log/retry endpoint.
- [x] A sample static site receives a publish event and rebuilds using a server-held
      delivery token. Local cron invocation is documented and verified.

## Implementation and verification

Implemented migration016, strict event/configuration schemas, transaction recorder,
encrypted secrets, signed bounded transport, persisted claims and retries, revision
fencing, retention, admin routes/settings/logs/test/retry, the shared minute handler,
operator bindings, and a durable static-site receiver example. See
[webhook operations](../webhooks.md) for setup and the delivery contract.

Validated locally: 54 targeted unit/Postgres tests and two browser component journeys
covering configuration, one-time secrets, test failure, and retry. The signed publish
integration exercises the receiver example and reads published content using its
server-held token. No real external webhook endpoint was contacted.

The merged Worker was invoked twice through the real Cloudflare Vite v2 local cron
endpoint on an isolated disposable database/schema. Both invocations returned
`{"outcome":"ok","noRetry":false}`. A due schedule published the selected checkpoint,
set the locale's publication pointer, emitted exactly one `story.published` event,
and created one delivery attempt. An empty runtime host allowlist rejected that
attempt before DNS/HTTP. The second invocation left all counts unchanged. The
fixture, local secret, database, and dev server were removed afterward.

Integrated verification passes: the 311-test suite includes manual, bulk,
scheduled, lifecycle, and asset event paths; full typechecking, production build,
and lint pass. The combined browser harness passes five role/webhook journeys.

Remaining release checks:

- [ ] Run the signed-in Clerk admin/API journey with private test sessions.
- [ ] Verify deployed delivery and a real external HTTPS receiver rebuild.

No authenticated browser state was configured in this environment. Keep this
issue open until these release checks are recorded.

## References

[Storyblok webhooks](https://www.storyblok.com/docs/concepts/webhooks) provide event
notifications and logs. The retry policy above is a Storypane decision, not a
claim of identical Storyblok behavior.

[Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
invoke a scheduled handler; local development requires explicit test invocation.
Verify the installed cf/Vite configuration syntax when implementing.
