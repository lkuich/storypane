# Blok

A Storyblok-style CMS: independent locale pages, automatic saving, exclusive
blok editing, versioned publishing, and a media library adapted from UGC Scout.

This first build runs the application, Durable Objects, and R2 in Cloudflare's
local Workers runtime, with **Postgres 18 in Docker**. It does not need cloud
credentials to run locally.

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

Open **http://127.0.0.1:3130**. The local setup creates a workspace and a Home story
with Hero and Footer bloks. Run it again safely without resetting your content.
After sign-in, the **Spaces** screen lists your workspaces. Create a space or open
**My space**, then use **Settings** in its sidebar to edit its name and description
or view its members. Admins can change settings; editors have read-only access.
The workspace selector and **Spaces** breadcrumb return to the central screen.

| Local account | Password | Access |
| --- | --- | --- |
| `admin@blok.local` | `blok-local-admin` | Content, assets, schemas, datasources |
| `editor@blok.local` | `blok-local-editor` | Content, assets, publishing |

Use separate browser profiles or an incognito window to try parallel editing.
These accounts are local fixtures, never deployment defaults. Public signup is
disabled. Sessions expire after seven days; account provisioning is currently an
operator task.

The monorepo includes a working Astro website. With the CMS running, use
`pnpm example:setup` then `pnpm dev:example`, and open **http://127.0.0.1:3132/home**.
Setup creates a separate Fieldwork example space with published Default/French
content and an unpublished page. See [the Astro example guide](apps/example-astro/README.md)
for static builds, visual preview, and schema-to-TypeScript generation.

Postgres listens only on `127.0.0.1:55432`, using database/user/password `blok`.
Optional settings are in `.env.example`; copy it to `.env` when changing defaults.
Keep `DATABASE_URL` consistent with the Compose settings. `pnpm db:setup` creates
a random auth secret in ignored `apps/web/.dev.vars`. Local R2/room state persists
under `.cloudflare/state`; database content persists in `blok_postgres_data`.
Stop the database with `docker compose stop`. Removing its volume erases content.

## What works

- Central Spaces screen with search, creation, story/member counts, and per-space
  settings. New spaces start empty and their creator becomes an administrator.
- Space selection stays in the page URL, so separate tabs can use separate spaces.
  API calls, live editing, uploads, and asset previews all use the selected space.
- Delivery SDK with Postgres-backed published reads, read-only live draft preview,
  configurable preview triggers, and React/Next.js/Astro integration recipes.
- Working Astro example with a typed React block registry, published static pages,
  unpublished-story preview shell, and `blok:pull` / `blok:types` / `blok:generate` commands.
- Application iframe preview and click-to-edit block selection. Configure its URL
  and create/revoke published or server preview tokens in **Settings → API & preview**.
- Versioned JSON schemas with Nestable, Content type, and Universal blocks.
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
- Blok leases, autosave, live updates, conflict detection, and preserved unsent
  input when disconnected. Continued editing requires a connection.
- Page/blok restoration into new history and publication of a fixed reviewed
  checkpoint. Subsequent edits stay in the draft.
- Multi-file drops anywhere in the asset library, with a floating upload queue
  that continues across workspace navigation and supports pause/resume.
- Resumable R2 uploads, folders, metadata, asset selection, and archive.
  Archiving preserves referenced files and their bytes. Image previews use
  resized WebP thumbnails; downloading an original preserves its bytes.

## Storage and workspace

Postgres is authoritative for draft JSONB, schemas, leases, immutable checkpoints,
and publications. Each blok has its own revision. Brief locale transactions
produce a consistent history without rejecting unrelated blok edits. Durable
Objects deliver presence and committed updates; they do not hold the only copy
of a draft. This avoids a second draft database and a cross-database publish step.

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router UI/API, authentication, Cloudflare entrypoint |
| `apps/realtime` | Durable Object rooms and WebSockets |
| `apps/example-astro` | Static example website, generated block props, live preview |
| `packages/core` | Content contracts and validation |
| `packages/db` | Postgres migrations, transactions, history, publishing |
| `packages/assets` | Asset metadata and R2 upload/delivery service |
| `packages/ui` | Shared controls |
| `packages/sdk` | Published delivery, browser preview bridge, React hook, schema/type CLI |

Existing bloks retain their referenced schema version when a definition changes;
new bloks use the latest version. Bulk schema migration is not implemented yet.

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

```sh
pnpm db:test
pnpm test
pnpm typecheck
pnpm build
# With pnpm dev running and Google Chrome installed:
pnpm test:e2e
```

Unit/integration tests use isolated schemas in the local `blok_test` database.
Browser tests use the local fixture accounts and create test content in the app.
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
- `BLOK_APP_URL`: the deployed HTTPS origin, matching cookie/origin validation.
- `AUTH_SECRET`: a strong Worker secret, distinct from the local fixture secret.
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
