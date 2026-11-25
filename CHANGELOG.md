# Changelog

## Unreleased

- Hide or show individual blocks in each locale. Visibility updates live preview immediately and takes effect on the website when published. Apply space migration `041_block_visibility` before rolling out the editor.

## 0.1.0-rc.17 — 2026-11-23

- Story and folder slug changes update open editors. The page location dialog starts on the displayed locale when there is one and previews the full localized URL. Publish the affected locales to make the new URLs live.
- Create draft releases without a date, then choose when to publish them. Apply space migration `039_draft_releases` when upgrading from rc.16.
- Rename component API names in schema migrations while preserving component identity.
- Live preview selections focus linked editor fields. The story pin now uses a row action, and the rich-text dark background works in production builds.
- Short bursts of concurrent requests wait for space database capacity.

## 0.1.0-rc.16 — 2026-11-20

- Click a locale name or checkbox to filter Content. This fixes a Chrome tab crash when clicking the name.
- Switch rich-text fields between white and dark editing backgrounds. Each browser remembers the choice for each field.
- Select **Now** in **New release** to queue approved pages for the next publication run as they are added. Choose **Schedule release** for a future date and time. Apply space migration `038_immediate_releases` before rolling out the editor.
- Bulk publication reviews limit concurrent requests. Spaces shows pending invitations, Clerk sign-in keeps device verification visible, and the workspace loader stays on screen during initialization.

## 0.1.0-rc.15 — 2026-11-19

- Show **Example page URL** only for URL folders. Switching folder types updates the dialog immediately.

## 0.1.0-rc.14 — 2026-11-19

- Choose **Organizational folder** in **Content → New folder** to group pages without adding a URL segment. The dialog previews a page URL for either folder type.
- Organizational folders have a dashed border and an **Editor only** label. URL folders inside them contribute their own segments. Story URLs remain unique per locale.
- Browse stories by locale from the Content root, or select several locales beside Filters. The unprefixed default has a **Shared** shortcut.

## 0.1.0-rc.13 — 2026-11-19

- Filter Content by locale to see its path and publication status. Shared stories list each available path.
- Choose a starting locale for a new story. Add and exclude individual versions while retaining their drafts and history. Opening a link to an absent version leaves the story untouched.
- Rename editorial titles independently of story IDs and paths using the management API. The SDK accepts an optional starting locale when creating a story.
- Apply space migration `037_story_locale_availability` when upgrading from rc.12. Existing versions stay included.

## 0.1.0-rc.12 — 2026-11-19

- Pause passive editor polling in hidden tabs and combine overlapping refreshes.
  Sessions with the same permissions no longer restart the review poll.
- Clear the block library’s environment error after a successful retry while
  keeping failed management actions visible.
- Upgrade the CMS and SDK together. This release adds no database migrations.

## 0.1.0-rc.11 — 2026-11-19

- Connect Vercel projects from **Settings → Webhooks**. Rebuild on story publish,
  after a content release commits, or with **Rebuild now**. A multi-page
  release queues one rebuild per subscribed connection.
- Show green and red delivery results and put Refresh in the delivery dialog
  header. Follow the [illustrated Vercel setup guide](docs/vercel.md) to connect a
  project and check its build in Vercel.
- Organize block definitions into persistent folders and browse them from the
  block library, editor, and block picker.
- Add a [recommended first-time setup](docs/recommended-setup.md) and document
  [edge-optimized image delivery](docs/media-cdn.md).
- Apply space migrations 035 and 036 through the transactional production
  migration runner. They store block folders and Vercel connection types.
  Keep the existing webhook encryption key. The SDK version advances with the CMS.

## 0.1.0-rc.10 — 2026-11-09

- Run published SDK delivery in a separate optional service with independent
  replicas, while keeping preview and schema tooling on the editor origin.
- Share editor room notifications through PostgreSQL `LISTEN`/`NOTIFY`, recheck
  each recipient on refresh, and recover active rooms after listener interruptions.
- Move space deletion from workspace cards into General settings, preserving
  administrator checks and confirmation safeguards.
- Document architecture, deployment connection budgets, and scoped verification.
  Editor capacity and hosted multi-replica acceptance remain pending; the Railway
  template and deployed replica counts are unchanged.
- Advance CMS and SDK versions together. No new public SDK API or database
  migration beyond rc.9; older installations apply pending migrations through
  the transactional production migration runner.

## 0.1.0-rc.9 — 2026-11-09

- Keep tablet editor headings readable and toolbar actions keyboard accessible.
- Remove visible copy, paste, clear-clipboard, and link-copy confirmations while
  preserving screen-reader announcements, error feedback, and manual fallbacks.
- Advance CMS and SDK versions together. No new public SDK API or database
  migration beyond rc.8; older installations still apply pending migrations
  through the transactional production migration runner.

## 0.1.0-rc.8 — 2026-11-09

- Replace the floating phone navigation rail with a header hamburger and focus-managed menu; compact editor actions into labeled icons and shorter primary controls.

- Keep mobile story titles readable by reserving title-column width while secondary table columns scroll.

- Let cross-site previews load already-public media through the existing publication and public-media eligibility checks when CMS cookies are absent.

- Keep browser Back/Forward and content-folder navigation in the same history.

- Move Page map beneath the editor and Live Preview columns so it spans the full workspace width.

- Allow requesters and space admins to delete reviews and discussions from inbox rows or thread details with confirmation. Remove duplicate story context and requester metadata from review details.

- Split personal block hover previews into Content editor, Add block pane, and Blocks table settings. The Block library now previews configured samples on hover or keyboard focus using the existing authenticated iframe. Upgrade migration preserves previous choices.

- Add a local-account menu and installation-admin space deletion with confirmation.
- Advance CMS and SDK versions together; no new public SDK API. Space migration
  034 stores per-surface block preview preferences while preserving existing choices.
  Apply pending migrations with the transactional production migration runner.

## 0.1.0-rc.7 — 2026-11-07

- Refresh sign-in and password-reset presentation with responsive light/dark layouts.
- Keep mobile workspace navigation compact, horizontally scrollable, and keyboard
  accessible; improve content actions and filters on narrow screens.
- Clarify database credential reveal/copy controls and the separate update action
  in installation-admin settings.
- Document in-place Railway updates and the difference between deploying the latest
  source and redeploying an existing image.
- Advance CMS and SDK versions together; no new SDK API or database migration
  beyond rc.6. Older installations apply pending migrations through the existing
  transactional pre-deploy command.

## 0.1.0-rc.6 — 2026-11-07

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
