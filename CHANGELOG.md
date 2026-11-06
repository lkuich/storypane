# Changelog

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
  opt-in npm trusted-publishing workflow keep prereleases off the `latest` channel.

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
