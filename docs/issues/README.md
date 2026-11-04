# Internal issue tracker

Implementation TODOs for Storypane. These are proposed specifications, not shipped
features. Investigated against the working tree and official documentation on
2026-11-04, including uncommitted asset-delivery changes.

Issue numbers preserve the numbered gaps from the product comparison. Only gaps
1–4 and 8 are queued here; the missing numbers are intentional.

| Issue | Status | Outcome | Dependencies |
| --- | --- | --- | --- |
| [001 — Story lifecycle and bulk actions](001-story-lifecycle.md) | TODO | Unpublish, duplicate, safely delete/restore, and act on selected stories | Existing checkpoints, publications, folders, and leases |
| [002 — Outbound webhooks](002-webhooks.md) | TODO | Reliably notify sites and services after committed changes | Hooks into 001 as its actions land; adds a durable delivery runner |
| [003 — Scheduled publishing](003-scheduled-publishing.md) | TODO | Publish an explicitly reviewed locale checkpoint at a future time | Coordinate lifecycle races with 001; reuse 002's cron entry point if present |
| [004 — Production media delivery](004-production-media.md) | TODO | Public published-media URLs, optimized images, focal points, and usage lookup | Existing R2/Images bindings; respect 001's publication/deletion state |
| [008 — Scoped content permissions](008-scoped-permissions.md) | TODO | Restrict reading, editing, and publishing by content location and identity | Integrate every content path, including 001–004 |

Suggested implementation order: 001, 002, 003, 004, then 008. Issue 008 is the
largest change; review its authorization contract before implementing the other
issues so new entry points use the same store-level authorization boundary.
There is no requirement to build a generic job system or policy framework first.

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
