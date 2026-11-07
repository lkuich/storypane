# Optional reviewer before publishing

Status: implemented in 0.1.0-rc.4.
Recorded: 2026-11-06. Updated: 2026-11-07.

The implemented workflow uses optional story/block review requests, Teams with
minimum approvals, and comments with inline mentions. Authoritative publication
and scheduling gates enforce the requirements without granting extra content
access or publishing permissions. See [Reviews and comments](../reviews.md) for
the shipped behavior and [Content releases](../releases.md) for pinned revisions.

Focused database tests cover scope enforcement, content-version invalidation,
team thresholds, scheduling and publication. Browser coverage exercises real
authentication, reviewer decisions, mentions and the unified composer. Hosted
multi-user acceptance remains part of the deployment checklist.
