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

Clerk external IDs preserve imported local user IDs, memberships, and history. Linking is an explicit operator action; the server never links accounts by matching email. Unverified emails cannot access the CMS. The local demo editor remains disabled until explicitly migrated.

The monorepo includes a working Astro website. With the CMS running, use
`STORYPANE_SESSION_TOKEN=<current Clerk session JWT> pnpm example:setup` then `pnpm dev:example`, and open **http://127.0.0.1:3132/home**.
Setup creates a separate Fieldwork example space with published Default/French
content and an unpublished page. See [the Astro example guide](apps/example-astro/README.md)
for static builds, visual preview, and schema-to-TypeScript generation.

For the same site in Next.js, run `pnpm example:setup:next` followed by
`pnpm dev:example:next`, then open **http://127.0.0.1:3133/home**. Setup adds
**Local Next.js** as an optional application in Storypane's preview selector and
preserves the Astro default. Both examples share their renderer and generated
types. See [the Next.js example guide](apps/example-next/README.md).
Run `pnpm lint:example` to lint the Astro and shared React source.

Postgres listens only on `127.0.0.1:55432`, using database/user/password `blok`.
Optional settings are in `.env.example`; copy it to `.env` when changing defaults.
Keep `DATABASE_URL` consistent with the Compose settings. `pnpm db:setup` applies database migrations. Local R2/room state persists
under `.cloudflare/state`; database content persists in `blok_postgres_data`.
Stop the database with `docker compose stop`. Removing its volume erases content.

Storypane was previously named Blok. Workspace packages now use `@storypane/*`,
and the SDK command is `storypane`. Prefer `STORYPANE_*` environment variables
(`PUBLIC_STORYPANE_*` for browser flags); existing `BLOK_*` settings still work.
The local database, fixture accounts, Docker project/volume, Cloudflare resource
names, preview protocol, and browser storage keys retain their original identifiers
so the rename preserves content, assets, sessions, and unsent edits.

## What works

- Content search combines publication status, modification date, last modifier, and
  content type, with date/name sorting and removable filter chips. Filters stay in
  the URL when opening a story or refreshing. Date ranges use the browser's local time.
- Personal page pins are saved per user. Matching pinned stories appear first in
  Content; pinning never changes content, publication status, or another user's list.
- Content folders support nesting, translated slug prefixes (using configured locale
  IDs), allowed/default content types, and form-only editing. Blank folder translations
  fall back to the default segment. Use a page's location button to move it or edit
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
  custom space-specific roles. Configure editing, publishing, assets, block schemas,
  datasources, and settings independently. All members can read space content.
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
  independent page. Admins can add/rename locales and remove unused ones.
  Renaming retains content/history; Default and locales with content cannot be removed.
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

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router UI/API, authentication, Cloudflare entrypoint |
| `apps/realtime` | Durable Object rooms and WebSockets |
| `apps/example-astro` | Static example website, generated block props, live preview |
| `apps/example-next` | Next.js version of Fieldwork, sharing Astro's renderer and schema |
| `packages/core` | Content contracts and validation |
| `packages/db` | Postgres migrations, transactions, history, publishing |
| `packages/assets` | Asset metadata and R2 upload/delivery service |
| `packages/ui` | Shared controls |
| `packages/sdk` | Published delivery, browser preview bridge, React hook, schema/type CLI |

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
pnpm test
pnpm typecheck
pnpm build
# With pnpm dev running and Google Chrome installed:
pnpm test:e2e
```

Unit/integration tests use isolated schemas in the local `blok_test` database.
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

## Cloudflare deployment target

Selected account: **loren.jk3@gmail.com**,
`c813587edc389800e834e0c261a91ef5`. Its existing authentication and read access to
Workers, R2, and Hyperdrive were verified. Resource creation and remote deployment
have not been tested. The machine's default `cf` login belongs to another account;
use credentials for this account explicitly and keep them outside the repository.

`pnpm build` emits both Workers and static assets under
`apps/web/.cloudflare/output`. Before deployment, provision a reachable Postgres
database (Neon is the intended target), apply auth/content migrations, provision
accounts, and configure:

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

Rebuild with deployment settings before deploying the generated output using
`cf` from `apps/web`. Deployed Workers cannot connect to this machine's localhost.
Cloud resource creation, Neon setup, and staging verification are the next
deployment step, not part of the local bootstrap.

See [the SDK integration guide](packages/sdk/README.md) for static Next.js/Astro
pages, preview authentication, client rendering requirements, and SDK limitations.
Draft JSON remains in Postgres; Durable Objects stream its committed checkpoints.

Design review is pending. Complete Docker app packaging, invitations/member
management, offline merging, public media delivery, asset garbage collection,
and history retention are deferred. Full
snapshots per autosave favor recovery simplicity; storage will grow until a
retention policy is added. Published JSON is currently available to signed-in
space members through the CMS API and to applications with scoped delivery tokens.

See [the implementation work breakdown](docs/work-breakdown.md) for ownership,
contracts, and acceptance criteria.

See [the internal issue tracker](docs/issues/README.md) for researched feature TODOs,
proposed behavior, implementation scope, and acceptance tests.
