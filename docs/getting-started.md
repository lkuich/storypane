# Getting started

Storypane is an open-source CMS. Run the current release with Docker, or use the
source-development workflow when you want to change the application. The CMS
runtime is Node.js: the Cloudflare Worker deployment in the previous release is
not compatible with the current installation and per-space database layout.

<details class="agent-instructions" aria-labelledby="set-up-with-an-agent">
<summary>Set up with a coding agent</summary>

<div class="agent-instructions-top"><span class="eyebrow">For coding agents</span></div>

## Set up with an agent

Open the cloned repository in your coding agent. Ask it to read `AGENTS.md` and
this guide first, or give it the maintained
[Storypane deploy skill](https://storypane.dev/docs/agents/). Copy this prompt:

```text
In the Storypane checkout, read AGENTS.md and docs/getting-started.md,
then set up a fresh local Storypane installation.
Check Node and Docker prerequisites, run node scripts/setup-env.mjs, and
start the bundled Compose services. Keep secrets in the ignored env file;
never print them or replace existing configuration, keys, or volumes.
Check readiness, then give me the administrator bootstrap command to run
in my own terminal so I can enter my password privately.
```

For source development, tell your agent to use `node scripts/setup-env.mjs --local`
and the source workflow below. An agent can prepare the installation; review its
changes and enter passwords locally. The setup script does not create accounts,
start services, or verify a fresh deployment by itself.

</details>

## Run a fresh installation

For a Docker installation, you need Docker Compose and Node 24.22+ within v24
for the setup command. Clone the [CMS repository](https://github.com/lkuich/storypane),
then generate the configuration from its root. Repository access is required
while the source repository is private:

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
first **Production** space. Keep its schema read-only, then create a linked
**Development** space for each developer using production as the base. Follow the
[team development workflow](development-workflow.md) for setup, promotion, and sync,
or [Your first page in Storypane](editor-quickstart.md) for a guided first schema
and publication. There are no default credentials or public signup endpoint. See
[Node installation and production setup](self-hosting.md) for external Postgres
and object storage, invites, backup/restore, upgrades, and recovery.

For a first-time checklist, follow [Recommended setup](recommended-setup.md),
including production protection, local website development, and preview preferences.

## Choose the right workspace

For a new team, content editors work in production. Developers deploy and test
schema changes in their own linked dev spaces, then promote reviewed migrations
to production. Other developers explicitly sync before promoting their own work.
Both the block library hierarchy and nested-block restrictions are included.

Cloning copies the deployed schema without bulk content or media. The review lists
any dependencies required by schema defaults; copied stories start unpublished.
Use the environment label and space switcher in the header to move between spaces.
See [Work with production and development spaces](development-workflow.md).

## Develop from source

This section is for changing Storypane itself. To develop your website and schema,
use the [team workflow](development-workflow.md) against an installed CMS.

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

## Build a website

Storypane includes example sites for Astro and Next.js. After the CMS is running,
connect the live frontend to **production** and a test frontend to **dev**. Use
space-specific tokens and generate types from the same deployed space as each
frontend. Configure `.env` and follow the [Astro integration guide](../apps/example-astro/README.md)
or [Next.js integration guide](../apps/example-next/README.md). For published and
preview data contracts, see the [SDK guide](../packages/sdk/README.md). Keep
published and preview tokens on the server; never place them in browser code.

## Choose where to run it

The current CMS runtime is Node/Docker. For hosted setup, use the
[Deploy on Railway template](deploy-railway.md): it provisions the app, Postgres,
and private storage, then creates your first administrator. See its recorded
checks and remaining production acceptance. Cloudflare hosts the static
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

For invitations, recovery, Clerk, and agent credentials, read
[authentication and access](authentication.md). Check the
[release status](releases-and-versioning.md) before choosing a production version.
