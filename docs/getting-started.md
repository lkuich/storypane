# Getting started

Storypane is an open-source CMS. Run the current release with Docker, or use the
source-development workflow when you want to change the application. The CMS
runtime is Node.js: the Cloudflare Worker deployment in the previous release is
not compatible with the current installation and per-space database layout.

## Run a fresh installation

For a Docker installation, you need Docker Compose and Node 24.22+ within v24
for the setup command. Clone the [CMS repository](https://github.com/lkuich/storypane),
then generate the configuration from its root:

```sh
node scripts/setup-env.mjs
```

This creates ignored `.env.production` with owner-only permissions, independent
encryption/authentication keys, database passwords, and private object-store
credentials. Values are generated locally and never printed. The defaults use
bundled Postgres/MinIO, local sign-in, and `http://localhost:3130`; Clerk and SMTP
are optional. For a remote installation, change `STORYPANE_APP_URL` to your exact
HTTPS origin and configure a reverse proxy before inviting users.

The command never overwrites an existing file or rotates keys. Keep the file and
Docker volumes on upgrades. If you already have configuration, review it instead
of deleting it to rerun setup.

Start Postgres, private media storage, and the CMS, then create the first
installation administrator with the interactive CLI:

```sh
docker compose --env-file .env.production -f compose.node.yaml up --build -d
docker compose --env-file .env.production -f compose.node.yaml exec web \
  node --import tsx scripts/admin.ts bootstrap
```

Open `http://localhost:3130`, sign in with that administrator, and create your
first space. There are no default credentials or public signup endpoint. See
[Node installation and production setup](self-hosting.md) for external Postgres
and object storage, invites, backup/restore, upgrades, and recovery.

## Develop from source

For source development, use Node 24.22+ within v24 and pnpm 12.4.2.
Generate ignored `.env` with `--local`; it includes matching credentials and
host URLs for local Postgres and object storage. Then migrate and bootstrap the
installation database:

```sh
pnpm install --frozen-lockfile
node scripts/setup-env.mjs --local
pnpm db:start
node --env-file=.env --import tsx scripts/admin.ts migrate
node --env-file=.env --import tsx scripts/admin.ts bootstrap
pnpm dev
```

Open `http://127.0.0.1:3130` and sign in with the administrator created by the
CLI. The legacy `pnpm db:setup` command is for local fixture databases only; never
use it for an installation or production database. See the
[operator guide](self-hosting.md#operator-commands).

## Set up with an agent

Open the cloned repository in your coding agent. Ask it to read `AGENTS.md` and
this guide first, or give it the maintained
[Storypane deploy skill](https://storypane.dev/docs/agents/). Copy this prompt:

```text
Set up a fresh local Storypane installation using docs/getting-started.md.
Check Node and Docker prerequisites, run node scripts/setup-env.mjs, and
start the bundled Compose services. Keep secrets in the ignored env file;
never print them or replace existing configuration, keys, or volumes.
Check readiness, then give me the administrator bootstrap command to run
in my own terminal so I can enter my password privately.
```

For source development, tell your agent to use `node scripts/setup-env.mjs --local`
and the source workflow above. An agent can prepare the installation; review its
changes and enter passwords locally. The setup script does not create accounts,
start services, or verify a fresh deployment by itself.

## Build a website

Storypane includes example sites for Astro and Next.js. After the CMS is running,
configure `.env` and follow the [Astro integration guide](../apps/example-astro/README.md)
or [Next.js integration guide](../apps/example-next/README.md). For published and
preview data contracts, see the [SDK guide](../packages/sdk/README.md). Keep
published and preview tokens on the server; never place them in browser code.

## Choose where to run it

The current CMS runtime is Node/Docker. Railway has a separate Node deployment
guide, but has not passed fresh-install acceptance. Cloudflare hosts the static
marketing website; the current CMS runtime does not run on Workers. Retire a
legacy Worker only after its content, database, media and keys have been migrated
or backed up and the replacement installation is verified. See
[deployment status and the full acceptance checklist](deployment-verification.md).

## Get help from the guides

- [Node installations](self-hosting.md)
- [Railway setup and status](deploy-railway.md)
- [Cloudflare and the static website](deploy-cloudflare.md)
- [Management API, SDK, CLI, and MCP](management-api.md)
- [Webhooks](webhooks.md)
