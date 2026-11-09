# Deploy Storypane on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/storypane?utm_medium=integration&utm_source=button&utm_campaign=storypane)

Deploy the **release candidate** into your own Railway workspace. The template
builds the public repository’s `main` branch; it does not pin a stable release.
See [recorded hosted checks and remaining acceptance](deployment-verification.md#automated-operational-checks--2026-11-07)
before production use.

The Node runtime reuses vinext's standalone production server, the frontend,
Postgres model, local or Clerk authentication, HTTP APIs, asset authorization and shared
room logic. The Docker image retains workspace source and the installed `tsx`
loader for those internal runtime packages. It runs one application process for
HTTP, WebSockets and independent minute schedulers for publishing and webhooks. No Cloudflare
account or service is required for this runtime.

## What the template sets up

The template packages the CMS, PostgreSQL, and a private Railway bucket. You
select a bucket region and provide the first administrator’s name, email, and
password in Railway before deployment. The application’s pre-deploy command creates an isolated installation
database and unprivileged role, runs transactional migrations, and creates that
administrator. There is no public signup or first-visitor-wins setup endpoint.

Once deployed, open the application’s HTTPS URL and sign in with those credentials.
Create a **Production** space for editors, then linked **Development** spaces for
developers. Follow the [team setup guide](development-workflow.md).

After signing in, remove `STORYPANE_ADMIN_NAME`, `STORYPANE_ADMIN_EMAIL`, and
`STORYPANE_ADMIN_PASSWORD` from the app’s Railway variables. Redeploys preserve
existing accounts and passwords; these fields cannot reset an account. Use
**Account → Change password** or the [operator recovery command](authentication.md#password-changes-and-recovery)
for subsequent changes. Keep the generated database passwords and encryption keys.

Railway hosting and storage are billed to your Railway workspace. Cloudflare,
Clerk, and SMTP are optional and are not needed to get started.

## Template configuration

These settings describe the maintained template and are also useful for auditing
or recreating it. They are not additional steps for someone deploying the template.

Create a Railway project with an application from this repository, Railway
Postgres, and a private Storage Bucket. Name the supporting services `Postgres`
and `Bucket` when using these references. Keep **one application replica** and
**sleeping disabled**. Configure the application service in Railway's dashboard;
provider settings are not part of the application's default build configuration.
Do not scale replicas without a shared room transport; in-memory recipients would
otherwise miss notifications.

| Service setting                  | Value                                          |
| -------------------------------- | ---------------------------------------------- |
| Root directory                   | Repository root                                |
| Builder                          | Dockerfile                                     |
| Dockerfile path                  | `Dockerfile`                                   |
| Pre-deploy command               | `node --import tsx scripts/prepare-railway.ts` |
| Start command                    | Use the Docker image's default command         |
| Healthcheck path                 | `/api/ready`                                   |
| Restart policy / maximum retries | On failure / 10                                |
| Replicas                         | 1                                              |
| Sleeping                         | Disabled                                       |

For existing deployments, save these settings in the dashboard and clear any
custom config file path before upgrading. This repository no longer supplies
`railway.json`. Railway has [deprecated that configuration format](https://docs.railway.com/config-as-code);
new installations should use the service settings above.

Set application variables using Railway's reference syntax:

| Application variable        | Value                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `INSTALLATION_DATABASE_URL` | `postgresql://storypane_installation:${{INSTALLATION_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/storypane_installation` |
| `PROVISIONING_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (operator role)                                                                                         |
| `S3_ENDPOINT`               | `${{Bucket.ENDPOINT}}`                                                                                                               |
| `S3_REGION`                 | `${{Bucket.REGION}}`                                                                                                                 |
| `S3_BUCKET`                 | `${{Bucket.BUCKET}}`                                                                                                                 |
| `S3_ACCESS_KEY_ID`          | `${{Bucket.ACCESS_KEY_ID}}`                                                                                                          |
| `S3_SECRET_ACCESS_KEY`      | `${{Bucket.SECRET_ACCESS_KEY}}`                                                                                                      |

The template generates `INSTALLATION_DB_PASSWORD` as a URL-safe secret and
independent `BETTER_AUTH_SECRET`, `INSTALLATION_ENCRYPTION_KEY`, and
`WEBHOOK_ENCRYPTION_KEY` values. Encryption keys must be canonical base64 for
exactly 32 bytes. For Railway’s template variable functions, use this expression
independently for each encryption key (the final character preserves base64 padding):

```text
${{secret(42, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}}${{secret(1, "AEIMQUYcgkosw048")}}=
```

Use `${{secret(64, "0123456789abcdef")}}` independently for
`INSTALLATION_DB_PASSWORD` and `BETTER_AUTH_SECRET`. Mark `STORYPANE_ADMIN_NAME`,
`STORYPANE_ADMIN_EMAIL`, and `STORYPANE_ADMIN_PASSWORD` as required deployment
inputs with no shared defaults. The admin password must contain 12–128 characters.
Set `AUTH_PROVIDER=local`, `PORT=3000`, and `S3_FORCE_PATH_STYLE=false`.

`prepare-railway.ts` is only for a dedicated template PostgreSQL service. It
refuses initial setup alongside unrelated databases, never changes existing role
passwords or database ownership, and uses the same bootstrap lock as the operator
CLI. Interrupted setup can be retried without recreating storage. On redeploy,
it migrates every registered space and stops the deployment if any migration fails.

If pre-deploy fails, inspect its logs for the specific validation field or setup
step printed before the final summary. Invalid initial admin fields include their
requirements; database failures identify the provisioning or installation connection
and report known authentication, permission, or network failures without credentials.
Correct the indicated variable or database permission and redeploy. Do not regenerate
keys or delete databases to retry setup. Initial admin fields are only required until
the first administrator exists.

For an **existing installation** with manually prepared databases, retain
`node --import tsx scripts/migrate-production.ts` as the pre-deploy command.
Do not switch it to automatic setup. Follow [database preparation](self-hosting.md)
for external servers. Never replace the installation credential with a superuser.

Generate the application's Railway public domain and set `STORYPANE_APP_URL`
to its full HTTPS origin, without a trailing slash. You can reference it as
`https://${{RAILWAY_PUBLIC_DOMAIN}}`, or use your custom domain. The application
requires this explicit origin on every host. In Clerk mode, configure that origin
in Clerk. New Railway buckets use virtual-hosted addressing; older buckets may require
`S3_FORCE_PATH_STYLE=true`, as indicated in their Credentials tab.

After sign-in, use the [recommended team setup](development-workflow.md): create
production for content editors, leave its schema read-only, and create linked dev
spaces for developers. These are Storypane spaces with separate databases inside
one CMS installation; they are not Railway project environments.

## Build and operate

```sh
pnpm install --frozen-lockfile
pnpm --filter @storypane/sdk build
pnpm --filter @storypane/web build
# With runtime variables provided:
pnpm --filter @storypane/web start
# Or build the same container Railway uses:
docker build -t storypane .
```

The template pre-deploy command runs `scripts/prepare-railway.ts`. The runner
uses separate transactional migration histories and visits every registered space.
`/api/ready` reports installation readiness and degraded space availability;
it does not prove sign-in, media or background publishing. The template contains exactly these three resources, wires their references,
generates independent secrets per deployment, and exposes only the application.
Use the [acceptance checklist](deployment-verification.md) before recommending a
new template revision. Never copy verification-project secrets into a public template.

Drafts, leases, schedules, upload IDs and webhook jobs are in Postgres. Restarting
loses only connected sockets; clients reconnect and recover committed state. The
publication and webhook schedulers run immediately on startup and every minute.
Each skips its own overlapping runs and retries persisted work through the existing
database services. Slow webhook delivery does not hold up scheduled publishing.

Original objects stay private and stream through authorized routes, including
range requests. Grant the storage credential read, write, multipart-upload and
delete permissions: discarding an unfinished upload removes its stored bytes,
while completed originals are preserved. Multipart IDs and ETags retain the existing API shape. Sharp
handles bounded image variants and focal crops. Variants currently recompute on
demand; add a bounded cache if profiling shows it is needed. Images above 20 MiB
keep original downloads but cannot be transformed.

Back up the installation database, every space database, bucket contents and all encryption/auth keys before upgrades. Preserve
service references and review your source modifications against upstream changes.
If a release fails, inspect build/runtime logs and `/api/ready`; never recreate
the database or bucket as a troubleshooting step. For 401/403 check the selected auth provider/origin
and current membership. For S3 errors check region, endpoint, credentials and URL
style. For missed scheduled work check that the application is awake and healthy.

References: [Railway buckets](https://docs.railway.com/storage-buckets),
[variables](https://docs.railway.com/variables),
[vinext](https://github.com/cloudflare/vinext),
[Sharp](https://sharp.pixelplumbing.com/api-resize/).

## Update an existing deployment

Update the application service in the existing Railway project. The template
tracks `main`; publishing an npm SDK version does not update the hosted CMS.

1. Review the [changelog](../CHANGELOG.md) and back up the installation database,
   every space database, bucket originals, variables, and encryption/auth keys.
2. For a template deployment, open the existing project and apply its available
   upstream update notification. If you use your own fork, merge the new release
   into the branch connected under the application's service settings first.
3. Deploy the updated source. Connected GitHub autodeploys can do this after the
   source update; otherwise use **Command Palette → Deploy Latest Commit**
   (`Cmd/Ctrl+K`). Check the deployment's commit against the intended release.
   **Redeploy** on an older deployment rebuilds that deployment's source; it does
   not select the newest release. Restart reuses its existing image.
4. Keep the existing database/bucket references and keys. Template installations
   retain `node --import tsx scripts/prepare-railway.ts` as their pre-deploy command;
   manually prepared installations retain `node --import tsx scripts/migrate-production.ts`.
   Both run pending transactional migrations. rc.7 adds no migrations beyond rc.6.
5. Check the pre-deploy/build/runtime logs and `/api/ready`, then verify sign-in,
   an existing story, media, and saving content. Confirm one replica and sleeping
   disabled. Do not recreate services or rerun initial administrator setup.

If an upgrade fails, inspect the failing step before retrying. Do not regenerate
keys or delete storage. A previous application image does not undo database
migrations; use a coordinated backup restore when database rollback is needed.

See Railway's [template updates](https://docs.railway.com/templates/updates),
[deployment actions](https://docs.railway.com/deployments/deployment-actions), and
[GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys).

## Repeat the operational checks

Use the [operational regression runner](deployment-verification.md#repeatable-operational-regressions)
to provision a disposable template in an explicitly selected Railway workspace.
It tests crashes, scheduled work, scoped access, database outages and recovery
from a coordinated backup, then removes its hosted resources. Never point these
destructive checks at an existing installation.

## Scale published delivery separately

The default `STORYPANE_SERVICE=combined` keeps the existing one-service setup.
For independent website capacity, add a second application service from the same
repository revision and Docker image with `STORYPANE_SERVICE=delivery`. Keep the
image's default start command and `/api/ready` healthcheck. This mode starts a
small HTTP server using the existing delivery handlers; it does not start vinext's
editor server, collaboration rooms, or publication/webhook schedulers.

1. Keep the original application on `combined`, one replica, and sleeping disabled.
   It continues to serve editors, management, schema tooling, live preview and
   scheduled work. Existing delivery URLs continue to work.
2. Give the delivery service the same runtime database, encryption, authentication
   and private-storage variables. `STORYPANE_APP_URL` must remain the **editor's**
   HTTPS origin. Omit `PROVISIONING_DATABASE_URL` and initial administrator inputs;
   delivery does not provision databases. Do not run setup or migrations on this
   service: keep pre-deploy migrations on the original application and complete
   them before rolling out a compatible delivery revision.
3. Assign the delivery service its own HTTPS domain and disable sleeping. Increase
   its replica count in Railway as needed, initially in the same region as Postgres.
   Its allowlist is `GET`/`HEAD` on `/api/delivery/stories`,
   `/api/delivery/locales`, `/api/delivery/assets`, `/media/:space/:asset/original`,
   `/media/:space/:asset/image`, and `/api/ready`, plus delivery CORS preflights.
   Preview, schema, management, editor and WebSocket routes are unavailable.
4. Set `STORYPANE_DELIVERY_URL` to that origin in either example website and rebuild
   it. Leave `STORYPANE_URL` pointing at the editor for preview and schema tooling.
   With your own SDK integration, point the published-content client's `url` at
   delivery and keep preview/schema clients and `connectPreview.cmsUrl` on the
   editor origin. For public-media URLs, use the delivery origin in `publicAssetUrl`.
5. Verify token rejection, published content, private/unpublished asset rejection,
   ranges/HEAD, public-media opt-in, and live preview on the editor origin. Then
   exercise simultaneous editor joins and website reads across delivery replicas.
   Stop the editor briefly in a disposable installation and confirm existing
   publications still read from delivery. Check health and database connections
   before increasing replicas further. See the [scoped hosted results](deployment-verification.md#separate-delivery-hosted-checks--2026-11-09);
   multi-replica and load acceptance remain open. These checks do not establish a
   safe capacity target.

Delivery reads the same authoritative databases and private storage directly, so
it does not depend on the editor process being available. Both services still
depend on Postgres and storage; editor load can still contend for database CPU,
I/O, locks and connections. Delivery responses retain their existing authorization
and `no-store` behavior.

### Database connection budget

Each application process has a five-connection installation pool and permits up to
16 concurrent space acquisitions. Each acquisition creates a short-lived pool
with at most two space connections, then closes it. These are request/operation
limits, not a limit of 16 connected editor browsers: idle WebSockets hold no
space database acquisition. Splitting services separates these admission limits.
Budget up to 37 ordinary runtime connections per replica across the installation
and space databases, with additional headroom for provisioning, migrations,
operators and other applications. This is a conservative pool ceiling, not an
expected idle connection count.

A shared transaction pooler such as [PgBouncer](https://www.pgbouncer.org/features.html) can reduce backend connection churn
and bound physical PostgreSQL connections across replicas. It does not remove the
application's 16-acquisition guard, speed up overloaded SQL, or coordinate
in-memory collaboration rooms. Session advisory locks used by operator/provisioning
commands also require suitable pooling semantics; do not redirect those commands
through transaction pooling without verifying their locking behavior. This change
does not introduce or configure a database pooler.

## Optional Cloudflare image CDN

Images work immediately using Storypane’s existing image service: private originals
stay in the bucket, and Sharp resizes, crops, and compresses authorized requests.
This happens on the application server. Cloudflare image transformations are a
separate integration for edge optimization; the Railway button does not configure
a Cloudflare account, domain, plan, or cache rules.

Cloudflare can [transform images from a remote origin](https://developers.cloudflare.com/images/optimization/transformations/overview/),
including resizing, quality control, and automatic format selection. Keep the
Railway bucket private and use only Storypane’s authorized public-media route as
the public source. Drafts, previews, private assets, and editor/API responses must
retain their access checks and must not enter a shared public cache.

Storypane currently sends `Cache-Control: no-store` on public-media responses.
Do not override that with a broad “cache everything” rule: unpublishing an asset
must not leave an accessible cached copy. Edge caching needs a separately verified
invalidation policy and versioned image URLs before it is enabled. This is not a
prerequisite for using the Railway installation. See
[Cloudflare image options](https://developers.cloudflare.com/images/optimization/features/)
and [pricing](https://developers.cloudflare.com/images/pricing/) when planning that setup.
