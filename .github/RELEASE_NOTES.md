Storypane **0.1.0-rc.7** — release candidate for evaluation.

- Refreshed sign-in and password-reset layouts in light and dark themes.
- Compact mobile workspace navigation, keyboard-accessible tabs, and improved
  content actions and filters on narrow screens.
- Clearer database credential reveal/copy controls and a separate connection-update
  action for installation administrators.
- In-place Railway upgrade instructions, including how to deploy the latest source.

Install the CMS from source tag `v0.1.0-rc.7`; Docker Compose builds that checkout.
The Railway template builds moving `main`, not a pinned candidate. Install the
SDK with `npm install @storypane/sdk@0.1.0-rc.7`, or follow `@storypane/sdk@rc`
after npm publication completes. The tarball is attached to this prerelease.
There is no new public SDK API or database migration beyond rc.6.

Back up the installation database, every space database, original media,
configuration, and keys before upgrading. Keep the existing transactional
pre-deploy migration command; older installations apply their pending migrations.
Never use local-only `db:setup` on a hosted installation. Rollback after database
changes requires a coordinated backup restore.

Local responsive and keyboard checks and release CI results are recorded in the
verification guide. These do not constitute a new hosted-installation acceptance run.
Run one app replica. Full hosted acceptance, independent security review, and
production load benchmarks remain outstanding.

- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.7/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.7/docs/deployment-verification.md)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.7/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage and agent providers have their own terms and costs.
