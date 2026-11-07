# Outbound webhooks

Admins can configure up to 20 destinations in **Settings → Webhooks**. Create an
endpoint, copy its signing secret into the receiving service, and use **Send test**.
Test delivery runs through the same durable queue as content events. **Delivery
logs** show attempts and safe failure summaries; **Retry delivery** explicitly
resends a failed or cancelled event with the current destination configuration.
Secrets appear only when created or rotated. Configuration reads never return them.

[Content releases](releases.md) publish their approved pages and enqueue each
page's `story.published` event in one transaction. A failed release attempt emits
none of those events. Delivery is still separate per page with independent
retries; coalesce build requests for multi-page launches. There is no separate
release webhook event.

## Production and development spaces

For the [recommended team workflow](development-workflow.md), configure live-site
rebuild webhooks in **production**. Use separate endpoints for dev/test builds and
validate the expected `spaceId` in each receiver. Cloning a space does not copy
webhook destinations or signing secrets; configure them separately when needed.

A schema promoted into production emits `schema.deployed` there. Deploying or
syncing a dev schema affects that dev space's events. Keep generated frontend
types aligned with the destination space before rebuilding the live site.

## Operator setup

Run `pnpm admin migrate` before starting a new Node release; migration
`016_webhooks` adds the endpoint, event, delivery, and attempt tables. The Node
application starts independent publication and webhook schedulers immediately at
startup and every 60 seconds. Publication notifies changed editor rooms; webhook
delivery drains up to 25 deliveries per space. Each job skips its own overlapping
runs, so slow receivers cannot delay publication. Failures are logged and
persisted work is retried on the next tick.

Set `WEBHOOK_HOSTS` to a comma-separated list of exact, operator-approved public
HTTPS hostnames in the build/deployment environment. Wildcards are unsupported.
Destinations must use port 443, without credentials, IP literals, or URL fragments.
Every attempt checks DNS addresses and rejects private/reserved results and
redirects. Approve hosts controlled by trusted operators: preflight DNS checks
alone do not prevent DNS rebinding through a malicious hostname owner.

Generate a 32-byte encryption key with `openssl rand -base64 32`. Store the value as
the server-side `WEBHOOK_ENCRYPTION_KEY` in ignored `.env.production` or your
deployment secret manager. Never prefix it with `VITE_`. Keep a protected backup:
losing/changing this encryption key makes existing endpoint secrets unreadable.
Rotate individual endpoint signing secrets through Settings; this is different
from replacing the master encryption key. Missing or malformed encryption
configuration disables creation/sending. Cleanup still runs.

Keep runtime secrets in the Node process environment and never commit them.
The scheduler starts with the application; no separate cron service or public
HTTP trigger is required. See the [self-hosting guide](self-hosting.md).

## Events and delivery

Default rebuild subscriptions are `story.published`, `story.unpublished`,
`story.deleted`, `asset.updated`, and `schema.deployed`. Draft `story.saved` and
`story.moved` notifications are optional. `webhook.test` targets the selected endpoint
without changing its subscription. Schema deployment produces one migration event,
rather than synthetic publication events for each rewritten publication.

Events and eligible deliveries are inserted inside the same transaction as the
content change. A rollback cannot leave an outbound event. Each event records
immutable JSON bytes, captured at commit time, with identifiers and paths only:

```json
{
  "version": 1,
  "id": "11111111-1111-4111-8111-111111111111",
  "type": "story.published",
  "occurredAt": "2026-11-04T12:00:00.000Z",
  "spaceId": "22222222-2222-4222-8222-222222222222",
  "actorId": "user_123",
  "data": {
    "storyId": "33333333-3333-4333-8333-333333333333",
    "localeId": "44444444-4444-4444-8444-444444444444",
    "locale": "en",
    "checkpointId": "55555555-5555-4555-8555-555555555555",
    "publicationId": "66666666-6666-4666-8666-666666666666",
    "revision": 8,
    "path": "news/launch"
  }
}
```

Other data fields are `oldPath` for movement, `migrationVersion` for deployment,
and `assetId`/`metadataRevision` for asset updates. Actor identity is optional for
service-originated events. Payloads exclude content, asset bytes, sessions, tokens,
and secrets. Draft path movement leaves the existing publication unchanged.

Delivery is **at least once, with no global ordering guarantee**. Persist event IDs
for deduplication and fetch current published content when rebuilding. A receiver
can accept an event whose response is lost; that retry keeps the same event ID.
Manual retry also keeps that ID. Each attempt has a new timestamp/signature.

Any 2xx succeeds. Network errors, timeouts, HTTP 408/429/5xx retry at 1, 5, 15, and
60 minutes, for five total attempts. A valid Retry-After can extend a delay to at
most 24 hours. Other failures are terminal. Each request (including DNS and response
reads) has a 10-second deadline and a 16 KiB response limit. Response bodies are
not stored. A worker claims work for 60 seconds; expired claims are recoverable,
and obsolete claims cannot overwrite a newer result.

Changing endpoint settings or rotating its secret cancels work queued for the old
revision. Disabling/deleting stops new attempts; an already-started HTTP request
cannot be recalled. Logs remain for 30 days after completion. Pending work and its
event payload remain until processed. Manual retries start a new five-attempt cycle
and preserve the complete attempt history during retention.

## Verify signatures and build a static site

The POST sends `Webhook-Id`, `Webhook-Timestamp` (Unix seconds), and
`Webhook-Signature` (`v1=` followed by a lowercase hex HMAC-SHA256). Sign the exact
UTF-8 body bytes over `timestamp + '.' + body`; do not parse/re-serialize first.
Reject timestamps more than five minutes from your current time. The exported
`verifyWebhookSignature(secret, timestamp, body, signature)` helper uses Web Crypto
verification and performs this timestamp check.

The executable [receiver example](../scripts/webhook-rebuild.ts) verifies those
headers and expected space, durably deduplicates/queues events in SQLite before
returning HTTP 202, and runs a fixed `pnpm build` command in a configured site.
It resumes pending builds after restart and retries failed builds independently of
webhook delivery. Run one process per queue database behind a public HTTPS reverse
proxy to its loopback port. Keep the SQLite database on persistent storage.

Configure the receiver's process environment with:

- `WEBHOOK_SIGNING_SECRET`: the endpoint secret shown once in Settings.
- `STORYPANE_SPACE_ID`: the intended space UUID.
- `STORYPANE_DELIVERY_TOKEN`: a server-held published delivery token read by the site
  during its build; never expose it in browser bundles.
- `SITE_DIRECTORY`: absolute path to the static site's directory, with a `build`
  script. The site also needs its usual Storypane URL and schema setup.
- `WEBHOOK_BUILD_DATABASE`: absolute path to its persistent SQLite database.
- `WEBHOOK_BUILD_PORT`: optional loopback port, default 3138.

Start it with `pnpm exec tsx scripts/webhook-rebuild.ts`. Configure the CMS endpoint
as `https://<approved-receiver-host>/webhook`. Build commands and directories come
only from operator configuration; event payloads cannot select commands. Publishing
then queues a build that reads current content with the receiver's own token.
`webhook.test` verifies connectivity without running a build. Successful jobs are
retained for deduplication for 30 days. Deploying build output remains the site's
existing build/deployment responsibility.

## Verification

```sh
pnpm exec vitest run \
  packages/db/src/webhook-transport.test.ts \
  packages/db/src/webhooks.test.ts \
  packages/db/src/webhook-integration-review.test.ts \
  apps/web/src/lib/background.test.ts tests/webhook-rebuild.test.ts
pnpm exec playwright test --config playwright.webhooks.config.ts
```

The Vitest database tests use isolated schemas in disposable local test databases;
their HTTP and DNS destinations are controlled test doubles. The sample receiver
is exercised by a signed publication event and builds from token-authorized delivery content.
The browser harness covers admin controls without requiring a Clerk sign-in;
Postgres tests independently verify session, role, and space enforcement. The
actual local scheduled endpoint was invoked twice against an isolated schema: a
due checkpoint published once, produced one immutable event and delivery attempt,
and the second invocation produced no duplicates. The empty runtime allowlist
blocked that test destination before any external DNS/HTTP. These earlier checks do not establish
deployed webhook delivery. The signed-in process-recovery regression below covers
the local Node installation separately.

### Real HTTPS and process-crash regression

With Node 24.22+, Docker, Google Chrome and `cloudflared` installed, run:

```sh
pnpm build
pnpm exec playwright test --config playwright.operational.config.ts
```

This separate Playwright suite creates and removes its own PostgreSQL container,
local-auth installation and temporary public HTTPS tunnel to a local test receiver.
It uses fresh credentials, random loopback ports and sample content; it does not
attach to your configured installation. No object storage is used in this test.
The receiver hostname is explicitly allowlisted; the production DNS, HTTPS,
signature and private-address checks remain enabled. The test prefers IPv4 for
tunnel connectivity and ignores saved tunnel configuration.

The browser configures a webhook and reads its secret once. The receiver verifies
HMAC independently. The test waits for the real 503 retry delay, force-kills the
Node process and checks recovery of the same event and exact payload with a fresh
signature. It also publishes an approved checkpoint with later drafts, kills the
sender after receiver acceptance, and checks expired-claim recovery, delivery logs
and receiver deduplication. It exercises responsive settings and keyboard access.
Traces are disabled so the one-time secret is not captured.

Allow several minutes and outbound access to the temporary tunnel service. This
network-dependent suite is separate from the default browser suite and CI's Vitest
checks. It tests a local production Node build through public HTTPS; it does not
establish Railway webhook acceptance or production load limits.

The [2026-11-06 verification record](deployment-verification.md#webhook-process-recovery-regressions--2026-11-06)
records a passing run, the dispatcher queue fix, focused unit/database coverage
and the remaining acceptance limits.
