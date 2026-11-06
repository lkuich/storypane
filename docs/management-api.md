# Management API, SDK, CLI, and MCP

Use the management API for server applications, imports, scripts, and CI. It reads
and edits drafts through the same transactions, role checks, validation, history,
and publishing rules as the editor. Public websites should continue using the
[delivery SDK](../packages/sdk/README.md).

## Connect

For schema work, use a [linked development space](development-workflow.md) and
a separate production token for transfers. For content automation, target the
space where that content belongs.

An admin creates a token in **Space settings → API & preview → Management API**.
The secret is shown once; copy it into a server environment or CI secret store.
Use a separate token per integration. Revoking it takes effect on subsequent
operations. Tokens are scoped to one space and remain bound to the issuer's
current membership and content restrictions.

```sh
export STORYPANE_URL=https://cms.example.com
export STORYPANE_SPACE_ID=your-space-id
# Set STORYPANE_MANAGEMENT_TOKEN through your secret store.
storypane stories list --limit 20 --json
```

All requests use `Authorization: Bearer <management-token>`:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $STORYPANE_MANAGEMENT_TOKEN" \
  "$STORYPANE_URL/api/management/v1/spaces/$STORYPANE_SPACE_ID/stories?limit=20"
```

The API does not accept browser cookies as authentication. The URL selects the
space; an `x-storypane-space-id` header cannot override it. Responses are marked
`Cache-Control: no-store`. Use HTTPS outside localhost. The SDK refuses redirects
and paths outside the configured space so credentials stay at the CMS origin.
Never put a management token in a browser bundle, URL, or `NEXT_PUBLIC_*` variable.

| Permission          | Allows                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| `read`              | Read content and ordinary configuration visible to the issuer; required on every token |
| `content:edit`      | Create, edit, move, duplicate, and delete content and folders                          |
| `content:publish`   | Publish, unpublish, and manage content releases                                        |
| `assets:write`      | Upload, organize, change metadata, and archive media                                   |
| `schemas:write`     | Stage schema changes in the active migration                                           |
| `datasources:write` | Create and update datasources                                                          |
| `settings:write`    | Update space, locale, preview, and delivery-token settings                             |
| `admin`             | Member/role administration, webhooks, public media, and migration deployment           |

These permissions intersect the issuer's current role. `admin` is separate from
all other write permissions, so grant those explicitly when needed. Operations
that expose credential metadata can require the corresponding write permission
even for GET. Restricted roles cannot use schema/settings writes to bypass content
restrictions. Management tokens cannot create or revoke management tokens; use
the signed-in admin settings panel.

Existing migration-only tokens still work for migrations, with their original
read/stage/deploy capabilities. They cannot access other management resources.

## Server SDK

The management client is a separate entrypoint in the existing SDK package:

```ts
import { createManagementClient } from '@storypane/sdk/management';

const management = createManagementClient({
  url: process.env.STORYPANE_URL!,
  spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_MANAGEMENT_TOKEN!,
});

const page = await management.stories.list({ limit: 20 });
// Continue with page.nextOffset until it is null.
const locales = await management.stories.locales(page.items[0].id);
const draft = await management.content.get(page.items[0].id, locales.items[0].id);
```

For a Next.js app, put the client in a server-only module (`import 'server-only'`).
Use it from trusted server jobs or properly authenticated route handlers. Do not
expose arbitrary management operations through a public application endpoint.

### Edit a block safely

Read the draft, select a block, and send its current revision along with a stable
mutation ID. For example, after locating a block with a `title` field:

```ts
const saved = await management.content.saveBlock(storyId, localeId, block.id, {
  mutationId: crypto.randomUUID(),
  expectedRevision: block.revision,
  migrationVersion: draft.migrationVersion,
  fields: { ...block.fields, title: 'Updated title' },
});
```

`fields` is the complete editable field map, not a patch. Preserve fields you want
to keep; omitted editable fields are cleared. Fields hidden by a role are
preserved by the server and excluded from returned snapshots. Commands produce
checkpoints and notify connected editors after the commit.

Automation does not need to acquire browser editing leases. It holds the same
locale transaction lock, checks expected revisions, and refuses changes to blocks
with an active human lease (including the token issuer's own editor). Structural
commands also check affected subtrees. A schema-version mismatch returns a conflict.

Persist the mutation ID and exact request body before sending if a job needs
crash-safe retries. Retrying that same command returns its original receipt;
changing the body under the same ID is rejected. The SDK never automatically
retries writes. Other resource writes do not generally provide idempotent receipts:
inspect current state after an ambiguous network failure before retrying.

Publishing is explicit and targets a checkpoint:

```ts
await management.content.publish(storyId, localeId, {
  mutationId: crypto.randomUUID(),
  checkpointId: saved.checkpointId,
});
```

Existing required-field checks, publication access, and reference review still
apply. Where needed, pass `referenceChoices` with the reviewed locale/checkpoint
and `action: 'publish' | 'omit'`. A stale or unreviewed reference is not silently
published.

`GET /stories/:storyId/locales/:localeId/publication-review/:checkpointId` returns
the fixed checkpoint, linked-page choices, and `publishedSnapshot`: the current
live snapshot, or `null` for an unpublished locale. Both snapshots respect the
caller's content access. Compare component values and positions to show changes;
revision numbers alone can change without changing live content.

### Other operations

`management.request<T>(path, { method, body })` exposes the remaining HTTP
operations without a separate SDK method for every CMS action. Paths are relative
to the configured space, such as `/definitions` or `/delivery-settings`.
`requestRaw` returns a `Response` for binary downloads. Errors are
`ManagementError` instances with `status`, `code`, and optional `details`.

```ts
const result = await management.assets.upload(fileBlob, 'cover.jpg', {
  title: 'Cover',
  alt: 'A forest trail',
});
const response = await management.assets.download(result.asset.id);
```

Uploads send bounded parts and complete only when all parts succeed. An interrupted
upload throws an error with `uploadId`; inspect `/assets/uploads/{uploadId}` to
resume through the part endpoints, or DELETE that upload to cancel it. Original
media is not overwritten by a failed upload.

## CLI

Build and link or pack `@storypane/sdk` using the [SDK guide](../packages/sdk/README.md)
until an npm release is available, then run `storypane` (or `pnpm exec storypane`).
`storypane --help` lists the supported resource commands. Management commands
write JSON to stdout; `--json` makes it compact. Failures exit nonzero, and with
`--json` produce an error envelope on stderr. JSON input uses `--input file.json`
or `--input -` for stdin. Tokens are read from the environment, never command flags.

```sh
storypane stories list --offset 0 --limit 20 --json
storypane content get STORY_ID LOCALE_ID --json
storypane content save STORY_ID LOCALE_ID BLOCK_ID --input edit.json
storypane content publish STORY_ID LOCALE_ID --input publication.json --yes
storypane assets upload ./cover.jpg --mime image/jpeg
storypane assets download ASSET_ID --out ./cover.jpg
storypane assets list --cursor NEXT_CURSOR
storypane space get
storypane space update --input settings.json
storypane schemas list
storypane api GET /delivery-settings
storypane api PUT /delivery-settings --input preview.json --yes
```

`edit.json` contains `mutationId`, `expectedRevision`, `fields`, and optionally
`migrationVersion`, as in the SDK example. `publication.json` contains
`mutationId`, `checkpointId`, and optional `referenceChoices`. `content command`
accepts the existing full command contract (insert/move/delete/paste/import/restore,
publish/unpublish, etc.) and requires `--yes`.

Deletes, publishing, arbitrary content commands, and generic API writes require
`--yes`. This does not bypass server review tokens, revision checks, required
confirmations, or permissions. Story deletion still requires its reviewed action
input from `/stories/{id}/review`. `stories update` uses `/stories/{id}/location`
and its location/revision contract. The generic `api` command covers operations
without a dedicated CLI shortcut. Asset uploads require Node.js 22 or later.
Downloads stream into a temporary file; the destination is replaced only on success.

The migration workflow uses the versioned management API. Target your **dev space**
for authoring and local deployment:

```sh
storypane migrations pull
storypane migrations create "Add hero image"
# Edit storypane/migrations/active.json.
storypane migrations push
storypane migrations push --deploy
storypane migrations pull
storypane generate-types --out src/types/storypane.ts
```

Use `read` + `schemas:write` to stage, adding `admin` to deploy. Deployment still
requires a current review and explicit confirmation of data loss. Code generation
uses the latest pulled deployed migration; active schemas are never treated as
public. See the [migration guide](../packages/sdk/README.md#schema-migrations-and-generated-types).
`--json` applies to management resource commands; migration and codegen commands
retain their existing output.

### Linked-space migrations

Keep `STORYPANE_SPACE_ID` and `STORYPANE_MANAGEMENT_TOKEN` pointed at dev. Set
`STORYPANE_PRODUCTION_MANAGEMENT_TOKEN` to a separate token for linked production:

```sh
storypane migrations status
# If status reports behind: true, run the following and review incoming changes.
# storypane migrations sync
storypane migrations pull
# After deploying and testing your dev changes:
storypane migrations promote
```

Promotion includes deployed dev migrations; active drafts stay in dev. Other dev
spaces must explicitly sync after a promotion. Keep production's schema read-only.
See the [team workflow](development-workflow.md) for UI steps, nesting, and clone
boundaries, and the [CLI reference](../packages/sdk/README.md#linked-development-and-production-spaces)
for conflict files and interrupted-transfer retries.

`GET /migrations/environment` reports the space environment, schema protection,
linked production head, pending migrations, and whether a sync is needed.
`POST /migrations/transfer-review` accepts `{ id, action, resolutions? }`, where
`action` is `sync` or `promote` and `id` is a fresh UUID. Its result includes
conflicts, dependencies, per-step impacts, a review token, and any required
confirmation. Resolve conflicts before applying.

`POST /migrations/transfer-apply` accepts the same input plus `reviewToken` and,
when required, `confirmation`. Retain the operation ID and token when retrying a
lost response. A stale review returns 409. Production applies the complete ordered
batch transactionally; source acknowledgement is recoverable from its receipt.

Use the dev space in the URL and its bearer token in `Authorization`. Send the
separate production token in `X-Storypane-Production-Token`; the linked production
space is resolved by the server. Dev requires deployment access; production
requires read access for sync and deployment access for promotion. The SDK's
`createManagementClient` accepts this second credential as `productionToken` and
sends it only on migration requests. Never expose either credential in a browser.

Space responses include `environment`, `schemaReadOnly`, and `productionSpaceId`.
Only admins can update `schemaReadOnly` through `PUT /space`. This protection also
applies to direct migration API/CLI/MCP writes; incoming reviewed transfers use the
separate authorized boundary. Version 2 migration files carry block parents beside
their field schemas; older files remain accepted.

## Content releases

Use production for editorial releases. `GET /releases` returns authorized groups;
`POST /releases` creates an empty group; `PUT /releases/{id}` renames, reschedules
or resumes a group; `DELETE /releases/{id}` cancels it. Create/update inputs are:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "name": "Summer launch",
  "localTime": "2027-06-01T09:00",
  "timezone": "America/Vancouver",
  "dueAt": "2027-06-01T16:00:00.000Z"
}
```

Use a future time and an actual unique request ID. Updates also require the
reviewed `revision`; cancellation requires `{ requestId, revision }`. Releases
report `scheduled`, `held`, `published` or `cancelled`, plus `revision`, `error`,
`canManage` and member metadata. Member responses include approved checkpoint
revisions and `draftChanged`; they never contain raw content snapshots.

Approve a page through `POST /stories/{id}/locales/{localeId}/schedules` with
`requestId`, `checkpointId`, `referenceChoices`, `dueAt`, `timezone`, `localTime`,
`expectedScheduleId` and `expectedRevision` (the last two are null for a page
without an active schedule). Supply `releaseName` to create a release, or
`release: { id, revision }` to join an existing one. For an existing release send
its shared time and timezone. When changing an active membership, also send its
`expectedReleaseRevision`. Linked pages selected for publication become members.

A page locale belongs to at most one active release. Scheduling responses include
`active`, `releaseId`, `releaseName`, `releaseRevision` and `releaseStatus`.
`active` remains true when the release is held; its legacy schedule `status` is
reported as `failed`. Old failed schedules from before this feature have
`active: false` until explicitly resumed. Use `active` to identify membership.

Remove a member with DELETE on its schedule, sending
`{ requestId, revision, releaseRevision }`. To publish immediately, the
`publishCheckpoint` command accepts `expectedScheduleId` and
`expectedScheduleRevision`; send the reviewed membership or two nulls if none.
Publishing removes that page's active membership. Other members stay scheduled.

Whole-release changes require publish access to every member. Reads hide a group
if any page locale is outside the caller's read scope. Stale reviews return 409;
refresh before changing the request. Retry interrupted requests with the same
ID and payload. The SDK's generic `management.request()` exposes these routes;
there is no separate releases CLI command. See [the editor workflow](releases.md).

## HTTP v1 operations

Prefix every path below with `/api/management/v1/spaces/{spaceId}`. JSON writes
use `Content-Type: application/json` and the same validated input contracts as the
editor. The source of these contracts is [`packages/core`](../packages/core/src/index.ts).

| Resource           | Methods / paths                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space              | GET, PUT `/space`                                                                                                                                                                       |
| Stories            | GET, POST `/stories`; GET, DELETE `/stories/{id}`; GET `/{id}/review`; POST `/{id}/duplicate`, `/{id}/restore`; PUT `/{id}/location`; PUT, DELETE `/{id}/pin`; POST `/stories/bulk`     |
| Story locales      | GET, POST `/stories/{id}/locales`; GET `/stories/{id}/locales/{localeId}`                                                                                                               |
| Content commands   | POST `/stories/{id}/locales/{localeId}/commands`                                                                                                                                        |
| History            | GET `/stories/{id}/locales/{localeId}/checkpoints[/{checkpointId}]`                                                                                                                     |
| Content releases   | GET, POST `/releases`; PUT, DELETE `/releases/{id}`                                                                                                                                     |
| Scheduling         | GET, POST `/stories/{id}/locales/{localeId}/schedules`; DELETE `.../schedules/{scheduleId}`                                                                                             |
| Folders            | GET, POST `/folders`; PUT, DELETE `/folders/{id}`                                                                                                                                       |
| Space locales      | GET, POST `/locales`; PUT, DELETE `/locales/{id}`; PUT `/locales/{id}/default`                                                                                                          |
| Definitions        | GET, POST `/definitions`; POST `/definitions/{id}/versions`; PUT `/{id}/parent`; GET `/{id}/references`; DELETE `/definitions/{id}`                                                     |
| Datasources        | GET, POST `/datasources`; PUT `/datasources/{id}`; POST `/options`                                                                                                                      |
| Migrations         | GET, POST `/migrations`; GET `/migrations/{id}/review`; POST `/migrations/{id}/deploy`; GET `/migrations/environment`; POST `/migrations/transfer-review`, `/migrations/transfer-apply` |
| Assets             | GET `/assets`; GET, PATCH, DELETE `/assets/{id}`; GET, HEAD `/assets/{id}/content`; GET `/assets/{id}/usage`; existing asset folder and upload routes                                   |
| Uploads            | POST `/assets/uploads`; GET, DELETE `/assets/uploads/{id}`; PUT `.../parts/{partNumber}` (binary with Content-Length); POST `.../complete`                                              |
| Delivery / preview | GET, PUT `/delivery-settings`; GET, POST `/delivery-tokens`; DELETE `/delivery-tokens/{id}`; GET, PUT `/public-media`                                                                   |
| Roles / members    | GET, POST `/roles`; PUT, DELETE `/roles/{id}`; PUT, DELETE `/members/{userId}`                                                                                                          |
| Invitations        | GET, POST `/invitations`; DELETE `/invitations/{id}`                                                                                                                                    |
| Webhooks           | GET, POST `/webhooks`; PUT, DELETE `/webhooks/{id}`; POST `/{id}/rotate-secret`, `/{id}/test`; GET `/{id}/deliveries`; POST `/{id}/deliveries/{deliveryId}/retry`                       |

Array-valued GET responses use `{ items, total, nextOffset }`; default limit 100,
maximum 1000, offset 0. Object responses are unchanged. Asset lists keep their
native `{ items, nextCursor }`; webhook deliveries and reference/usage lists keep
their existing pagination. Inspect each returned continuation value. Lists are
not a stable snapshot across concurrent changes. Currently array pagination occurs
after the store loads authorized rows, so very large spaces may need SQL paging.

Errors use `{ error: { code, message, details? } }`:

| Status | Meaning / next step                                                         |
| ------ | --------------------------------------------------------------------------- |
| 400    | Invalid input or reused mutation ID with different content; fix the request |
| 401    | Missing, invalid, revoked token or removed issuer; replace credentials      |
| 403    | Token permission or issuer access is insufficient                           |
| 404    | Resource absent or inaccessible                                             |
| 409    | Stale revision, schema, or review; reload and reconcile                     |
| 423    | An editor holds a conflicting lease; retry after it is released             |
| 503    | Service unavailable; inspect state before retrying a non-idempotent write   |

Account-level space creation/cloning, sign-in, management token issuance/revocation, and
interactive browser leases/preview sessions remain in the signed-in CMS. Database
connection credentials are not exposed.

## MCP adapter

`storypane mcp` runs a stdio MCP server using the same management client and API.
The SDK CLI requires Node 20 or later; running the CMS itself requires Node 24.22+
within v24. Configure your MCP client to launch the installed
`storypane` executable with `args: ["mcp"]` and these private environment values:

```json
{
  "mcpServers": {
    "storypane": {
      "command": "storypane",
      "args": ["mcp"],
      "env": {
        "STORYPANE_URL": "http://127.0.0.1:3130",
        "STORYPANE_SPACE_ID": "your-space-id",
        "STORYPANE_MANAGEMENT_TOKEN": "set-through-your-secret-store"
      }
    }
  }
}
```

The server exposes `storypane_read` (GET) and `storypane_write`
(POST/PUT/PATCH/DELETE with a JSON body). Paths are relative to the configured
space, for example `/stories?limit=20`. Use the resource table above for paths and
contracts. Reads return the API JSON, including pagination; API failures return
MCP tool errors with status and code. Credentials never come from tool arguments,
redirects are refused, and paths cannot escape the selected space.

Start with a read-only token. Grant specific write scopes only when needed and
keep MCP client approval enabled for writes, especially publication, deletion and
migration deployment. Content returned by tools is untrusted input. Revocation,
issuer removal and content restrictions apply on every API operation in both
local and Clerk installations. MCP cannot bootstrap accounts or provision
installation databases. Use `storypane assets upload` for binary media.

The adapter uses the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
and writes only protocol messages to stdout. In a source checkout, build the SDK
and use `node /absolute/path/to/packages/sdk/bin/storypane.mjs mcp`.
