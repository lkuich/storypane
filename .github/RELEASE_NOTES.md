Storypane's public release candidate: **0.1.0-rc.2**.

A self-hosted Node/Docker CMS with block-level collaboration, live preview,
independent locales, linked developer spaces and schema migrations, content
releases, private media, and agent access through the management API, CLI and MCP.

- [Get started](https://storypane.dev/docs/getting-started/)
- [Authentication](https://storypane.dev/docs/authentication/)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Changelog](https://github.com/lkuich/storypane/blob/main/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

This is an **RC for evaluation**, not a stable production release. Run one app
replica. Fresh hosted acceptance, an independent security audit, and production
load benchmarks remain outstanding. Back up all databases, original media and
keys before upgrades. See the acceptance checklist and known limits in the docs.

The attached SDK tarball installs with `npm install ./storypane-sdk-0.1.0-rc.2.tgz`.
Registry publication is separate and gated on npm scope/publisher setup; installing
an RC from npm requires the explicit version or `rc` tag. The CMS is built from
this source tag with Docker Compose. No prebuilt CMS image is required.

The production dependency review is clean after patch updates; a moderate
development-only minimatch advisory remains documented in the release guide.

MIT licensed, provided without warranty under the terms of LICENSE. Your chosen
hosting, identity, mail, storage and agent providers have their own terms and costs.
