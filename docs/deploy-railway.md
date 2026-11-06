# Railway readiness and setup

Status: Node runtime and Docker packaging are implemented locally; no fresh
Railway installation or shareable hosted template has been verified. Do not enable
a deploy button until [acceptance](deployment-verification.md) passes.

The Node runtime reuses vinext's standalone production server, the frontend,
Postgres model, local or Clerk authentication, HTTP APIs, asset authorization and shared
room logic. The Docker image retains workspace source and the installed `tsx`
loader for those internal runtime packages. It runs one application process for
HTTP, WebSockets and independent minute schedulers for publishing and webhooks. No Cloudflare
account or service is required for this runtime.

## Services and references

Create a Railway project with an application from this repository, Railway
Postgres, and a private Storage Bucket. Name the supporting services `Postgres`
and `Bucket` when using these references. Keep **one application replica** and
**sleeping disabled**. Configure the application service in Railway's dashboard;
provider settings are not part of the application's default build configuration.
Do not scale replicas without a shared room transport; in-memory recipients would
otherwise miss notifications.

| Service setting                  | Value                                             |
| -------------------------------- | ------------------------------------------------- |
| Root directory                   | Repository root                                   |
| Builder                          | Dockerfile                                        |
| Dockerfile path                  | `Dockerfile`                                      |
| Pre-deploy command               | `node --import tsx scripts/migrate-production.ts` |
| Start command                    | Use the Docker image's default command            |
| Healthcheck path / timeout       | `/api/ready` / 120 seconds                        |
| Restart policy / maximum retries | On failure / 10                                   |
| Replicas                         | 1                                                 |
| Sleeping                         | Disabled                                          |

For existing deployments, save these settings in the dashboard and clear any
custom config file path before upgrading. This repository no longer supplies
`railway.json`. Railway has [deprecated that configuration format](https://docs.railway.com/config-as-code);
new installations should use the service settings above.

Set application variables using Railway's reference syntax:

| Application variable        | Value                                        |
| --------------------------- | -------------------------------------------- |
| `INSTALLATION_DATABASE_URL` | Dedicated installation database URL          |
| `PROVISIONING_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (operator role) |
| `S3_ENDPOINT`               | `${{Bucket.ENDPOINT}}`                       |
| `S3_REGION`                 | `${{Bucket.REGION}}`                         |
| `S3_BUCKET`                 | `${{Bucket.BUCKET}}`                         |
| `S3_ACCESS_KEY_ID`          | `${{Bucket.ACCESS_KEY_ID}}`                  |
| `S3_SECRET_ACCESS_KEY`      | `${{Bucket.SECRET_ACCESS_KEY}}`              |

Follow [database preparation and bootstrap](self-hosting.md). Create a separate
installation database and role on the Railway Postgres service; do not use the
provisioning credential for ordinary requests. Space roles must have CONNECT only
to their own database, including revoking PUBLIC CONNECT on the other databases.
If the managed database does not allow role/database creation, attach dedicated
empty databases instead and omit `PROVISIONING_DATABASE_URL`.

Set `AUTH_PROVIDER=local` (the default), independent `BETTER_AUTH_SECRET`,
`INSTALLATION_ENCRYPTION_KEY`, and `WEBHOOK_ENCRYPTION_KEY` values. Retain all keys
on upgrades and keep backups. Clerk keys are required only when selecting
`AUTH_PROVIDER=clerk`. SMTP is optional. Run the operator CLI `bootstrap` through
an interactive Railway service shell; it reads the password without echo.
Optional `WEBHOOK_HOSTS` and `EXTERNAL_OPTION_HOSTS` are exact approved hostnames.

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

The pre-deploy command runs `scripts/migrate-production.ts`. The runner
uses separate transactional migration histories and visits every registered space.
`/api/ready` reports installation readiness and degraded space availability;
it does not prove sign-in, media or background publishing. Follow acceptance before
publishing a template. The template should contain exactly these three services,
wire the references above, generate the independent encryption/auth secrets once, and expose only the application. Save/share it from Railway only after the
fresh project passes; no template URL is invented in the website.

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
