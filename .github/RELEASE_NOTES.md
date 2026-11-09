Storypane **0.1.0-rc.9** — release candidate for evaluation.

- Keep tablet editor headings readable and toolbar actions keyboard accessible.
- Quiet routine copy, paste, clear-clipboard, and link-copy confirmations while
  preserving screen-reader announcements, visible errors, and manual fallbacks.

Install the CMS from source tag `v0.1.0-rc.9`; Docker Compose builds that checkout.
The Railway template builds moving `main`, not a pinned candidate. Install the
SDK with `npm install @storypane/sdk@0.1.0-rc.9`, or follow `@storypane/sdk@rc`
after npm publication completes. The tarball is attached to this prerelease.
There is no new public SDK API or database migration beyond rc.8. Older
installations still apply pending migrations through the transactional production
migration runner.

Back up the installation database, every space database, original media,
configuration, and keys before upgrading. Keep the existing transactional
pre-deploy migration command; older installations apply their pending migrations.
Never use local-only `db:setup` on a hosted installation. Rollback after database
changes requires a coordinated backup restore.

Local responsive and keyboard checks and release CI results are recorded in the
verification guide. These do not constitute a new hosted-installation acceptance run.
Run one app replica. Full hosted acceptance, independent security review, and
production load benchmarks remain outstanding.

- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.9/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.9/docs/deployment-verification.md)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.9/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage and agent providers have their own terms and costs.
