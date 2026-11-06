# Storypane

A collaborative headless CMS: independent locale pages, automatic saving, exclusive
block editing, versioned publishing, and a media library adapted from UGC Scout.

This release runs on **Node/Docker** with built-in email/password
sign-in and a PostgreSQL database per space. One installation database owns
identities, sessions and encrypted connections. Clerk is an optional explicit
installation provider; no Clerk keys or SMTP server are needed for local auth.

## Start here

For a fresh installation, see the [getting started guide](docs/getting-started.md).
The maintained guides are also published at [storypane.dev/docs](https://storypane.dev/docs).
For local source development, the guide lists the setup and commands. This release
runs on Node **24.22+ within v24** and pnpm **12.4.2**. Follow the [Node installation guide](docs/self-hosting.md) to configure secrets, start the private
Postgres/object store services and create the first administrator through the CLI.
There are no default accounts or public bootstrap endpoint. For source development,
configure runtime settings in `.env`, migrate/bootstrap with the operator CLI, then
run `pnpm dev`.

Existing shared-database installations need the documented maintenance-window
[legacy split and rollback](docs/self-hosting.md#legacy-migration-and-rollback).
Cloudflare Workers Static Assets hosts the static marketing site. The current CMS runtime is Node;
existing Worker installs require an explicit data and resource migration plan.
See [Cloudflare status](docs/deploy-cloudflare.md).

The monorepo includes a working Astro website. With the CMS running, use
`STORYPANE_SESSION_COOKIE=<private session cookie> pnpm example:setup` then `pnpm dev:example`, and open **http://127.0.0.1:3132/home**.
Setup creates a separate Fieldwork example space with published Default/French
content and an unpublished page. See [the Astro example guide](apps/example-astro/README.md)
for static builds, visual preview, and schema-to-TypeScript generation.

For the same site in Next.js, run `pnpm example:setup:next` followed by
`pnpm dev:example:next`, then open **http://127.0.0.1:3133/home**. Setup adds
**Local Next.js** as an optional application in Storypane's preview selector and
preserves the Astro default. The Next.js example has its own server client, typed
block components, schema snapshot, and preview route. See [the Next.js integration guide](apps/example-next/README.md).
Run `pnpm lint:example` to lint and check formatting in both examples.

The legacy `compose.yaml`/`db:setup` commands remain local fixture tools for the
shared schema. New installations use `compose.node.yaml` and `pnpm admin migrate`.
Keep all existing database/media volumes and encryption keys when upgrading.

Use `STORYPANE_*` environment variables (`PUBLIC_STORYPANE_*` for Astro browser
flags) and the `storypane` CLI. Rebuild preview applications with the current SDK
when updating the CMS; preview messages and editable attributes use Storypane names.
Database setup preserves migration history, and the browser migrates saved drafts
and theme preferences automatically.

For an existing Node installation, retain its database URLs, Docker volumes,
private object storage, and encryption/authentication keys when upgrading. Do not
reuse the legacy Cloudflare Worker deployment settings for this runtime. See the
[Cloudflare guide](docs/deploy-cloudflare.md) before retiring an older Worker
installation; confirm its data and media have been migrated or backed up first.

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
  members, and revoke pending invitations. Share the single-use invitation link
  manually, or configure SMTP for email delivery. Invitations expire in 7 days.
  Existing accounts must sign in before accepting; new local accounts stay unverified. Existing roles are never
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
  External JSON fields support up to 20 custom request headers (8 KB total). Headers are
  sent by the CMS server; values are part of the versioned block schema and visible to
  schema readers. They are not a secret store and are excluded from delivery schemas/content.
  Editor requests automatically include `X-Storypane-Space-Id`, `X-Storypane-Story-Id`,
  `X-Storypane-Story-Slug`, `X-Storypane-Locale-Id`, `X-Storypane-Locale`,
  `X-Storypane-Block-Id`, `X-Storypane-Block-Type`, and `X-Storypane-Field`.
  Story slug is the selected locale's URL slug; Locale is its URL prefix (empty for root).
  Decode percent-encoded slug/prefix values at the endpoint. Context is checked against
  the requesting user's access and saved field configuration; custom headers cannot
  override context or transport headers. Requests never forward the editor's session
  credentials or follow redirects.
- Independent locale structures. Importing from the configured default locale
  makes one-time subtree copies with fresh IDs.
- **Space settings → Locales** manages shared locale names and URL prefixes.
  Set any locale as the default without changing URL prefixes or copying content.
  New stories and delivery requests that omit `locale` use that default; explicit
  `locale: ''` selects the root locale. The former default, including root, can be
  deleted once every affected story has another locale. The current default cannot be deleted.
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
| `apps/web`           | vinext UI/API, local and Clerk authentication, Node entrypoint          |
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


Select a block to include its ID in the editor URL, then copy the URL to share it.
Links use `/?space=<id>&story=<id>&locale=<slug>&block=<id>` (omit `locale` for
Default). A deleted or published-only block shows a notice when absent from the draft.

Use **Copy block** in a block's toolbar (or its list-row copy icon), then
**Paste block** to append to a destination block list, or **Paste here** above a
block to insert at that position. Paste actions appear when a valid copied block
matches the destination's space, schema and allowed types, and the list has room.
Copies include nested blocks and
visible unsaved field values; pasting creates independent block IDs, including
across pages and locales in the same space. Asset and story references keep their
existing targets. Pasting follows the destination's schema, limits and editing
locks, and does not publish content. Copy again after a schema migration. If the
browser blocks clipboard access, the editor provides manual copy/paste fields.

The SDK CLI supports `migrations pull`, `migrations create "description"`,
`migrations push`, and `migrations push --deploy --yes` for CI/CD. Generate types
from the latest deployed migration with `generate-types --out src/types/storypane.ts`.
Admin-issued migration tokens are available in the migration panel. General management
API tokens are available in Space settings → API & preview. The versioned HTTP API,
`@storypane/sdk/management`, resource CLI commands, and the `storypane mcp` stdio
adapter cover drafts, assets, and space configuration; see the [management API guide](docs/management-api.md). See the
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
Browser tests require authenticated admin/editor storage states via `STORYPANE_TEST_ADMIN_STATE` and `STORYPANE_TEST_EDITOR_STATE`. They create test content in the app. Never commit storage states.
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

## Self-hosting

Use the [Node/Docker setup](docs/self-hosting.md). Railway is documented but
remains unverified for a fresh hosted installation. Cloudflare hosts the static
marketing website, not the current CMS runtime. Complete the [verification checklist](docs/deployment-verification.md)
before rollout. Production configuration stays in ignored `.env.production`.

See [the SDK integration guide](packages/sdk/README.md) for static Next.js/Astro
pages, preview authentication, client rendering requirements, and SDK limitations.
Draft JSON remains in each space database; collaboration rooms stream committed checkpoints.

Design review is pending. Offline merging, asset garbage collection,
and history retention are deferred. Full
snapshots per autosave favor recovery simplicity; storage will grow until a
retention policy is added. CMS reads follow each member’s content scopes. Published and server-preview delivery
tokens remain space-wide service credentials; scoped readers cannot mint them.
Public content and opted-in public media are unaffected by private CMS read scopes.

See [docs/README.md](docs/README.md) for the maintained guide index. Historical
implementation plans and issue notes under `docs/work-breakdown.md` and
`docs/issues/` are design records, not current product instructions.

Rich text preserves text colors and inline images imported from other CMSs. Inline
images carry a space-scoped asset ID and an HTTP(S) source; publication validates
asset ownership and includes them in media usage. External links also accept
`tel:` URLs for telephone CTAs.

External option feeds accept both `{items: [{value, label}]}` and existing
`[{value, name}]` arrays. Both formats retain the same host allowlist, DNS, size,
and uniqueness checks.

## License

Storypane is [MIT licensed](LICENSE). Third-party components retain their own
licenses. Plus Jakarta Sans is distributed under its [OFL notice](apps/web/public/fonts/OFL.txt).
