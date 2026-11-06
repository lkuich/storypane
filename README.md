# Storypane

**A collaborative, open-source CMS for the websites you build.**

Give editors a place to compose pages, preview changes, and publish together.
Keep your frontend, your components, and your content on infrastructure you control.

[Website](https://storypane.dev) · [Documentation](docs/README.md) ·
[Get started](#get-started) · [SDK](packages/sdk/README.md) · [MIT license](LICENSE)

## Content you can work on together

Storypane is a headless CMS built around structured blocks. Developers define
content types and render them in their own applications; editors assemble pages
and see their changes in a live website preview.

- **Edit together.** Work on different blocks of the same page at the same time,
  with presence indicators, automatic saving, and block locks that prevent
  conflicting edits.
- **Preview in your website.** Use your own components for live draft previews,
  including unpublished pages. Select a block in the preview to edit its fields.
- **Publish deliberately.** Review a fixed checkpoint, publish linked content
  together, or schedule publication. Later edits stay in the draft, and history
  lets you restore earlier content.
- **Make room for every locale.** Give each locale its own page structure and URL.
  Copy content between locales as a starting point without keeping them coupled.
- **Model content that fits.** Combine reusable blocks, rich text, media, links,
  and data sources. Review schema migrations and generate TypeScript types for
  your frontend.
- **Control access.** Organize work into spaces with separate PostgreSQL databases.
  Assign roles and scope reading, editing, and publishing down to individual fields.
- **Manage media in one place.** Upload files with pause and resume, organize
  assets, set image focal points, and see where files are used. Original files
  stay private; public delivery of published media is optional.
- **Connect your workflow.** Fetch published content with the SDK, automate through
  the management API, CLI, and MCP, and trigger builds or integrations with signed
  webhooks.

## Get started

The current CMS runs on **Node.js and Docker**, backed by PostgreSQL and private
S3-compatible storage. The Docker setup includes all three services. Built-in
email/password sign-in is the default; Clerk and SMTP are optional.

You need Git, Docker with Compose, and OpenSSL to generate secrets.

### 1. Get the source

```sh
git clone https://github.com/lkuich/storypane.git
cd storypane
cp .env.production.example .env.production
chmod 600 .env.production
```

### 2. Configure your installation

Edit `.env.production`. For a local installation, set the following values.
Run each generation command separately for **each variable**, then paste its
output into the file.

| Variable                                                                      | Value                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------- |
| `STORYPANE_APP_URL`                                                           | `http://localhost:3130`                      |
| `INSTALLATION_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `WEBHOOK_ENCRYPTION_KEY` | Generate each with `openssl rand -base64 32` |
| `PROVISIONING_DB_PASSWORD`, `INSTALLATION_DB_PASSWORD`                        | Generate each with `openssl rand -hex 32`    |
| `S3_ACCESS_KEY_ID`                                                            | Generate with `openssl rand -hex 8`          |
| `S3_SECRET_ACCESS_KEY`                                                        | Generate with `openssl rand -hex 32`         |

Compose supplies the database and storage connection settings. Keep
`.env.production` private and retain its keys and the Docker volumes on upgrades.

### 3. Start Storypane

```sh
docker compose --env-file .env.production -f compose.node.yaml up --build -d
docker compose --env-file .env.production -f compose.node.yaml exec web \
  node --import tsx scripts/admin.ts bootstrap
```

The bootstrap command prompts for the first administrator's name, email, and
password. Open **[localhost:3130](http://localhost:3130)**, sign in, and create a
space. Define your blocks, deploy the initial schema migration, and start writing.

For an external database or object store, HTTPS, invitations, backups, and upgrades,
follow the [self-hosting guide](docs/self-hosting.md). Existing shared-database
installations should follow the [migration and rollback guide](docs/self-hosting.md#legacy-migration-and-rollback).

## Bring your frontend

Storypane delivers content as structured data. You own the markup, routing, and
rendering, whether you build a static site or fetch content at request time.

Create a **Published content** token in **Space settings → API & preview**. Use
the SDK from your application's server code, with types generated from your
deployed schema:

```ts
import { createStorypaneClient } from '@storypane/sdk';
import { storypaneMigrationVersion, type StorypaneContentType } from './types/storypane';

const storypane = createStorypaneClient<StorypaneContentType>({
  url: process.env.STORYPANE_URL!,
  spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_DELIVERY_TOKEN!,
  migrationVersion: storypaneMigrationVersion,
});

const page = await storypane.getStory({ slug: 'home' });
// Render page.content with your components.
```

Published reads return publication snapshots. Draft preview uses a separate,
authenticated connection. Keep delivery and preview tokens on the server; rebuild
or revalidate static pages when content is published.

The SDK is available in this workspace. Until an npm release, build and link it
or install a packed archive using the [SDK guide](packages/sdk/README.md).

Explore a complete integration:

| Example                                | What it demonstrates                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| [Astro](apps/example-astro/README.md)  | Static pages, typed React blocks, and an interactive preview island. |
| [Next.js](apps/example-next/README.md) | App Router, Server Components, and a separate live preview route.    |

Both examples include localized pages, media delivery, generated types, and
click-to-edit preview. Your application can use the SDK without adopting either
example's design or routing.

## Develop from source

Use **Node.js 24.22+ within v24**, **pnpm 12.4.2**, and Docker Compose.

Copy `.env.example` to `.env`, then configure the Node development variables using
the [local development instructions](docs/self-hosting.md#backups-upgrades-and-health).
They use separate installation and space databases; the fixture defaults at the
top of `.env.example` are for legacy tests.

```sh
pnpm install --frozen-lockfile
pnpm db:start
node --env-file=.env --import tsx scripts/admin.ts migrate
node --env-file=.env --import tsx scripts/admin.ts bootstrap
pnpm dev
```

The editor runs at **http://127.0.0.1:3130**. Set `STORYPANE_APP_URL` to that same
origin in `.env`.

### Repository layout

```text
apps/web              Editor, authentication, HTTP API, and Node server
apps/realtime         Shared collaboration rooms and WebSocket handling
apps/example-astro    Astro integration
apps/example-next     Next.js integration
packages/core         Content contracts and validation
packages/db           Permissions, migrations, history, and publishing
packages/assets       Asset metadata, uploads, and delivery
packages/runtime-node Node adapters for storage, images, rooms, and background jobs
packages/sdk          Delivery, preview, management API, and CLI
packages/ui           Shared UI controls
```

PostgreSQL is authoritative for content, permissions, history, and publications.
The Node server handles HTTP, collaboration sockets, and background jobs in one
process. Run **one application replica** until a shared room transport is available.

### Checks and contributions

[Bug reports](https://github.com/lkuich/storypane/issues) and focused pull requests
are welcome. Include steps to reproduce a bug and tests for changes in behavior.

```sh
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

Database tests need the dedicated local test database: start the fixture Postgres
with `docker compose -f compose.yaml up -d`, then run `pnpm db:test` before
`pnpm test`. `pnpm db:setup` is a local fixture tool, not an installation command.
Browser tests use `pnpm test:e2e` with the CMS running and Google Chrome installed.
Authenticated suites use `STORYPANE_TEST_ADMIN_STATE` and
`STORYPANE_TEST_EDITOR_STATE` session files. Build any configured example sites
first using their integration guides above. Never commit session files or credentials.

## Documentation

- [Getting started](docs/getting-started.md) — installation and first steps.
- [Self-hosting](docs/self-hosting.md) — configuration, authentication, operations,
  backups, and upgrades.
- [SDK](packages/sdk/README.md) — delivery, live preview, media, and generated types.
- [Management API, CLI, and MCP](docs/management-api.md) — automate content and
  configuration changes.
- [Webhooks](docs/webhooks.md) — signed events, delivery, and retries.
- [Railway](docs/deploy-railway.md) and [Cloudflare](docs/deploy-cloudflare.md) —
  provider-specific setup and current support status.
- [Deployment verification](docs/deployment-verification.md) — recorded checks,
  outstanding verification, and the installation acceptance checklist.

Storypane is under active development. The current CMS targets Node/Docker;
Cloudflare hosting in the guides applies to the separate static website. Fresh
Railway deployment acceptance remains unverified. See the guides above before
planning a hosted installation.

## License

Storypane is [MIT licensed](LICENSE).
