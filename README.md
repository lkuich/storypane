# Storypane

A collaborative headless CMS: independent locale pages, automatic saving, exclusive
block editing, versioned publishing, and a media library adapted from UGC Scout.

This first build runs the application, Durable Objects, and R2 in Cloudflare's
local Workers runtime, with **Postgres 18 in Docker**. Clerk development credentials are required for authentication.

## Run locally

Requires Docker, Node **24.22+ within v24**, and pnpm **12.4.2**.

```sh
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:setup
pnpm dev
```

Configure the selected Clerk application from `apps/web` with `pnpm dlx clerk@latest env pull --instance dev --file .dev.vars` (authenticate the CLI in your terminal first). Keep credentials out of git. Open **http://127.0.0.1:3130**, sign in, and create or open a space. Existing content and memberships survive `db:setup`.

Authentication uses Clerk's React SDK with server verification at the Worker boundary (vinext is detected as React). HTTP requests validate both the JWT and active Clerk session. WebSocket authorization grants expire within 60 seconds and refresh while the editor is open; revocation therefore reaches existing sockets within 60 seconds. Old Better Auth cookies and demo passwords are no longer accepted. Legacy auth tables remain for rollback; rollback requires restoring the previous release and its configuration, and signing in again.

Concurrent requests for the same Clerk session share their in-flight identity lookup; results are not cached across completed requests. Transient sign-in throttling returns a retryable service error. The block library retries its full read (including datasources) on focus and its five-second refresh, clearing recovered read errors while retaining failed action errors.

Clerk external IDs preserve imported local user IDs, memberships, and history. Linking is an explicit operator action; the server never links accounts by matching email. Unverified emails cannot access the CMS. The local demo editor remains disabled until explicitly migrated.

The monorepo includes a working Astro website. With the CMS running, use
`STORYPANE_SESSION_TOKEN=<current Clerk session JWT> pnpm example:setup` then `pnpm dev:example`, and open **http://127.0.0.1:3132/home**.
Setup creates a separate Fieldwork example space with published Default/French
content and an unpublished page. See [the Astro example guide](apps/example-astro/README.md)
for static builds, visual preview, and schema-to-TypeScript generation.

For the same site in Next.js, run `pnpm example:setup:next` followed by
`pnpm dev:example:next`, then open **http://127.0.0.1:3133/home**. Setup adds
**Local Next.js** as an optional application in Storypane's preview selector and
preserves the Astro default. The Next.js example has its own server client, typed
block components, schema snapshot, and preview route. See [the Next.js integration guide](apps/example-next/README.md).
Run `pnpm lint:example` to lint and check formatting in both examples.

By default, Postgres listens only on `127.0.0.1:55432`, using database/user/password `storypane`.
Optional settings are in `.env.example`; copy it to `.env` when changing defaults.
Keep `DATABASE_URL` consistent with the Compose settings. `pnpm db:setup` applies database migrations. Local R2/room state persists
under `.cloudflare/state`; database content persists in `storypane_postgres_data`.
Stop the database with `docker compose stop`. Removing its volume erases content.

Use `STORYPANE_*` environment variables (`PUBLIC_STORYPANE_*` for Astro browser
flags) and the `storypane` CLI. Rebuild preview applications with the current SDK
when updating the CMS; preview messages and editable attributes use Storypane names.
Database setup preserves migration history, and the browser migrates saved drafts
and theme preferences automatically.

For an existing installation, keep its resource identifiers in the ignored root
`.env`: `COMPOSE_PROJECT_NAME`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`DATABASE_URL`, `TEST_DATABASE_URL`, `R2_BUCKET`, `STORYPANE_WEB_WORKER_NAME`, and
`STORYPANE_REALTIME_WORKER_NAME`. Changing defaults does not rename existing
Docker volumes, databases, buckets, or Durable Object namespaces.

## What works

- Content search combines publication status, modification date, last modifier, and
  content type, with date/name sorting and removable filter chips. Filters stay in
  the URL when opening a story or refreshing. Date ranges use the browser's local time.
- Personal page pins are saved per user. Matching pinned stories appear first in
  Content; pinning never changes content, publication status, or another user's list.
- Content folders support nesting, translated slug prefixes (using configured locale
  IDs), allowed/default content types, and form-only editing. Blank folder translations
  fall back to the default segment. The story list and search stay in the current
  folder; Back/Forward retrace folder visits, and changing folders clears selection.
  Use a page's location button to move it or edit
  its per-locale slug. Folder moves and URL changes create draft checkpoints; existing
  published URLs remain live until each affected locale is republished. Static sites
  still need a rebuild after publication. No automatic redirects are created.
- Active editor avatars appear in Content, page-reference search results, and the
  page editor. Hover for names and locales. Indicators follow active block leases,
  not merely open tabs; they refresh every 10 seconds and on local lock changes.
  Clerk profile photos fall back to initials when unavailable. Expired sessions,
  removed members, and users who lose editing permission are excluded.
  Pages are not exclusively locked: different blocks and locales can be edited
  concurrently. An abandoned block lock expires after 45 seconds.

- Central Spaces screen with search, creation, story/member counts, and per-space
  settings. New spaces start empty and their creator becomes an administrator.
- Settings → Roles includes fixed Admin, Editor, and read-only Viewer roles, plus
  custom space-specific roles. Scope reading, editing, and publishing by folder subtree
  or story, locale, block type, and field. Configure assets, schemas, datasources,
  and settings independently. Hidden fields are omitted from HTTP and live snapshots;
  partial editors use the form view, and saves preserve protected fields.
  Only Admins manage roles and memberships; built-in roles cannot be modified.
  Assigned roles cannot be deleted until members are reassigned and invitations revoked.
  Permissions are checked from Postgres on each operation, including lease renewal
  and publishing. Existing Admin/Editor memberships keep their access.
- Settings → Members lets admins invite by email, assign roles, remove
  members, and revoke pending invitations. Share the workspace link manually; no
  email is sent. Invitations last 7 days and grant access on the next authenticated
  request using the matching Clerk-verified primary email. Existing roles are never
  overwritten by an invitation. The last admin cannot be removed or demoted.
  Removing a member preserves content/history and releases their editing locks.
- Space, story, and locale selection stays in the page URL, so refresh and shared
  links reopen the same content. API calls, live editing, uploads, and asset previews
  all use the selected space. Locale changes retain the current form while loading
  the destination and keep application preview open.
- Content selection supports reviewed bulk publish/unpublish/move/delete, draft-only
  duplication, and soft-delete recovery. History is preserved; live references and
  editing leases are checked before destructive actions. Bulk review groups locales
  under expandable stories, keeps actions visible while scrolling, and separates
  completed stories from failures with editor links. Re-review targets only failed
  stories; interrupted requests retain their original request IDs for safe retries.
- Publish review asks whether to publish each linked draft or story with unpublished changes too or omit
  its reference from the live copy. Omission preserves drafts and cannot bypass required
  fields. Selected revisions publish together atomically, including scheduled and bulk
  publication. Unchanged live references keep their published versions. Changed links
  require a choice, use the preview locale (with Default fallback), and check the
  reviewed publication before replacing it so another editor's publication is not overwritten.
- Schedule a reviewed locale checkpoint with an explicit timezone. Later edits remain
  drafts; a minute cron checks current permissions, schema, and URL conflicts before
  publication. Pending/failed schedules appear in the list and editor.
- Admin-managed [signed webhooks](docs/webhooks.md) use a transactional outbox,
  bounded retries, delivery logs, and an allowlist of HTTPS destinations.
- Admins can opt a space into public media URLs for current published assets.
  Images support bounded variants and focal points; asset details list draft/live
  usage filtered by the viewer's content permissions. Public media defaults off.
- Delivery SDK with Postgres-backed published reads, read-only live draft preview,
  configurable preview triggers, and React/Next.js/Astro integration recipes.
- Working Astro example with a typed React block registry, published static pages,
  unpublished-story preview shell, and `storypane:pull` / `storypane:types` / `storypane:generate` commands.
- Application iframe preview and click-to-edit block selection. Configure named preview
  URLs and a default in **Settings → API & preview**, then switch apps in the preview panel.
  URLs support `{slug}` and `{locale}`. Existing single URLs are migrated to a default entry.
  This settings area also manages published and server preview tokens. Server-side
  `createPreviewSession({ slug, previewId })` can select a configured URL; omitting
  `previewId` uses the default. Sessions are bound to the selected app's origin.
- Story editing uses a compact navigation rail (hover, focus, or tap to expand; pin
  to keep it open). Preview opens by default and shares two columns with the fields. Use the block breadcrumb
  to return to a parent, its field menus to switch siblings, or **Outline** for the
  full tree. Add and reorder blocks in their parent fields or the outline drawer.
- Versioned JSON schemas with Nestable, Content type, and Universal blocks.
  Edit definitions in a tall drawer with Fields / Config tabs, a searchable icon
  picker, draggable fields, and a fixed save footer (⌘ / Ctrl S).
- Text, textarea, richtext, markdown, number, date/time, boolean, single/multiple
  options, assets, links, and nested blocks.
- Inline choices, managed KV datasources, other-story references, and external
  JSON sources. External sources require an exact public HTTPS hostname in
  `EXTERNAL_OPTION_HOSTS` and return `{ "items": [{ "value": "key", "label": "Label" }] }`.
- Independent locale structures. Default uses `""` as its locale slug; importing
  from Default makes one-time subtree copies with fresh IDs.
- **Space settings → Locales** manages shared locale names and URL prefixes.
  Configured locales appear on every story; opening a new locale creates its
  independent page. Removing a locale lists affected stories with links to their locale
  editors and requires explicit confirmation to delete its content and history.
  Deletion checks content permissions and active editors, rejects stale reviews,
  removes publications, and cancels schedules. Other locales remain intact.
  Renaming retains content/history; Default cannot be removed.
- Block leases, autosave, live updates, conflict detection, and preserved unsent
  input when disconnected. Continued editing requires a connection.
- Page/block restoration into new history and publication of a fixed reviewed
  checkpoint. Subsequent edits stay in the draft.
- Multi-file drops anywhere in the asset library, with a floating upload queue
  that continues across workspace navigation and supports pause/resume.
- Resumable R2 uploads, folders, metadata, asset selection, and archive.
  Archiving preserves referenced files and their bytes. Image previews use
  resized WebP thumbnails; downloading an original preserves its bytes.

## Storage and workspace

Postgres is authoritative for draft JSONB, schemas, leases, immutable checkpoints,
and publications. Each block has its own revision. Brief locale transactions
produce a consistent history without rejecting unrelated block edits. Durable
Objects deliver presence and committed updates; they do not hold the only copy
of a draft. This avoids a second draft database and a cross-database publish step.

| Path                 | Responsibility                                                          |
| -------------------- | ----------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router UI/API, authentication, Cloudflare entrypoint        |
| `apps/realtime`      | Durable Object rooms and WebSockets                                     |
| `apps/example-astro` | Static example website, generated block props, live preview             |
| `apps/example-next`  | Self-contained Next.js integration with Server Components and preview   |
| `packages/core`      | Content contracts and validation                                        |
| `packages/db`        | Postgres migrations, transactions, history, publishing                  |
| `packages/assets`    | Asset metadata and R2 upload/delivery service                           |
| `packages/ui`        | Shared controls                                                         |
| `packages/sdk`       | Published delivery, browser preview bridge, React hook, schema/type CLI |

Schema edits accumulate in one shared active migration per space. Review the diff
in **Blocks → Schema migrations**, then deploy as an admin. Deployment migrates
existing drafts and live publications separately without publishing unfinished
content. Renames preserve data; removed fields and incompatible types delete/reset
active values. Reviews link directly to affected story blocks. Any data loss needs
typed confirmation. **Preview destructive deployment** also removes disallowed
nested blocks (including descendants), keeps the earliest allowed blocks up to
new limits, and resets invalid values to defaults or clears them. It still blocks
on missing required content or invalid schemas; it does not unpublish pages.
Draft and published issues are reviewed separately. Fix a published issue by
publishing the corrected draft, adjusting the schema, or reviewing the destructive
option. History remains
readable; restoring it applies intervening migrations. Database upgrade `013`
retains legacy content until an admin deploys the initial migration.
Run `pnpm db:setup` to apply upgrade `014`, which records destructive deployments.

Select a block to include its ID in the editor URL, then copy the URL to share it.
Links use `/?space=<id>&story=<id>&locale=<slug>&block=<id>` (omit `locale` for
Default). A deleted or published-only block shows a notice when absent from the draft.

Use **Copy block** in a block's toolbar (or its list-row copy icon), then
**Paste block** in a destination block list. Copies include nested blocks and
visible unsaved field values; pasting creates independent block IDs, including
across pages and locales in the same space. Asset and story references keep their
existing targets. Pasting follows the destination's schema, limits and editing
locks, and does not publish content. Copy again after a schema migration. If the
browser blocks clipboard access, the editor provides manual copy/paste fields.

The SDK CLI supports `migrations pull`, `migrations create "description"`,
`migrations push`, and `migrations push --deploy --yes` for CI/CD. Generate types
from the latest deployed migration with `generate-types --out src/types/storypane.ts`.
Admin-issued management tokens are available in the migration panel. See the
[SDK migration guide](packages/sdk/README.md#schema-migrations-and-generated-types)
for credentials, files, conflicts, and pipeline usage. Outdated SDK consumers
continue receiving content with advisory version warnings.
Block Config supports comma-separated tags. Blocks fields can restrict nesting by
specific blocks or by any matching tag, with searchable selectors. Empty selections
allow all nestable/universal blocks. Tags are versioned with schemas; imports and new content use deployed tags.
Generated SDK types also use deployed tags.

Locale settings are shared by a space; the locale prefix (`fr-CA`) is separate
from each story's page slug (`home`). Existing story locales are registered by
migration `004_space_locales` without replacing content or history. Changing a
locale prefix changes delivery lookups and preview URLs immediately; rebuild
static sites and update links to the old prefix. Redirects are not generated.

The app uses **vinext**, Cloudflare's beta implementation of Next.js APIs on Vite.
The Cloudflare plugin is pinned to `2.0.0-beta.v.9`; beta.v.11 currently requests an
unpublished build-output-utils dependency. WebSocket upgrades enter through the
Worker directly because framework HTTP response cloning cannot preserve them.

## Verify

Appearance follows the system by default. Use the header's **Appearance** selector
to choose System, Light, or Dark; the choice is saved in this browser and shared
across tabs. Preview apps keep their own styling.

```sh
pnpm db:test
pnpm lint
pnpm test
pnpm typecheck
pnpm build
# With pnpm dev running and Google Chrome installed:
pnpm test:e2e
```

Unit/integration tests use isolated schemas in the local `storypane_test` database.
Browser tests require Clerk-authenticated admin/editor storage states via `STORYPANE_TEST_ADMIN_STATE` and `STORYPANE_TEST_EDITOR_STATE`. They create test content in the app. Never commit storage states.
If `apps/example-astro/.env` exists, run `pnpm build:example` before the browser
suite; Playwright starts its built preview server on port 3132. Without that
configuration the Astro-specific test is skipped.
They exercise two editors, locks, offline recovery, locales, history, publishing,
schema fields, datasources, real local R2 uploads/downloads, space switching,
settings persistence, administrator access boundaries, and live preview of an
app served as static HTML on a separate origin, plus the real Astro island,
unpublished preview shell, and generated schema contracts. `pnpm types`
regenerates binding declarations; typecheck also runs it automatically.

`pnpm lint` checks source across every app, package, script, and test, then checks
formatting with Prettier. `pnpm lint:fix` applies automatic lint fixes and formats
the repository; `pnpm format` only formats. Each workspace also has a `lint`
script for checking that app or package. Generated types, schema snapshots,
lockfiles, and build outputs are excluded from formatting; generated types remain
covered by type checking.

The root installs TypeScript 7's compiler as `@typescript/native` and the compatible
TypeScript 6 JavaScript API as `typescript` for ESLint. Keep both aliases when
updating dependencies so linting and the `tsc` command continue to work together.

## Cloudflare deployment target

The CMS is deployed at **https://storypane.dev** in account
`c813587edc389800e834e0c261a91ef5`. Production builds select `storypane-web`,
`storypane-realtime`, and the custom domain; development keeps the local overrides.
The machine's default `cf` login belongs to another account. Use a profile or
`CLOUDFLARE_API_TOKEN` for the deployment account and keep credentials outside git.

Production resources provisioned on 2026-11-04:

- Neon project `delicate-fog-38250737` (`storypane`), main branch, database
  `storypane`, AWS Oregon, fixed 0.25 CU. Migrations 001–020 are applied.
- Hyperdrive `dba85d3dab20441c9d23c8e813b6c27b`, with query caching disabled.
- Private R2 bucket `storypane-assets` and an Images binding.
- `storypane-realtime` owns the SQLite-backed `StoryRoom` Durable Objects.
- `storypane-web` serves the domain and runs the minute publishing/webhook cron.

The initial deployment uses the existing Clerk development instance by explicit
choice. Clerk requires new accounts to complete organization selection before
their sessions become active. Use production Clerk keys before a production launch.

`pnpm build` emits both Workers and static assets under
`apps/web/.cloudflare/output`. Deployment bindings and optional overrides are:

- `HYPERDRIVE_ID`: a real Hyperdrive configuration with **query caching disabled**,
  so session, permission, and content reads remain current. The zero ID in local
  config is only a development placeholder.
- `R2_BUCKET`: the private asset bucket name.
- `IMAGES`: the configured [Cloudflare Images binding](https://developers.cloudflare.com/images/optimization/binding/)
  transforms private R2 images into 160/320/640/1280px WebP previews. The Worker
  authorizes each request before reading its internal edge cache; browser-facing
  responses remain private. Local development uses Cloudflare's image simulator.
  Images over the binding's 20 MiB input limit retain original downloads but
  show a preview-unavailable state. Production Images access must be enabled.
- `STORYPANE_APP_URL`: the deployed HTTPS origin, matching cookie/origin validation.
- `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`: Clerk keys for the target instance; the secret stays on the Worker.
- `EXTERNAL_OPTION_HOSTS`: approved option-source hostnames, if used.
- `WEBHOOK_ENCRYPTION_KEY`: configured as a Worker secret. Preserve it across
  deployments; existing endpoint secrets depend on it.
- `WEBHOOK_HOSTS`: approved receiver hostnames. It starts empty; configure it
  before adding outbound endpoints. See [the webhook guide](docs/webhooks.md).

Rebuild and deploy the realtime Worker before the web Worker:

```sh
pnpm build
pnpm --filter @storypane/web exec cf deploy --prebuilt --mode production --worker storypane-realtime
pnpm --filter @storypane/web exec cf deploy --prebuilt --mode production --worker storypane-web --secrets-file "$HOME/.config/storypane/production-secrets.json"
```

The private JSON secrets file contains the two Clerk keys and webhook encryption
key; it is stored outside the repository with owner-only permissions. For later
deployments that do not change secrets, omit `--secrets-file` to retain them.
Use `--dry-run` to inspect either deployment before uploading. Apply future database
migrations with the exported `@storypane/db/migrate` runner against Neon before
deploying code that requires them; `db:setup` is deliberately local-only.
Production starts with a new database; local development content was not copied.

See [the SDK integration guide](packages/sdk/README.md) for static Next.js/Astro
pages, preview authentication, client rendering requirements, and SDK limitations.
Draft JSON remains in Postgres; Durable Objects stream its committed checkpoints.

Design review is pending. Complete Docker app packaging, offline merging, asset garbage collection,
and history retention are deferred. Full
snapshots per autosave favor recovery simplicity; storage will grow until a
retention policy is added. CMS reads follow each member’s content scopes. Published and server-preview delivery
tokens remain space-wide service credentials; scoped readers cannot mint them.
Public content and opted-in public media are unaffected by private CMS read scopes.

See [the implementation work breakdown](docs/work-breakdown.md) for ownership,
contracts, and acceptance criteria.

See [the internal issue tracker](docs/issues/README.md) for researched feature TODOs,
proposed behavior, implementation scope, and acceptance tests.

Rich text preserves text colors and inline images imported from other CMSs. Inline
images carry a space-scoped asset ID and an HTTP(S) source; publication validates
asset ownership and includes them in media usage. External links also accept
`tel:` URLs for telephone CTAs.

External option feeds accept both `{items: [{value, label}]}` and existing
`[{value, name}]` arrays. Both formats retain the same host allowlist, DNS, size,
and uniqueness checks.
