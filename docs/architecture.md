# Storypane architecture

Storypane has three main parts: a Node application, PostgreSQL databases, and
private S3-compatible file storage. Your public website is a separate application
that reads published content through the Storypane SDK or delivery API.

The Node application serves the React editor and runs the APIs, live collaboration,
and background jobs together. This describes the current Node/Docker release.

![The editor browser and your website connect to one Storypane Node application. The application uses an installation PostgreSQL database, separate PostgreSQL databases for spaces, and private S3-compatible media storage.](images/architecture.svg)

## What runs where

| Part                   | Responsibility                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor in the browser  | Shows stories, block fields, media, reviews, and your website's live preview. Sends edits to the CMS.                                              |
| Node application       | Serves the editor and HTTP APIs, checks access, manages collaboration sockets, processes images, and runs scheduled work.                          |
| Installation database  | Holds installation identities, local authentication records, administrator privileges, and the registry of space database connections.             |
| Space databases        | Each space stores its schemas, content, memberships, roles, history, publications, asset metadata, and queued work in its own PostgreSQL database. |
| Private object storage | Holds uploaded original files. The CMS controls access and produces resized or compressed images.                                                  |
| Your website           | Uses your components and routing to turn published content into pages, at build time or when a visitor requests them.                              |

The databases can share one PostgreSQL server. A database per space does not require
a separate server per space. Operators can also attach databases on other
PostgreSQL hosts. The bundled Docker setup runs the app, PostgreSQL, and MinIO;
the Railway template provisions the app, PostgreSQL, and a private bucket.

## A space is a data boundary

An installation is the CMS you deploy. A space is an independent content workspace
inside it, with its own database and dedicated database credentials.

After checking the user's session, the application resolves the requested space
through the installation registry and connects to that space's database. Connection
credentials are encrypted in the registry. Space membership, roles, and content
scopes determine what the user can read, edit, review, or publish.

Built-in Better Auth sign-in is the default. Optional Clerk or a custom server
authentication adapter establishes identity; Storypane still enforces installation
privileges and space permissions. See [authentication](authentication.md) and
[database isolation and hosting](self-hosting.md#existing-postgresql-and-object-storage).

## From editing to a published page

1. **Define the structure.** Developers create content types and reusable blocks.
   A page has a root block and nested blocks; fields describe text, media, links,
   and other content. Each locale has its own content and publication.
2. **Edit and save.** The editor sends changes to the CMS. The server checks
   permissions, validates fields and revisions, and commits changes to PostgreSQL.
   A block lease is a temporary editing lock that prevents conflicting edits to
   the same block while teammates work on other blocks.
3. **Share live updates.** WebSocket rooms distribute presence and saved changes
   to editors and authenticated previews. Responses are filtered for each
   recipient's permissions. PostgreSQL holds the durable state; the room's
   in-memory connections are recreated after a restart.
4. **Review and publish.** Publication selects a saved checkpoint, checks required
   approvals and linked content, and records the published version transactionally.
   Later draft edits remain separate. A content release can schedule approved
   page revisions to publish together.
5. **Render your website.** Your server or build uses a published-content token
   to fetch JSON through the SDK or delivery API. Your components render it.
   Static sites rebuild or revalidate when content changes; request-rendered
   sites fetch it as needed. Keep delivery and management credentials on the server.

Live preview uses a separate authenticated path to draft content. The editor embeds
your frontend in an iframe, and the SDK connects it to a temporary preview session.
Your frontend supplies the components and styles for both page and block previews.
An unpublished draft does not appear in ordinary published-content reads.

Start with the [editor quickstart](editor-quickstart.md), then follow the
[SDK](../packages/sdk/README.md), [Astro](../apps/example-astro/README.md), or
[Next.js](../apps/example-next/README.md) integration guide.

## Schemas and team environments

The recommended setup is one production space for editors and a linked development
space per developer. These are separate content databases within the same installation.

Developers change schemas in their dev spaces, review migrations, and promote
deployed changes to production. Schema promotion applies reviewed structural
changes to production content; it does not copy a developer's content or publish
drafts. Other developers explicitly sync from production before promoting their work.
See [production and development spaces](development-workflow.md).

## Media, automation, and scheduled work

Asset metadata lives in the space database; original bytes live in private object
storage under space-specific keys. The Node app handles uploads, access checks,
image resizing, and compression. Public delivery of published media is an explicit
option, and an edge image CDN can be configured separately. The bucket stays private.

Scripts and agents use the management API with scoped credentials. The SDK's
management client, CLI, and stdio MCP adapter call that API and follow the same
authorization and publishing rules. See [agents and automation](management-api.md).

Publication and webhook delivery have independent minute schedulers in the Node
process. Scheduled publications and webhook work are persisted in PostgreSQL;
webhooks use a transactional outbox and retry failed deliveries. A webhook can
trigger your site's rebuild or another integration. See [content releases](releases.md)
and [webhooks](webhooks.md).

## Deployment and scaling

Run **one application replica** in the current release. Collaboration rooms live
in that process, so adding app replicas requires a shared room transport first.
Keep the app running for live collaboration and scheduled work. Your public
website can use its own hosting and caching strategy independently.

Back up the installation database, every space database, original media,
configuration, and encryption keys together. A database-only backup cannot restore
the complete installation. Follow the [backup and upgrade guide](self-hosting.md#backups-upgrades-and-health).

`storypane.dev` is a separate static Astro marketing and documentation site, hosted
on Cloudflare Workers Static Assets. It is independent of a self-hosted CMS
installation. The CMS runs on Node/Docker; your own public website can use the
hosting and framework you choose.

## Where the code lives

These are code packages within the repository; the CMS deploys as one application.

| Directory                                 | Responsibility                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web`                                | React editor, authentication boundary, HTTP routes, and Node server.           |
| `apps/realtime`                           | Collaboration rooms, WebSocket messages, and recipient filtering.              |
| `packages/core`                           | Shared content contracts and validation.                                       |
| `packages/db`                             | Database transactions, permissions, migrations, history, and publishing.       |
| `packages/assets`                         | Uploads, asset access, and media delivery.                                     |
| `packages/runtime-node`                   | Node adapters for object storage, images, rooms, and scheduling.               |
| `packages/sdk`                            | Website delivery and preview clients, management client, CLI, and MCP adapter. |
| `packages/ui`                             | Shared editor controls.                                                        |
| `apps/example-astro`, `apps/example-next` | Separate example websites that integrate with the CMS.                         |

For installation instructions, continue with [local setup](getting-started.md),
[Railway](deploy-railway.md), or [self-hosting](self-hosting.md).
