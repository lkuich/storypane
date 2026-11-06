# Cloudflare: static website hosting and CMS status

Cloudflare hosts the static Storypane marketing website using Workers Static
Assets. The current CMS runs separately on Node with PostgreSQL and private S3
storage. The website deployment contains static files only: no CMS server code,
Clerk keys, database connections, Durable Objects, or media bucket bindings.

## Current storypane.dev deployment

The static website is live on `storypane.dev` as of November 5, 2026. The previous
`storypane-web` and `storypane-realtime` Workers, realtime room namespace, and
unused `storypane-postgres` Hyperdrive configuration have been retired. PostgreSQL,
the private `storypane-assets` R2 bucket, backups, and encryption keys were retained.
This verifies website hosting and legacy compute removal; CMS installation
acceptance remains a separate checklist.

## Deploy the website

Use the [storypane-www repository](https://github.com/lkuich/storypane-www), Node
24.22+ within v24, and pnpm 12.4.2. Authenticate `cf` with the account that owns the
domain. Set the account explicitly; do not rely on the CLI's default account.

From the website checkout:

```sh
pnpm install --frozen-lockfile
CLOUDFLARE_ACCOUNT_ID=<your-account-id> \
STORYPANE_WEBSITE_DOMAIN=storypane.dev pnpm deploy:cloudflare
```

The command builds the Astro site, packages `dist` using Cloudflare's Build Output
Specification, validates that no Worker code or service bindings are included,
and runs `cf deploy --prebuilt`. The static deployment is named `storypane-www`.
The account ID is configuration, not a CMS credential. Keep account-specific
settings outside committed files. Deployment is manual after pushing source;
GitHub pushes do not automatically deploy the site.

For a first deployment, omit `STORYPANE_WEBSITE_DOMAIN` to upload to its
`workers.dev` URL. Check the home page, `/docs/`, guide links, assets, and metadata
there before moving the domain. Subsequent production deployments must set
`STORYPANE_WEBSITE_DOMAIN=storypane.dev` to retain the custom domain.

See [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/)
and [cf prebuilt deployment](https://developers.cloudflare.com/cf/projects/#deploy).

## Retire a previous CMS installation

The old `storypane-web` and `storypane-realtime` Workers serve the previous CMS,
not the marketing website. The CMS repository's `deploy:cloudflare` command rejects
this release; the website command above runs from a different repository.

Inventory the actual account and verify the new website before moving the domain.
Remove the old web Worker first so its scheduled jobs stop and its reference to
the realtime Worker is released. Then retire the realtime Worker and its room
namespace. Remove the old Hyperdrive connection only when no remaining Worker
uses it. Keep PostgreSQL, original R2 media, database backups, and encryption keys
unless the operator explicitly requests permanent data deletion. Taking compute
offline does not require deleting content or media.
