# Node installations

This release uses one installation database and one PostgreSQL database per space.
Built-in email/password authentication is the default. No Clerk keys or SMTP
server are required. Start with one Node application replica: it serves HTTP,
collaboration sockets, and independent minute schedulers for publication and webhooks.
Editor replicas exchange room notifications through the installation database;
see [editor scaling requirements](deploy-railway.md#scale-editors).
Published delivery can run in separate replicated processes using the same image
with `STORYPANE_SERVICE=delivery`; keep editor processes on `combined`. See [delivery configuration and connection budgets](deploy-railway.md#scale-published-delivery-separately).

<details class="agent-instructions" aria-labelledby="work-with-an-agent">
<summary>Set up with a coding agent</summary>

<div class="agent-instructions-top"><span class="eyebrow">For coding agents</span></div>

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

</details>

The example runs PostgreSQL and an AGPL-licensed MinIO service alongside the
MIT-licensed CMS. Review [third-party notices](../THIRD_PARTY_NOTICES.md); external
Postgres and S3 providers can be used instead.

For a hosted installation without terminal setup, use the [Railway template](deploy-railway.md).
It provisions PostgreSQL and private storage and bootstraps the administrator from
your deployment inputs. The Docker instructions below are the self-managed path.

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
or bootstrap endpoint. Sign in, then [create production and linked dev spaces](development-workflow.md). Keep production for content editors and its schema read-only; give developers
dedicated dev spaces for schema changes and reviewed promotion.

Only installation
administrators see database provisioning and connection controls. Space settings → Database connection shows the saved URL with its password masked. Installation admins can explicitly reveal or copy the full URL; each action checks
the current session, installation privileges and editor origin. Ordinary reads
return only the masked URL.

Space admins
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
grant access to the roles that actually need it.

Review existing applications
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
bucket with read, write, multipart-upload and delete permissions. Discarding an
unfinished upload removes its stored bytes; completed originals are preserved. Space IDs prefix original object keys; routing and publication checks
remain in the application.

The installation uses a maximum of five control
connections and sixteen active space handles with at most two connections each. The directory and each background job visit up to three databases concurrently. Publication and webhook delivery run independently, so a slow webhook receiver
cannot delay scheduled publication.

Together the two jobs can hold six space
handles within the same installation-wide limit.

```sh
pnpm admin migrate
pnpm admin bootstrap
pnpm build
# With the same variables exported, or using Node's --env-file option:
node --env-file=.env.production --import tsx apps/web/src/node.ts
```

See the dedicated [authentication guide](authentication.md) for local sign-in,
Clerk setup, identity-preserving provider changes, and API/agent credentials.

## Invitations and recovery

Settings → Members & roles produces a seven-day, single-use invitation URL. Share it
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
- `link-provider-account <userId> <provider> <subject>`: explicitly map an existing
  identity to a custom provider's verified subject without matching by email.
- `switch-provider <provider>`: during maintenance, after migrating every active
  identity, switch the installation provider and clear Storypane's session records. Then set
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
keys, and preserves migration timestamps.

Only after every space validates does
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

### Use your cloud host's database backups

Enable managed backups for the **installation database and every space database**
in your database provider's dashboard. Choose the retention period and, where your
provider supports it, point-in-time recovery. Check that newly created space
databases are covered too. If you operate Postgres yourself, use its documented
[backup and restore methods](https://www.postgresql.org/docs/current/backup.html).

Database backups preserve content, schemas, migration history, permissions, and
publication state. Original media lives separately in private object storage:
enable the appropriate bucket backup/versioning or copy policy, and preserve your
configuration and encryption keys securely. Database backups alone cannot recover
missing originals or decrypt connection details without the original keys.

Test a restore into an isolated environment. Check sign-in, each space, drafts and
published content, media downloads, and encrypted settings. Contain outbound
webhook/email effects during the test. A successful backup job is not a verified
restore.

### Change regions or cloud hosts

Storypane runs as a Node/Docker application with PostgreSQL and private
S3-compatible object storage. You can move the application host while retaining
the same database/storage endpoints. Moving those services too means copying
their data and updating their connections; there is no Storypane region or cloud
subscription to change.

1. Plan a maintenance window. Stop the old application, collaboration connections,
   and background jobs so writes cannot race the copy. Take a coordinated backup
   of the installation database, every space database, original media, and keys.
2. Restore the databases with the same space IDs, histories, and required database
   roles. Copy original media with its existing object keys and private access
   rules. Keep the application version and encryption/authentication secrets
   consistent with the snapshot.
3. Set the new host's `INSTALLATION_DATABASE_URL`, private storage configuration,
   and, if used, provisioning connection. If space database endpoints changed,
   update their saved connections before starting jobs. Retaining private database
   DNS names can avoid registry changes. Otherwise, use an authorized operator
   process through `Installation.updateConnection`; it checks the restored space
   identity and dedicated database role and encrypts the new URL. Do not replace
   encrypted registry values with plaintext or attach the restored database as a
   new, empty space.
4. Run the transactional operator migrations against the intended target
   databases, then start one application instance. Verify readiness, sign-in,
   content, private media, and preview before switching traffic. If the public
   origin changes, update `STORYPANE_APP_URL`, proxy/DNS, frontend configuration,
   and the authentication provider's allowed origin as appropriate.

For an individual space whose application is already running against the intended
installation, an installation administrator can also use **Settings → Database
connection → Update database connection**. The same space/role checks apply. The
connection-update service is defined in
[`packages/db/src/installation.ts`](../packages/db/src/installation.ts).

Retain the old deployment and backup until the move is verified. After accepting
writes on the new host, reverting to the old database without reconciling those
writes loses changes. Region and provider moves are operator-managed migrations,
not automatic background replication.

### Preserve the complete installation

Back up the installation database, every space database, private originals,
`INSTALLATION_ENCRYPTION_KEY`, `WEBHOOK_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`.
Restore a space with its media and the relevant installation identities, registry
entry and keys; a database-only restore is incomplete. Run `pnpm admin migrate`
before starting a new release. Never use local-only `db:setup` for deployment.
Installation/database migrations are separate from the schema migrations that
teams deploy and promote inside spaces.

Page map requires space migration `028_page_connections`. The existing migration
runner adds and backfills a derived index of current checkpoints and publications.
Historical content and migration timestamps remain unchanged. Run the migration
before opening Map after an upgrade; restarting alone does not apply it. See
[Page map](page-map.md#upgrade-existing-instances) for the workflow and limits.

Content releases require space migration `027_content_releases`. Run
`pnpm admin migrate` before starting this version. Existing schedules, checkpoint
IDs, times and history are retained as individual releases. Failed schedules
remain on hold for review; new releases reserve each page locale until it is
removed, published or cancelled. Back up and retain the space databases before
upgrading. See [Content releases](releases.md) for recovery and editor actions.

The linked-space release requires installation migration `002_space_environments`
and space migration `026_space_environments`. The transactional operator runner
applies both across registered spaces; restarting the server alone does not apply
missing database migrations. Existing spaces keep their previous schema protection
setting; enable **Schema read-only** on production when adopting the team workflow.

For an existing local source installation, stop the dev server, run
`node --env-file=.env --import tsx scripts/admin.ts migrate`, then restart with
`pnpm dev`. For a production installation, use its `.env.production` through
`pnpm admin migrate` before starting the new release. If Spaces fails to load
following an upgrade, inspect server logs and the runner's result for missing
migrations. Do not reset databases or regenerate encryption keys to fix it.

`/api/ready` returns 503 when the installation database/provider is unavailable.
A failed space produces 200 with `degraded: true` and an unavailable-space count,
so healthy spaces keep serving requests. Individual space requests fail closed;
background jobs continue processing other spaces. Health is not full acceptance.
Follow [deployment verification](deployment-verification.md) before rollout.

For local source development, run `node scripts/setup-env.mjs --local` to create
ignored `.env` with matching credentials and local backing-service URLs. `pnpm db:start` starts private local backing services with the
`compose.node.local.yaml` override: PostgreSQL on `127.0.0.1:55450`, S3 on
`127.0.0.1:59120`. Point installation/provisioning URLs and `S3_ENDPOINT` at those
host ports.

Migrate and bootstrap with
`node --env-file=.env --import tsx scripts/admin.ts`, then run `pnpm dev`. Development and production both attach collaboration sockets and the scheduler. `pnpm build && pnpm start` serves a production build with `.env`. Existing legacy `compose.yaml` and `db:setup` remain local fixture tools; invoke
`docker compose -f compose.yaml up -d` explicitly for those tests.

Use private `STORYPANE_SESSION_COOKIE` for example setup in local auth mode;
Clerk mode also accepts `STORYPANE_SESSION_TOKEN`.

Cloudflare hosts the static marketing website; this CMS release runs on Node and
does not deploy to Workers. A previous Worker installation can be retired after
its content, database, private media and encryption keys have been migrated or
backed up, and the replacement has passed the relevant acceptance checks. See the
[Cloudflare guide](deploy-cloudflare.md) before removing legacy resources.
