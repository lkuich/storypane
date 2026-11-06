# Node installations

This release uses one installation database and one PostgreSQL database per space.
Built-in email/password authentication is the default. No Clerk keys or SMTP
server are required. Run one Node application replica: it serves HTTP, in-memory
collaboration rooms, and the minute publication/webhook scheduler.

## Fresh Docker installation

Run `node scripts/setup-env.mjs` from the repository root using Node 24.22+
within v24. It creates ignored `.env.production` with mode `600`, independent
keys, random database passwords, and private object-store credentials for the
bundled Compose services. It never prints secrets or overwrites an existing file.
Set `STORYPANE_APP_URL` to the exact browser origin (`http://localhost:3130` by
default; HTTPS behind a reverse proxy for remote users). Keep all values on upgrades.

```sh
docker compose --env-file .env.production -f compose.node.yaml up --build -d
docker compose --env-file .env.production -f compose.node.yaml exec web \
  node --import tsx scripts/admin.ts bootstrap
```

Bootstrap prompts for an email, name and hidden password. It refuses to create
another initial administrator. There are no default accounts and no public signup
or bootstrap endpoint. Sign in, then create your first space. Only installation
administrators see database provisioning and connection controls.
Space settings → Database connection shows the saved URL with its password masked.
Installation admins can explicitly reveal or copy the full URL; each action checks
the current session, installation privileges and editor origin. Ordinary reads
return only the masked URL. Space admins
manage only their space's roles, members, schemas, content and settings.

The Compose layout keeps PostgreSQL and MinIO off host ports and persists both in
named volumes. The bundled store uses a pinned [Coollabs MinIO build](https://github.com/coollabsio/minio); external private S3 storage is also supported. The web port binds to loopback; configure your HTTPS reverse proxy
for a remote installation. The database initializer runs **only on an empty
volume**; it never changes an existing instance. Do not delete volumes to upgrade.

## Existing PostgreSQL and object storage

Set `INSTALLATION_DATABASE_URL` to an empty database owned by a dedicated role.
Set `PROVISIONING_DATABASE_URL` separately if automatic database creation is wanted.
Its role must create roles and databases; these credentials are never passed to
content requests. Keep `INSTALLATION_ENCRYPTION_KEY` separate from PostgreSQL and
from the webhook encryption key. The connection registry stores authenticated,
space-bound encrypted URLs. Ordinary settings responses never return passwords;
full URLs are available only through the explicit installation-admin reveal/copy action.

PostgreSQL grants `CONNECT` to `PUBLIC` by default. A dedicated space role must
have no superuser, create-role or create-database privileges and must not connect
to any other database. On a **dedicated instance**, the operator must revoke public
CONNECT on every existing database, including `postgres` and `template1`, then
grant access to the roles that actually need it. Review existing applications
before changing privileges on a shared instance. Automatic provisioning revokes
public access to each database it creates. Attach rejects nonempty databases,
privileged/shared roles and databases already bound to another space.

Example operator SQL, using securely supplied password variables:

```sql
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
CREATE ROLE storypane_installation LOGIN PASSWORD :'installation_password';
CREATE DATABASE storypane_installation OWNER storypane_installation TEMPLATE template0;
REVOKE ALL ON DATABASE storypane_installation FROM PUBLIC;
```

Configure `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, and optionally `S3_FORCE_PATH_STYLE=true`. Use a private
bucket. Space IDs prefix original object keys; routing and publication checks
remain in the application. The installation uses a maximum of five control
connections and sixteen active space handles with at most two connections each.
The directory and background worker visit up to three databases concurrently.

```sh
pnpm admin migrate
pnpm admin bootstrap
pnpm build
# With the same variables exported, or using Node's --env-file option:
node --env-file=.env.production --conditions=storypane-node --import tsx apps/web/src/node.ts
```

## Invitations and recovery

Settings → Members produces a seven-day, single-use invitation URL. Share it
privately. Accepting an invitation creates an unverified account, or requires
sign-in to the matching existing account. It never resets another person's
password, verifies their email, or overwrites existing membership roles.
Revoke and recreate an invitation to replace a lost link.

Optional `SMTP_URL` and `MAIL_FROM` enable emailed invitations and the password
reset form. Without SMTP, use `pnpm admin recover` in a terminal. Recovery and
password resets revoke existing sessions; password changes revoke other sessions.
Authentication rate limits are persisted in the installation database.

## Operator commands

Run `pnpm admin` on the server with ignored `.env.production`, or invoke
`node --import tsx scripts/admin.ts` inside the web container. This is separate
from the remotely installed SDK CLI.

- `bootstrap`: create the first local installation admin with a hidden password.
- `recover`: set a local account password and revoke sessions.
- `grant-admin <userId>`: explicitly promote an existing installation identity.
- `create-space [operationId]` / `attach-space [operationId]`: provision a space;
  the CLI prints its stable operation ID before work begins. Retry with that ID.
- `migrate`: apply transactional installation and space migrations independently;
  failures are reported after other healthy spaces finish.
- `split-legacy <private-manifest.json>`: maintenance migration described below.
- `migrate-local-account <userId>`: explicitly assign a hidden local password to
  an imported identity, keeping its Clerk mapping and revoking its sessions.
- `link-clerk-account <userId> <clerkUserId>`: explicitly map identity IDs. Set the
  matching `externalId` in Clerk. Existing conflicting mappings are rejected.
- `switch-provider local|clerk`: during maintenance, after migrating every active
  identity, switch the installation provider and revoke all sessions. Then set
  `AUTH_PROVIDER` accordingly and restart. A configuration-only provider change
  is rejected. Email addresses never automatically link identities.

Select Clerk explicitly with `AUTH_PROVIDER=clerk`, `CLERK_SECRET_KEY` and
`VITE_CLERK_PUBLISHABLE_KEY`. Configure the exact application origin in Clerk.
Grant the first Clerk installation admin through `grant-admin` after sign-in.
Clerk checks share remote results within each HTTP request or collaboration
operation and coalesce concurrent lookups. Completed results are never reused
by a later request. Local account/session status and space permissions are still
checked at each operation.

## Legacy migration and rollback

Stop the old web process, collaboration service and all jobs for the entire copy
and validation window. Back up the source, original objects and existing webhook
key. Upgrade the source to migration 024 with the previous release first. Set up
an empty installation database with `AUTH_PROVIDER=clerk` to preserve identities.
Prepare an empty database and dedicated restricted role for each space.

Create a mode-600 JSON manifest containing `source` (the old PostgreSQL URL),
`destinations` (an object mapping every original space ID to its new URL), and
`installationAdminId` (an existing identity ID). Run `pnpm admin split-legacy
/path/to/manifest.json`. The source transaction is read-only. The command copies
identities and mappings, preserves all IDs, token hashes, content, histories,
permissions, schedules and asset keys, validates row values/counts and foreign
keys, and preserves migration timestamps. Only after every space validates does
it commit the installation registry. Opaque previews retain their routing index
until expiration; token and origin validation still occurs in the space database.

Pending legacy invitations have no single-use link; revoke and reissue them after migration.

The copy currently holds one space's rows in memory; use adequate operator memory
for large histories. A failed split retains destination databases for inspection
and leaves the registry uncommitted. Retry with new empty destinations, keeping
failed copies until investigation is complete. No source or destination is erased
automatically. Switch the application only after validation, test both example
sites with their existing URLs/tokens, and perform the acceptance checklist.

Rollback **before admitting new writes** means stopping the new runtime and
restoring the previous release/configuration against the retained source and
original object storage. After new writes, reconcile them before rolling back;
the old source is not kept synchronized. Retain it until the operator explicitly
retires the rollback copy.

## Backups, upgrades and health

Back up the installation database, every space database, private originals,
`INSTALLATION_ENCRYPTION_KEY`, `WEBHOOK_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`.
Restore a space with its media and the relevant installation identities, registry
entry and keys; a database-only restore is incomplete. Run `pnpm admin migrate`
before starting a new release. Never use local-only `db:setup` for deployment.

`/api/ready` returns 503 when the installation database/provider is unavailable.
A failed space produces 200 with `degraded: true` and an unavailable-space count,
so healthy spaces keep serving requests. Individual space requests fail closed;
background jobs continue processing other spaces. Health is not full acceptance.
Follow [deployment verification](deployment-verification.md) before rollout.

For local source development, run `node scripts/setup-env.mjs --local` to create
ignored `.env` with matching credentials and local backing-service URLs.
`pnpm db:start` starts private local backing services with the
`compose.node.local.yaml` override: PostgreSQL on `127.0.0.1:55450`, S3 on
`127.0.0.1:59120`. Point installation/provisioning URLs and `S3_ENDPOINT` at those
host ports. Migrate and bootstrap with
`node --env-file=.env --import tsx scripts/admin.ts`, then run `pnpm dev`.
Development and production both attach collaboration sockets and the scheduler.
`pnpm build && pnpm start:node` serves a production build with `.env`.
Existing legacy `compose.yaml` and `db:setup` remain local fixture tools; invoke
`docker compose -f compose.yaml up -d` explicitly for those tests.
Use private `STORYPANE_SESSION_COOKIE` for example setup in local auth mode;
Clerk mode also accepts `STORYPANE_SESSION_TOKEN`.

Cloudflare hosts the static marketing website; this CMS release runs on Node and
does not deploy to Workers. A previous Worker installation can be retired after
its content, database, private media and encryption keys have been migrated or
backed up, and the replacement has passed the relevant acceptance checks. See the
[Cloudflare guide](deploy-cloudflare.md) before removing legacy resources.

## Work with an agent

Use the [getting-started agent prompt](getting-started.md#set-up-with-an-agent)
for a first installation. For an upgrade, give your agent this task:

```text
Read AGENTS.md and docs/self-hosting.md before upgrading this installation.
Identify the existing databases, media, configuration, and encryption keys;
keep all values intact and verify backups before applying migrations.
Use the transactional operator migration runner. Never rerun fresh setup
over an existing env file or delete volumes to fix a failed upgrade.
Report the changed files and verification results without printing secrets.
```

For external Postgres, storage, SMTP, or Clerk, configure credentials through your
local secret manager or terminal; do not paste them into an agent conversation.
The setup script configures bundled local services and cannot provision external
provider credentials.
