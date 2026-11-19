Storypane **0.1.0-rc.13** is a release candidate for evaluation.

- Filter Content by locale to see the version’s path, publication status and edit link. Expand a shared story to see all included paths.
- Choose a starting locale when creating a story, then add or exclude versions as needed. Exclusion preserves the draft and its history. Unpublish a live version and cancel pending publications before excluding it.
- Rename a story’s editorial title through the management API while preserving its ID and paths. The SDK accepts an optional `spaceLocaleId` when creating a story.

Install the CMS from source tag `v0.1.0-rc.13`. Install the SDK with
`npm install @storypane/sdk@0.1.0-rc.13` or follow `@storypane/sdk@rc`.

Back up databases, original media, configuration and keys before upgrading.
The production migration runner applies `037_story_locale_availability` to each space. Existing versions stay included until an editor excludes them.

- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.13/CHANGELOG.md)
- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.13/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.13/docs/deployment-verification.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage, and agent providers have their own terms and costs.
