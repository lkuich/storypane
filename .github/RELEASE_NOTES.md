Storypane **0.1.0-rc.11** is a release candidate for evaluation.

- Connect a Vercel project in **Settings → Webhooks** and rebuild on story
  publishes, content releases, or manually. A multi-page release queues one
  rebuild per subscribed connection after it commits.
- Check delivery results with green and red badges and Refresh in the dialog
  header. [Vercel setup guide with screenshots](https://storypane.dev/docs/vercel/)
- Organize block definitions into persistent folders and browse them from the
  block library, editor, and block picker.
- Follow the new [first-time setup guide](https://storypane.dev/docs/recommended-setup/)
  or configure [edge-optimized image delivery](https://storypane.dev/docs/media-cdn/).

Install the CMS from source tag `v0.1.0-rc.11`. Install the SDK with
`npm install @storypane/sdk@0.1.0-rc.11` or follow `@storypane/sdk@rc` once
the npm publication completes. This prerelease includes the SDK archive.
The public SDK API is unchanged.

Back up databases, original media, configuration, and keys before upgrading.
Use the transactional production migration runner to apply migrations 035
and 036 for block folders and Vercel connections. Preserve the existing webhook
encryption key so Storypane can still decrypt saved credentials.

Hosted checks covered an in-place Railway upgrade, an existing story and private
media, the Vercel connection UI, and mobile delivery logs for an accepted rebuild
request. Full fresh-install acceptance, hosted multi-replica checks, and
production capacity testing remain outstanding.

- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.11/CHANGELOG.md)
- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.11/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.11/docs/deployment-verification.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage, and agent providers have their own terms and costs.
