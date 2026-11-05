# Storypane

Keep changes small and use existing services and UI controls. Integrations belong
in application code; do not add a plugin framework for a direct integration.

- `apps/web`: vinext App Router, UI and authenticated HTTP boundary.
- `apps/realtime`: collaboration rooms; Postgres remains authoritative.
- `packages/core`: contracts and validation. `packages/db`: transactions, permissions,
  migrations, history, publishing and webhooks. `packages/assets`: private media.
- `packages/sdk`: delivery, preview and schema-generated types; update its callers
  and both example apps when a public contract changes.

Read all callers before changing shared behavior. Preserve unrelated work.
Authorize each operation and filter every HTTP/WebSocket snapshot for its recipient.
Never expose lease tokens, bypass content scopes, or publish unfinished drafts.
Use the transactional migration runner; `db:setup` is deliberately local-only.
Preserve original media, migration history, and webhook encryption keys on upgrades.

Use `cf` for Cloudflare commands. Production configuration belongs in ignored
`.env.production`; never assume the CLI's default account is the correct account.
Follow `docs/deploy-cloudflare.md` or `docs/deploy-railway.md` for deployment.
Run focused Vitest tests, the relevant database tests, and type/build checks for the
changed runtime. Browser changes need a responsive keyboard check. New nontrivial
logic needs a meaningful test. Do not mark a fresh installation verified without
running the acceptance checklist in `docs/deployment-verification.md`.
