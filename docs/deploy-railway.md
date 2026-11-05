# Railway readiness and setup

Status: Node runtime and Docker packaging are implemented locally; no fresh
Railway installation or shareable hosted template has been verified. Do not enable
a deploy button until [acceptance](deployment-verification.md) passes.

The Node runtime reuses vinext's standalone production server, the frontend,
Postgres model, Clerk authentication, HTTP APIs, asset authorization and shared
room logic. The Docker image retains workspace source and the installed `tsx`
loader for those internal runtime packages. It runs one application process for
HTTP, WebSockets and the minute publishing/webhook scheduler. No Cloudflare
account or service is required for this runtime.

## Services and references

Create a Railway project with an application from this repository, Railway
Postgres, and a private Storage Bucket. Name the supporting services `Postgres`
and `Bucket` when using these references. Keep **one application replica** and
**sleeping disabled**. `railway.json` selects the Dockerfile, pre-deploy migration,
readiness endpoint and these runtime settings. Do not scale replicas without a
shared room transport; in-memory recipients would otherwise miss notifications.

Set application variables using Railway's reference syntax:

| Application variable   | Value                           |
| ---------------------- | ------------------------------- |
| `DATABASE_URL`         | `${{Postgres.DATABASE_URL}}`    |
| `S3_ENDPOINT`          | `${{Bucket.ENDPOINT}}`          |
| `S3_REGION`            | `${{Bucket.REGION}}`            |
| `S3_BUCKET`            | `${{Bucket.BUCKET}}`            |
| `S3_ACCESS_KEY_ID`     | `${{Bucket.ACCESS_KEY_ID}}`     |
| `S3_SECRET_ACCESS_KEY` | `${{Bucket.SECRET_ACCESS_KEY}}` |

Add operator-provided `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` from the
same Clerk instance. Generate a random 32-byte base64 `WEBHOOK_ENCRYPTION_KEY`
locally into a private file and enter it as a sealed Railway variable; never
commit, print in logs, or regenerate it during upgrades. Keep a secure backup.
Optional `WEBHOOK_HOSTS` and `EXTERNAL_OPTION_HOSTS` are exact approved hostnames.

Generate the application's Railway public domain. The application defaults to
`https://RAILWAY_PUBLIC_DOMAIN`; set `STORYPANE_APP_URL` only for a different HTTPS
origin, without a trailing slash. Configure that origin in Clerk. New Railway
buckets use virtual-hosted addressing; older buckets may require
`S3_FORCE_PATH_STYLE=true`, as indicated in their Credentials tab.

## Build and operate

```sh
pnpm install --frozen-lockfile
pnpm --filter @storypane/sdk build
pnpm --filter @storypane/web build:node
# With runtime variables provided:
pnpm --filter @storypane/web start:node
# Or build the same container Railway uses:
docker build -t storypane .
```

`railway.json` runs `scripts/migrate-production.ts` before deployment. The runner
uses one transaction and advisory lock. `/api/ready` checks database connectivity;
it does not prove sign-in, media or background publishing. Follow acceptance before
publishing a template. The template should contain exactly these three services,
wire the references above, request the Clerk keys, generate the encryption secret
once, and expose only the application. Save/share it from Railway only after the
fresh project passes; no template URL is invented in the website.

Drafts, leases, schedules, upload IDs and webhook jobs are in Postgres. Restarting
loses only connected sockets; clients reconnect and recover committed state. The
scheduler runs immediately on startup and every minute, skips overlapping local
runs, and retries persisted work through the existing database services.

Original objects stay private and stream through authorized routes, including
range requests. Multipart IDs and ETags retain the existing API shape. Sharp
handles bounded image variants and focal crops. Variants currently recompute on
demand; add a bounded cache if profiling shows it is needed. Images above 20 MiB
keep original downloads but cannot be transformed.

Back up Postgres, bucket contents and encryption key before upgrades. Preserve
service references and review your source modifications against upstream changes.
If a release fails, inspect build/runtime logs and `/api/ready`; never recreate
the database or bucket as a troubleshooting step. For 401/403 check Clerk/origin
and current membership. For S3 errors check region, endpoint, credentials and URL
style. For missed scheduled work check that the application is awake and healthy.

References: [Railway buckets](https://docs.railway.com/storage-buckets),
[variables](https://docs.railway.com/variables),
[vinext](https://github.com/cloudflare/vinext),
[Sharp](https://sharp.pixelplumbing.com/api-resize/).
