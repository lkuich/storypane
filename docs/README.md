# Documentation index

New teams should use [production for editors and linked dev spaces for developers](development-workflow.md).
That guide covers cloning, environment switching, schema promotion, and keeping developers in sync.

Follow the modules below in order, or jump to the topic you need.

## Install Storypane

Already have an instance? Start with content and schemas below.

- [Local setup](getting-started.md): run Storypane locally or develop from source,
  with copyable instructions for a coding agent.
- [Node installations](self-hosting.md): Docker setup, external Postgres and storage,
  authentication, operator commands, upgrades, backups, and recovery.
- [Portable hosting and backups](self-hosting.md#backups-upgrades-and-health): move
  regions or cloud hosts, enable provider-managed backups, and preserve media and keys.

## Migrate from Storyblok

- [Agent-led Storyblok migration](migrate-from-storyblok.md): map familiar blocks,
  import content, assets and locales, validate references, and plan the cutover.

## Content and schemas

- [Production and development spaces](development-workflow.md): the recommended
  team setup, schema promotion, and keeping linked dev spaces in sync.
- [Editor quickstart](editor-quickstart.md): build a schema in dev, promote it,
  and publish your first page in production.
- [Content releases](releases.md): schedule approved page revisions and nested
  blocks together, manage later edits, and resolve conflicts before a launch.

## Build your website

Explore the SDK, then choose the integration guide for your framework.

- [SDK guide](../packages/sdk/README.md): delivery, preview, media, migrations,
  generated types, and management clients.
- [Astro example](../apps/example-astro/README.md): static pages and authenticated preview.
- [Next.js example](../apps/example-next/README.md): generated content types and authenticated preview.

## Agents and automation

- [For agents](https://storypane.dev/docs/agents/): setup prompts, downloadable
  skills, and MCP connections.
- [Management API, SDK, CLI, and MCP](management-api.md): credentials and automation.
- [Webhooks](webhooks.md): signed deliveries, event names, receiver validation, and retries.

## Deployment references

- [Cloudflare](deploy-cloudflare.md): Cloudflare Workers Static Assets for the static website and
  status of the previous CMS Worker runtime.
- [Railway](deploy-railway.md): independent Node runtime status and deployment notes.
- [Deployment verification](deployment-verification.md): current acceptance status and
  requirements for hosted installations.

## Documentation sources

[Initial implementation record](work-breakdown.md) and
[local tag-restriction cleanup](tag-restriction-cleanup.md) contain historical
plans or implementation records. They are not installation instructions or a source
of current product behavior.

The canonical Markdown lives in this repository. The website mirrors the
maintained guides under `/docs/`; update the published copy from the website repo
with `pnpm docs:sync` after changing a canonical guide. The website build uses the
committed mirror and does not require this repository at build time.
