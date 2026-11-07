Storypane **0.1.0-rc.6** — release candidate for evaluation.

- Create independent locale pages from Default, with page fields and all sections
  selected initially.
- Review source updates for a whole page or individual block. Safe changes are
  preselected; compare previous source, current source, and localized values before
  replacing translations or accepting structural changes.
- Keep localized content while acknowledging source changes. Link existing locale
  copies explicitly without changing their content or inventing earlier history.
- Track advisory translation-review markers, preserve source relationships during
  legacy database splitting, and retain the separate independent block-copy action.
- Improve Railway setup failure diagnostics.

Install the CMS from source tag `v0.1.0-rc.6`; Docker Compose builds that checkout.
The Railway template builds moving `main`, not a pinned candidate. Install the
SDK with `npm install @storypane/sdk@0.1.0-rc.6`, or follow `@storypane/sdk@rc`
after npm publication completes. The tarball is attached to this prerelease.
There is no new public SDK API. npm's `latest` tag is not a stability indicator;
use the explicit version or `rc` channel.

Upgrades from rc.5 apply space migration **033** for locale source baselines and
mappings. Preserve databases, original media, configuration and keys; use the
transactional production migration runner, not local-only `db:setup`. Rollback
requires a coordinated backup restore.

Existing locales need a one-time explicit linking step. Source review requires
complete read access to the source, destination, and historical baseline, and
complete edit access to the destination. Translation markers are advisory.
Applying source changes never publishes them automatically.

Local checks include 600 passing tests (six optional external/Railway fixture
cases skipped), 15 focused locale-source/legacy-split database tests, and two real
authenticated browser scenarios with keyboard and responsive checks. CI repeats
the full suite, build, package checks, and Docker build on this release tag.
These checks do not constitute a new hosted-installation acceptance run.

Run one app replica. Full hosted acceptance, independent security review, and
production load benchmarks remain outstanding.

- [Locales and source updates](https://storypane.dev/docs/locales/)
- [Get started](https://storypane.dev/docs/getting-started/)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://storypane.dev/docs/verification/)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.6/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage and agent providers have their own terms and costs.
