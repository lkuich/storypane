Storypane **0.1.0-rc.17** is a release candidate for evaluation.

- Rename a story or folder slug and see the new draft URL in open editors. The location dialog shows the full localized path. Publish the affected locales to make their new URLs live.
- Create draft releases without a date, then choose when to publish them.
- Rename component API names in schema migrations while preserving component identity.
- Live preview selections focus linked editor fields. The story pin uses a row action, the rich-text dark background works in production builds, and short bursts of requests wait for space database capacity.

Install the CMS from source tag `v0.1.0-rc.17`. Install the SDK with
`npm install @storypane/sdk@0.1.0-rc.17` or follow `@storypane/sdk@rc`.

Back up databases, original media, configuration and keys before upgrading.
Apply space migration `039_draft_releases` through the transactional migration runner.

- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.17/CHANGELOG.md)
- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.17/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage, and agent providers have their own terms and costs.
