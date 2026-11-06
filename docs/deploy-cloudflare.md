> This guide describes the previous shared-database release. The current Node
> installation/space layout is unsupported on Cloudflare and its deployment
> preflight rejects it. Keep existing Workers installations on the previous
> supported release; see [Node self-hosting](self-hosting.md) for migration.

# Cloudflare setup

Status: setup automation is implemented; a fresh installation has not yet passed
acceptance. The website links to this guided flow, not a one-click deploy action.

## Prerequisites

Use Node 24.22+ within v24 and pnpm 12.4.2. Bring a Cloudflare account with Workers,
Durable Objects, R2, Images transformations and Hyperdrive available, a Postgres
connection, and Clerk keys. Enable Images transformations for the account.
Neon is the default Postgres recommendation: create a separate database/branch,
copy its **direct** Postgres connection string with TLS enabled, and retain backups.
The application also works with another reachable Postgres provider.

Authenticate `cf` in your terminal or provide `CLOUDFLARE_API_TOKEN` to the process.
Select the account explicitly; never trust the machine's default login. Token
permissions must cover Workers deployments, R2, Durable Objects and Hyperdrive;
custom domains additionally require access to the zone. Do not paste tokens into
commands, docs, screenshots, or source control.

## Configure and deploy

```sh
pnpm install --frozen-lockfile
cp .env.production.example .env.production
```

Fill in `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`, `DATABASE_URL`, and
unique Worker and R2 names. Omit `STORYPANE_APP_URL` and `STORYPANE_DOMAIN` to use
`https://<web-worker>.<your-subdomain>.workers.dev`. The subdomain is shown in
Cloudflare Workers & Pages. For a custom domain, set both fields and ensure the
zone belongs to the selected account. Configure the same origin in Clerk.

Create the JSON file named by `STORYPANE_SECRETS_FILE` (default
`.env.production.secrets.json`) with `CLERK_SECRET_KEY` and
`VITE_CLERK_PUBLISHABLE_KEY`. Restrict it to owner read/write (`chmod 600`). Both
must belong to the same Clerk application. Use production Clerk keys for launch.
For a new installation the command generates and persists a random 32-byte
`WEBHOOK_ENCRYPTION_KEY` without printing it. Back up this file securely. Existing
installations must restore their original key; generating a replacement makes
stored webhook secrets unreadable.

```sh
pnpm deploy:cloudflare --check
pnpm deploy:cloudflare
```

The check validates local configuration without accessing resources. Deployment
finds or creates a Hyperdrive named after the web Worker, verifies its origin
matches the migration database and **query caching is disabled**, saves the ID,
applies migrations, builds both Workers, and deploys realtime before web. `cf`
provisions or reconnects the named R2 bucket and Durable Object binding. The
command polls `/api/ready` after deployment; this checks database connectivity,
not the complete user journey. Finish [acceptance](deployment-verification.md).

Setup stops on an error and deletes no resources. If a partially completed setup
exists, keep its names and saved files and retry. If multiple Hyperdrives share a
name, select an explicit `HYPERDRIVE_ID`. Never point a new installation at another
installation's resources. Keep R2 private; media routes enforce authorization.

## Upgrades and recovery

Back up Postgres, original assets, and the encryption key before upgrading. Review
migrations and your local modifications. `pnpm deploy:cloudflare` applies pending
migrations using the advisory-lock-protected transactional runner. To apply only
migrations, use `pnpm db:migrate:production`; it requires `DATABASE_URL` and has no
fallback. `pnpm db:setup` remains local-only. No migration history is reset.

The existing owner's IDs/domain live in ignored `.env.production`; keep that file
when updating. Process environment values override it. Rebuild after configuration
changes. Preserve names, database, bucket, Durable Object namespace and encryption
key across releases. To roll back a destructive database migration, restore a
compatible database backup along with the matching code; do not merely deploy old
code over a newer schema.

For 503 readiness, check the migration target, Hyperdrive origin/TLS and database
access. Stale permissions usually indicate Hyperdrive query caching was enabled.
For sign-in errors, check matching Clerk keys, session activation, verified email
and configured origin. For image failures check Images access and the 20 MiB input
limit. For webhook failures check `WEBHOOK_HOSTS` and the original encryption key.
See [webhooks](webhooks.md) for receiver setup.

References: [cf projects](https://developers.cloudflare.com/cf/projects/),
[Hyperdrive caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/),
[Images binding](https://developers.cloudflare.com/images/optimization/binding/).
