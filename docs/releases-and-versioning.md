# Releases and versioning

The current version is **0.1.0-rc.5**, the current public release candidate. The
CMS checkout and SDK share that version. Tags use `v0.1.0-rc.5`; later candidates
increment the final number. `0.1.0` will be the first stable release only after
its acceptance checks pass. An RC is for evaluation, not a production-readiness
promise.

## Install a candidate

Check out an explicit tag rather than tracking a moving branch:

```sh
git clone https://github.com/lkuich/storypane.git
cd storypane
git checkout v0.1.0-rc.5
node scripts/setup-env.mjs
```

Continue with [getting started](getting-started.md). The Docker Compose setup
builds the checked-out source; it does not require an unpublished container image.
Install the SDK from npm with `npm install @storypane/sdk@0.1.0-rc.5`, or use
`@storypane/sdk@rc` to follow candidates. The verified archive remains attached to
the [GitHub release](https://github.com/lkuich/storypane/releases).

CI publishes candidates with `--tag rc`. On this first publication, npm also
assigned `latest` to `0.1.0-rc.2` and rejected removal of that tag. This matches
[npm's documented first-publication behavior](https://github.com/npm/cli/issues/8490).
Treat the version's `-rc` suffix and release notes as the stability indicator;
`latest` does not mean this candidate is stable or production-verified. Prefer
an explicit version or the `rc` channel in your integration.

The [Railway template](deploy-railway.md) currently builds `main`, including the
automatic installation setup included in rc.3. It is an evaluation path, not a
pinned candidate deployment. Review the [hosted verification record](deployment-verification.md#railway-template-checks--2026-11-06)
and retain backups before pulling newer source.

## What CI checks

Pull requests and pushes to `main` run `.github/workflows/ci.yml`: frozen-lockfile
installation, high-severity production dependency audit, lint/format, SDK/app/example
type checks, unit and database tests,
a separate disposable database cluster for installation isolation/authentication,
production build, packed-SDK consumer checks, and a Docker build.

The packed-SDK check verifies the version, allowed files, license, all public
entrypoints, type declaration presence, a clean installation outside the monorepo,
and CLI startup. The application packages are private workspace packages; only
`@storypane/sdk` is intended for npm. No root monorepo package is published.

Authenticated browser acceptance and real hosted deployments are **not** covered
by that workflow. Follow the [deployment acceptance checklist](deployment-verification.md),
including two editors, permissions, preview, media, scheduled releases, recovery,
and persistence after restart. Record the tested revision, providers, and results.

## Publish a candidate

1. Update the root and SDK `package.json` versions together and add a changelog
   entry. Update `.github/RELEASE_NOTES.md` and documentation for that candidate.
2. Run the checks above and the relevant browser/deployment acceptance checks.
   Document any unverified areas instead of calling them verified.
3. Commit and push. Tag that exact commit and push the tag, for example:
   `git tag v0.1.0-rc.5` then `git push origin v0.1.0-rc.5`.
4. The release workflow repeats CI, validates tag/version agreement, then creates
   a GitHub **prerelease** and uploads the installable SDK tarball. A tag push
   does not publish to npm.
5. After npm setup below, manually run **Release candidate** on the **matching
   tag**, with `publish_npm` enabled. It repeats checks and publishes the packed
   SDK on npm's `rc` channel with provenance. A run on `main`, a mismatched tag,
   or an invalid RC version is rejected.

Version numbers are immutable once published to npm. Fix mistakes with a new RC;
do not delete and reuse a version. Keep release access limited to maintainers.
Pinning action revisions and using OIDC avoids placing a reusable npm write token
in the repository. Consider branch/tag rules and required checks as the maintainer
team grows.

### One-time npm setup

**Completed November 6, 2026:** `@storypane/sdk@0.1.0-rc.2` was published from the
verified GitHub archive, then installed from npm in an isolated consumer. All
entrypoints and the CLI passed. The trusted publisher is configured for
`lkuich/storypane` and `release.yml`, with publishing enabled and no environment.
No npm token secret is required by CI. The first OIDC publication succeeded for
`0.1.0-rc.3`; a clean registry install and its provenance attestations were verified.
The `rc` channel now points to rc.5; `latest` remains on rc.2. Later candidates use
the same workflow; verify its result and registry version after each publication.
Do not republish an existing version.

The steps below document the initial setup. Existing maintainers should verify
the publisher configuration and use the next-version workflow rather than repeat
the bootstrap publication.

Only `@storypane/sdk` goes to npm. The CMS is installed from the source tag or
Docker build; the root and internal workspace packages stay private.

1. Create or sign in to your npm account, verify its email, and enable account
   two-factor authentication. Create an npm organization named **storypane**
   (or join it with publish permission). Choose **Unlimited public packages**;
   that organization plan is free. The npm scope is independent of the GitHub
   repository name. If the scope is unavailable, resolve ownership or deliberately
   rename the package and its callers before publishing. See
   [npm organization setup](https://docs.npmjs.com/creating-an-organization/).
2. In a private terminal, use Node 24.22+ within v24 and sign in to the public npm
   registry. Complete npm's browser/account verification privately:

   ```sh
   npm login --registry=https://registry.npmjs.org/
   npm whoami --registry=https://registry.npmjs.org/
   ```

3. Bootstrap the package with the **already verified GitHub release archive**.
   Run from the repository root with the GitHub CLI available. This downloads the
   exact published artifact rather than building different bytes from a moving
   branch. The destination is an ignored build-artifact directory:

   ```sh
   mkdir -p artifacts
   gh release download v0.1.0-rc.2 --repo lkuich/storypane \
     --pattern storypane-sdk-0.1.0-rc.2.tgz --dir artifacts --clobber
   npm publish ./artifacts/storypane-sdk-0.1.0-rc.2.tgz --access public --tag rc
   npm view @storypane/sdk@rc version
   npm view @storypane/sdk dist-tags --json
   ```

   If npm returns a 403 requiring two-factor authentication, enable account 2FA
   (including publishing protection) in npm’s security settings, then retry from
   your authenticated terminal. Signing in and owning the scope alone are not
   sufficient. Keep the `./` prefix on the local archive path so npm treats it
   as a file rather than a GitHub shorthand.

   Complete any requested npm account/2FA checks. The version should be
   `0.1.0-rc.2` and the `rc` tag should point to it. Inspect `latest` too; npm can
   assign it on a first publication even when `--tag rc` is explicit. Document
   the actual tags and keep the candidate status clear.
   The `@storypane` organization must grant your signed-in account publish access.
   Never paste credentials into a chat, workflow file, or repository.

4. Open **@storypane/sdk → Settings → Trusted Publisher** on npm and add GitHub
   Actions with these exact values:

   | Field                | Value                                         |
   | -------------------- | --------------------------------------------- |
   | Organization or user | `lkuich`                                      |
   | Repository           | `storypane`                                   |
   | Workflow filename    | `release.yml`                                 |
   | Environment          | Leave empty; the workflow has no environment. |
   | Allowed action       | Direct publishing with `npm publish`.         |

5. For the **next** version, update versions and notes, commit, and push its new
   tag using the release steps above. Then open GitHub **Actions → Release
   candidate → Run workflow**, choose that **matching release tag** and enable
   `publish_npm`. CI publishes through OIDC with provenance on the `rc` channel.
   No `NPM_TOKEN` repository secret is required. Do not run npm publication again
   for the version you already bootstrapped; npm versions cannot be overwritten.

Users can then install `npm install @storypane/sdk@rc`, or pin the exact version.
Check the registry version and tags after every publication, then update the
website and canonical installation guides together. Allow registry metadata
propagation before assuming an immediately missing version failed to publish.

Trusted publishing requires a GitHub-hosted runner and npm 11.5.1+ / Node 22.14+;
the pinned Node 24.22 runtime meets that baseline. See the
[official npm instructions](https://docs.npmjs.com/trusted-publishers/).

## Dependency review for rc.1

The release review patched Vite and fflate; the production dependency audit then
reported no known advisories. The full graph still reports
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in
ESLint’s development-only minimatch 10 dependency. Its available fix is major
version 11, outside the declared dependency range. Do not feed untrusted glob
patterns to tooling; review the upstream upgrade before forcing that change.
This finding is not a clean full-dependency audit or a production security guarantee.

## Before calling 0.1 stable

- Complete and record the fresh-install and upgrade acceptance checklist.
- Test the default local-auth path and optional Clerk separately; verify recovery,
  membership removal and revoked sessions in HTTP and WebSocket flows.
- Restore a coordinated backup: installation DB, every space DB, original media,
  configuration and keys. Rehearse an upgrade against that copy.
- Review dependency/container advisories, license notices and reported security issues.
- Publish installation requirements, known limits and a usable artifact. Confirm
  both example integrations against the same SDK release.
- Confirm the operator-facing privacy guidance and [security reporting](../SECURITY.md)
  are reachable. Operators still need their own privacy notice and retention policy.

## Upgrades, rollback, and support

Read [the changelog](../CHANGELOG.md) and [backup/upgrade instructions](self-hosting.md#backups-upgrades-and-health)
before changing versions. Preserve encryption keys, object originals, installation
identities and migration history. Use the transactional operator migration runner;
`db:setup` remains local-only. There are no automatic production down migrations.
Restore a coordinated backup to roll back; reconcile any writes made after it.

During the RC series, fixes target the latest candidate and contracts may change.
There is no hosted SLA or promised LTS window. File reproducible bugs without
secrets, and report vulnerabilities privately. Self-hosting does not turn the
MIT warranty disclaimer into a security or compliance guarantee. The
[MIT license](../LICENSE) already supplies the project's warranty/liability terms;
we are not adding a second software license or a hosted-service contract.
