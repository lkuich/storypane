Storypane **0.1.0-rc.16** is a release candidate for evaluation.

- Filter Content by clicking a locale name or its checkbox. This fixes a Chrome tab crash and keeps keyboard selection available.
- Use **Dark background** on an individual rich-text field to read white lettering. The browser remembers that field’s setting between visits.
- Choose **Now** when creating a release to queue approved content for the next publication run as you add it. Leave it unchecked to schedule a future launch.
- Bulk review limits concurrent requests. Spaces shows pending invitations, and Clerk sign-in and workspace loading handle device verification and initialization.

Install the CMS from source tag `v0.1.0-rc.16`. Install the SDK with
`npm install @storypane/sdk@0.1.0-rc.16` or follow `@storypane/sdk@rc`.

Back up databases, original media, configuration and keys before upgrading.
Apply space migration `038_immediate_releases` through the transactional migration runner. Existing releases keep their scheduled times.

- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.16/CHANGELOG.md)
- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.16/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.16/docs/deployment-verification.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage, and agent providers have their own terms and costs.
