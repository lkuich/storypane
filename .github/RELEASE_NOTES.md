Storypane **0.1.0-rc.12** is a release candidate for evaluation.

- Background editor tabs pause passive reads. Returning to a tab refreshes its
  data and overlapping refreshes share one request. Edits and lock renewal continue.
- The block library clears a temporary environment error after the next successful
  read. Errors from management actions stay visible.

Install the CMS from source tag `v0.1.0-rc.12`. Install the SDK with
`npm install @storypane/sdk@0.1.0-rc.12` or follow `@storypane/sdk@rc` once
the npm publication completes. This prerelease includes the SDK archive.
The public SDK API is unchanged.

Back up databases, original media, configuration, and keys before upgrading.
Upgrading from rc.11 requires no database migrations. Earlier versions should
apply pending migrations through the transactional production migration runner.

- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.12/CHANGELOG.md)
- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.12/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.12/docs/deployment-verification.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage, and agent providers have their own terms and costs.
