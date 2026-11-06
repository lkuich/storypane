# Deploy Storypane on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/storypane?utm_medium=integration&utm_source=button&utm_campaign=storypane)

Deploy the **release candidate** into your own Railway workspace. The template
builds the public repository’s `main` branch; it does not pin a stable release.
See [recorded hosted checks and remaining acceptance](deployment-verification.md#railway-template-checks--2026-11-06)
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
