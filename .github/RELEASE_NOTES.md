Storypane **0.1.0-rc.3** — release candidate for evaluation.

This candidate brings the CMS and SDK together after the editor and installation
improvements since rc.2:

- Automatic fresh Railway setup and scoped hosted installation verification.
- Component hover previews and explicit block-picker sample previews, with the
  matching SDK API and both example integrations.
- Read-only page map with a transactional connection index and upgrade backfill.
- Personal preview defaults, responsive live-preview sizes, and improved controls.
- SEO/AI metadata preset and published Markdown examples.
- Rich-text cursor/selection preservation, focused publication reviews, and
  clearer asset publication status.

Install the CMS from source tag `v0.1.0-rc.3`. Docker Compose builds that checkout;
no prebuilt CMS image is required. The Railway template still builds moving
`main`, rather than pinning this candidate.

Install the SDK with `npm install @storypane/sdk@0.1.0-rc.3`, or follow candidates
with `npm install @storypane/sdk@rc`, after the separate npm publication completes.
The SDK tarball is attached to this GitHub prerelease. The `-rc` suffix is the
stability indicator; npm's `latest` tag does not imply a stable release.

Upgrades include space migrations 028 (page connections) and 029 (personal preview
default). Back up all databases, original media, configuration and encryption keys,
then use the transactional production migration runner. Do not use local-only
`db:setup` for upgrades. Rollback requires restoring a coordinated backup.

Run one app replica. Full hosted acceptance, backup/restore rehearsal, independent
security review and production load benchmarks remain outstanding. Scoped Railway
checks do not establish production readiness.

- [Get started](https://storypane.dev/docs/getting-started/)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://storypane.dev/docs/deployment-verification/)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.3/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under the terms of LICENSE. Your chosen
hosting, identity, mail, storage and agent providers have their own terms and costs.
