# Documentation index

New teams should use [production for editors and linked dev spaces for developers](development-workflow.md).
That guide covers cloning, environment switching, schema promotion, and keeping developers in sync.

To install the CMS, start with [Install Storypane](getting-started.md). To build
and publish your first page, follow the [editor quickstart](editor-quickstart.md).

- [Node installations](self-hosting.md): Docker setup, external Postgres and storage,
  authentication, operator commands, upgrades, backups, and recovery.
- [Cloudflare](deploy-cloudflare.md): Cloudflare Workers Static Assets for the static website and
  status of the previous CMS Worker runtime.
- [Railway](deploy-railway.md): independent Node runtime status and deployment notes.
- [Management API, SDK, CLI, and MCP](management-api.md): credentials and automation.
- [Webhooks](webhooks.md): signed deliveries, event names, receiver validation, and retries.
- [Deployment verification](deployment-verification.md): current acceptance status and
  requirements for hosted installations.
- [Astro example](../apps/example-astro/README.md) and
  [Next.js example](../apps/example-next/README.md): integrate a published website
  and authenticated preview.
- [SDK guide](../packages/sdk/README.md): delivery, preview, media, migrations,
  generated types, and management clients.

[Initial implementation record](work-breakdown.md) and
[local tag-restriction cleanup](tag-restriction-cleanup.md) contain historical
plans or implementation records. They are not installation instructions or a source
of current product behavior.

The canonical Markdown lives in this repository. The website mirrors the
maintained guides under `/docs/`; update the published copy from the website repo
with `pnpm docs:sync` after changing a canonical guide. The website build uses the
committed mirror and does not require this repository at build time.
