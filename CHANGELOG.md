# Changelog

## 0.1.0-rc.6 — 2026-11-07

- Allow requesters and space admins to delete reviews and discussions from inbox rows or thread details with confirmation. Remove duplicate story context and requester metadata from review details.

- Split personal block hover previews into Content editor, Add block pane, and Blocks table settings. The Block library now previews configured samples on hover or keyboard focus using the existing authenticated iframe. Upgrade migration preserves previous choices.

- Create independent locale pages from Default, including page fields and selected
  sections. Review later source changes without overwriting translations by default.
- Add explicit linking for existing locale copies, scoped block updates, translation
  review markers, and safe update selection. Space migration 033 retains source
  baselines and mappings; legacy database splitting preserves these relationships.

- Improve Railway setup failure diagnostics.
- Advance CMS and SDK versions together; no new public SDK API. Apply migration
  033 with the transactional production migration runner before using source review.

See [Locales and source updates](docs/locales.md). Existing locale copies require
one-time explicit linking; translations and publishing remain independent.

## 0.1.0-rc.5 — 2026-11-07

- Add story and block reviews, comments, inline @mentions, and a Reviews inbox.
  Teams live under Members & roles with configurable approval thresholds.
- Enforce review approvals at publication and scheduling boundaries, preserving
  content scopes and invalidating approvals when reviewed content changes.
- Unify comment and review composition, add block-row comment buttons, and
  improve invitations, empty states, refresh controls, and the page map height.
- Display selected blocks without waiting for the previous edit lock to release;
  protect rapid navigation and new leases from stale snapshots. Load rich-text
  code on demand and keep hover previews stable across unrelated lock updates.
- Add a personal block hover preview setting under API & preview.
- Add the optional nested-block filter and simplify pinned-story rows.
- Preview saved release versions read-only and retain review decisions by content
  version, keeping later draft changes separate from approved releases.
- Preserve review messages, decisions and Teams when splitting a legacy multi-space
  database into dedicated databases.
- Advance CMS and SDK versions together; there is no new SDK API in this candidate.
  Apply space migrations 030 (reviews and Teams), 031 (personal block previews),
  and 032 (release previews and versioned review decisions) with the transactional
  migration runner. Preserve databases, media and keys.

See [Reviews and comments](docs/reviews.md) and the
[verification record](docs/deployment-verification.md). This is an evaluation
candidate, not a stable production release.

## 0.1.0-rc.4 — 2026-11-07

- The release gate caught missing legacy-split filters for the new review tables.
  The tag remains in history; no GitHub release or npm package was published.
  rc.5 includes the fix and the complete review/editor changes.

## 0.1.0-rc.3 — 2026-11-06

- Prepare fresh Railway installations automatically, including the isolated
  installation database and first administrator. Record scoped hosted verification.
- Add authenticated component hover previews and explicit sample-data previews in
  the block picker, with matching SDK callbacks and both example integrations.
- Add a read-only page map below live preview, loaded on expansion, with a
  transactional connection index and an upgrade backfill.
- Add personal preview defaults with the shared space default as fallback, plus
  desktop/tablet/mobile preview sizes and inline sizing controls.
- Add an SEO/AI metadata preset and published Markdown examples.
- Preserve rich-text cursor/selection through autosave, focus publication reviews
  on changed components, and improve block insertion and asset publication status.
- Advance the CMS and SDK together. Upgrades apply space migrations 028 and 029
  through the transactional migration runner; preserve coordinated backups and keys.

This remains an evaluation candidate. Full hosted acceptance, backup/restore
rehearsal, independent security review and production load benchmarks remain
outstanding; see [verification results](docs/deployment-verification.md).

## 0.1.0-rc.2 — 2026-11-06

- Publish the verified SDK archive to npm and configure the GitHub trusted
  publisher. A clean registry install loads all entrypoints and starts the CLI.
  The `rc` tag points to this candidate; npm also assigned `latest` on first
  publication. This does not change its release-candidate status.

- Align three legacy database test guards/defaults with the documented
  `POSTGRES_DB` and `storypane_test` setup. Preserve the localhost/dedicated-test
  database restriction. Clean GitHub CI exposed the old hardcoded `blok_test` names.
- Advance the app and SDK together. The rc.1 tag remains in history, but its
  release gate failed and no rc.1 GitHub package or npm version was published.
- All features and known limits below remain applicable.

## 0.1.0-rc.1 — 2026-11-06

First public release candidate. Intended for evaluation and migration rehearsals;
not a stable production release or a fresh-hosted-install verification claim.

- Node/Docker CMS with an installation database, a separate PostgreSQL database
  per space, and private S3-compatible media with Sharp image processing.
- Invitation-only local sign-in, optional Clerk, roles/content scopes, and
  operator-led recovery and identity-preserving provider migration.
- Block-level collaborative editing, independent locales, live preview, content
  history, reviewed publishing, and scheduled content releases.
- Linked development spaces, reviewed schema promotion/sync, and generated types.
- SDK delivery and preview clients, management API, CLI, MCP, and signed webhooks.
- Getting-started, editor, authentication, operations, Storyblok migration, privacy,
  and release guides, mirrored at https://storypane.dev/docs/.
- CI for lint, type checks, database/isolation tests, production and Docker builds,
  and installation checks against the packed SDK. RC release artifacts and an
  opt-in npm trusted-publishing workflow target the `rc` channel.

- Update Vite to 8.3.5 and fflate to 0.7.5 to address dependency advisories found
  during the release review; preserve third-party service notices.

### Known limits

- One app replica; keep sleeping disabled on hosts that offer it.
- Fresh hosted Node/Railway acceptance remains unverified. Cloudflare hosts the
  static website only. There is no supported CMS Worker deployment.
- Built-in MFA/SSO and complete privacy-request/retention automation are not included.
- No independent security audit or production load benchmark has been completed.
- A moderate development-tool minimatch advisory remains in ESLint’s dependency
  graph; see the release guide. The production dependency audit has no known advisories.
- API/schema behavior can change during the RC series. Database rollback means
  restoring a coordinated backup, not running automatic down migrations.
- The SDK tarball is available with the GitHub prerelease once CI succeeds.
  npm publication requires scope ownership and publisher setup; no registry
  availability is implied by this changelog.
