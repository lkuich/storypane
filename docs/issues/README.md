# Internal issue tracker

The five selected gaps are implemented in the working tree. The backend, UI,
migrations, and tests are integrated. They remain IN PROGRESS until the listed
release checks are completed; no deployment or public-media opt-in has occurred.

Issue numbers preserve the product comparison. Only gaps 1–4 and 8 are in scope.

| Issue                                                            | Status      | Implemented                                                                         | Remaining verification                                                     |
| ---------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [001 — Story lifecycle and bulk actions](001-story-lifecycle.md) | IN PROGRESS | Unpublish, duplicate, delete/restore, reviewed bulk actions                         | Authenticated selection/recovery browser flows                             |
| [002 — Outbound webhooks](002-webhooks.md)                       | IN PROGRESS | Admin controls, signed transactional outbox, retries, logs, receiver example        | Authenticated admin flow and external HTTPS receiver/deployed delivery     |
| [003 — Scheduled publishing](003-scheduled-publishing.md)        | IN PROGRESS | Fixed checkpoints, timezone/DST validation, durable minute runner                   | Connected-editor browser flow and deployed cron                            |
| [004 — Production media delivery](004-production-media.md)       | IN PROGRESS | Opt-in public URLs, bounded transforms, focal editor, scoped usage, SDK helper      | Authenticated asset flow and deployed Images focal/aspect/animation checks |
| [008 — Scoped content permissions](008-scoped-permissions.md)    | IN PROGRESS | Read/edit/publish scopes, server projection, safe mutations, per-recipient realtime | Authenticated two-user collaboration/revocation browser flow               |

Local verification: 311 unit/Postgres tests pass, plus full typechecking, lint, a
production build, five role/webhook browser component journeys, focal-control browser checks,
and two actual local Worker cron invocations. The cron fixture confirmed one
publication/event/delivery attempt without duplicates or external requests.
Authenticated browser suites require Clerk storage-state files; none are available.
Miniflare ignores numeric image gravity, so local center-crop success does not
verify deployed focal-point placement.

Migrations 015–019 add the feature storage and backfill existing roles without
removing access. Webhooks require `WEBHOOK_ENCRYPTION_KEY` and `WEBHOOK_HOSTS`;
see [configuration and receiver instructions](../webhooks.md). Public media remains
disabled until an administrator explicitly enables it for a space.

## Working conventions

- Keep one Markdown file per issue. Update its status here and in the file:
  TODO, IN PROGRESS, BLOCKED (with a concrete dependency), or DONE.
- An issue is done only when its acceptance checklist passes. Record the relevant
  test commands/results and implementation reference in the issue when completed.
- Behavior below is the proposed default. If implementation changes a decision,
  update the spec and the affected linked issues together.
- Add migrations through the existing migration runner. Choose the next migration
  number at implementation time; these specs do not reserve numbers.
- Reuse existing core validators, store transactions, UI controls, and bindings.
  Each issue lists callers, tests, configuration, and documentation it must reach.
- Preserve independent locale structures, immutable history, current credentials,
  and existing integrations. No content purge or public-media opt-in happens as a
  side effect of upgrading.

Scope excludes marketplace/integrations, MCP, the upcoming full CLI/management
API, approval workflows, and AI. Grouped releases, delivery-query expansion, and
the other unselected comparison items are not added to this backlog.
