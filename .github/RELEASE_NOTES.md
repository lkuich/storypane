Storypane **0.1.0-rc.8** — release candidate for evaluation.

- Separate hover-preview preferences for the content editor, Add block pane, and
  Blocks table, including authenticated sample previews in the table.
- Requester/admin review deletion from the inbox and discussion details, with
  clearer review context.
- Full-width Page map below the editor and Live Preview; browser Back/Forward
  follows content-folder navigation.
- Cross-site previews can load already-public images without CMS session cookies.
- Readable mobile story titles, a header hamburger menu, and compact editor actions.
- Local-account menu improvements and confirmed installation-admin space deletion.

Install the CMS from source tag `v0.1.0-rc.8`; Docker Compose builds that checkout.
The Railway template builds moving `main`, not a pinned candidate. Install the
SDK with `npm install @storypane/sdk@0.1.0-rc.8`, or follow `@storypane/sdk@rc`
after npm publication completes. The tarball is attached to this prerelease.
There is no new public SDK API. Space migration 034 stores per-surface block
preview preferences and preserves existing choices; the transactional production
migration runner applies it during upgrade.

Back up the installation database, every space database, original media,
configuration, and keys before upgrading. Keep the existing transactional
pre-deploy migration command; older installations apply their pending migrations.
Never use local-only `db:setup` on a hosted installation. Rollback after database
changes requires a coordinated backup restore.

Local responsive and keyboard checks and release CI results are recorded in the
verification guide. These do not constitute a new hosted-installation acceptance run.
Run one app replica. Full hosted acceptance, independent security review, and
production load benchmarks remain outstanding.

- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.8/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.8/docs/deployment-verification.md)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.8/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage and agent providers have their own terms and costs.
