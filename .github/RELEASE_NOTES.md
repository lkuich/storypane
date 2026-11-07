Storypane **0.1.0-rc.5** — release candidate for evaluation.

- Story and block reviews, comments, inline @mentions, and the Reviews inbox.
- Teams under Members & roles with minimum approval counts and a separate Review
  content permission. Publication and scheduling enforce the requested approvals.
- One comment/review composer, block-row comment buttons, and redesigned invitations.
- Faster block navigation, stale-snapshot lease protection, on-demand rich-text
  loading, and a personal toggle for block hover previews.
- Larger page map, icon refresh controls, and nested-block filtering.
- Legacy database splitting preserves review history and its space boundaries.
- Read-only previews of saved release versions, with version-specific review decisions.

Install the CMS from source tag `v0.1.0-rc.5`; Docker Compose builds that checkout.
The Railway template builds moving `main`, not a pinned candidate. Install the
SDK with `npm install @storypane/sdk@0.1.0-rc.5`, or follow `@storypane/sdk@rc`
after npm publication completes. The tarball is attached to this prerelease.
There is no new SDK API in this candidate. npm's `latest` tag is not a stability
indicator; use the explicit version or `rc` channel.

Upgrades apply space migrations **030** (reviews and Teams), **031** (personal
block previews), and **032** (release previews and versioned review decisions).
Preserve all databases, original media, configuration and keys;
use the transactional production migration runner, not local-only `db:setup`.
Rollback requires a coordinated backup restore.

Local production-build checks measured median block-opening time of 42 ms versus
112 ms before, with approximately 403 KB less initial JavaScript. These are
isolated fixture measurements, not a production load benchmark. Review and editor
browser scenarios cover keyboard/mobile behavior and real local authentication.
See the verification record for the limits of hosted acceptance.

Run one app replica. This candidate is for evaluation; full hosted acceptance,
independent security review and production load benchmarks remain outstanding.

- [Reviews and comments](https://storypane.dev/docs/reviews/)
- [Get started](https://storypane.dev/docs/getting-started/)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://storypane.dev/docs/verification/)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.5/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage and agent providers have their own terms and costs.
