Storypane **0.1.0-rc.18** is a release candidate for evaluation.

- Story multi-selects show an ordered list. Drag the handle or use its arrow-key shortcuts to reorder stories, and remove individual references directly from the list.
- Content search starts in the current folder. Select **Ignore folder** to search across folders. Clearing the query restores folder scope.
- Hide or restore a block per locale. Live preview reflects visibility immediately. Publishing applies it to delivery. The SDK exposes `_hiddenBlockFields` for sites that provide fallback content.
- Consolidate page types with `rootReplacements` in format 2 schema migrations. Compatible replacements preserve IDs and child blocks and migrate drafts and published snapshots separately.
- Open the page URL from the live preview toolbar. Reference pickers now use story terminology.

Install the CMS from source tag `v0.1.0-rc.18`. Install the SDK with
`npm install @storypane/sdk@0.1.0-rc.18` or follow `@storypane/sdk@rc`.

Back up databases, original media, configuration and keys before upgrading.
Apply space migrations `040_root_replacements` and `041_block_visibility` through the transactional migration runner.

- [Full diff from rc.17](https://github.com/lkuich/storypane/compare/v0.1.0-rc.17...v0.1.0-rc.18)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.18/CHANGELOG.md)
- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.18/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage, and agent providers have their own terms and costs.
