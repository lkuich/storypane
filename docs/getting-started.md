# Getting started

Storypane is an open-source CMS. Run the current release with Docker, or use the
source-development workflow when you want to change the application. The CMS
runtime is Node.js: the Cloudflare Worker deployment in the previous release is
not compatible with the current installation and per-space database layout.

## Run a fresh installation

For a Docker installation, you need Docker Compose. Clone the
[CMS repository](https://github.com/lkuich/storypane):

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

Set `STORYPANE_APP_URL` to the origin you will open in your browser. For a local
install, use `http://localhost:3130`. Generate independent encryption and auth
secrets; keep them in the ignored `.env.production` file:

```sh
openssl rand -base64 32 # INSTALLATION_ENCRYPTION_KEY
openssl rand -base64 32 # BETTER_AUTH_SECRET
openssl rand -base64 32 # WEBHOOK_ENCRYPTION_KEY
openssl rand -hex 32    # PROVISIONING_DB_PASSWORD
openssl rand -hex 32    # INSTALLATION_DB_PASSWORD
```

Put each output in its named variable. Add random S3 access credentials for the
private bundled MinIO service. Keep all keys and Docker volumes when upgrading.
Local sign-in is the default; Clerk and SMTP are optional.

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

For source development, use Node 24.22+ within v24 and pnpm 12.4.2. Configure the
ignored `.env` as described in the local development section of the
[self-hosting guide](self-hosting.md#backups-upgrades-and-health). Start local
Postgres and object storage, then migrate and bootstrap the installation database:

```sh
pnpm db:start
node --env-file=.env --import tsx scripts/admin.ts migrate
node --env-file=.env --import tsx scripts/admin.ts bootstrap
pnpm dev
```

Open `http://localhost:3130` and sign in with the administrator created by the
CLI. The legacy `pnpm db:setup` command is for local fixture databases only; never
use it for an installation or production database. See the
[operator guide](self-hosting.md#operator-commands).

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
