# Releases and versioning

The current version is **0.1.0-rc.1**, the first public release candidate. The
CMS checkout and SDK share that version. Tags use `v0.1.0-rc.1`; later candidates
increment the final number. `0.1.0` will be the first stable release only after
its acceptance checks pass. An RC is for evaluation, not a production-readiness
promise.

## Install a candidate

Check out an explicit tag rather than tracking a moving branch:

```sh
git clone https://github.com/lkuich/storypane.git
cd storypane
git checkout v0.1.0-rc.1
node scripts/setup-env.mjs
```

Continue with [getting started](getting-started.md). The Docker Compose setup
builds the checked-out source; it does not require an unpublished container image.
Use the matching SDK tarball from the [GitHub release](https://github.com/lkuich/storypane/releases)
or build/pack the SDK from the same tag. When npm publication is enabled, install
the explicit version or `@storypane/sdk@rc`; RCs are never published as `latest`.
Do not assume `npm install @storypane/sdk` installs a candidate.

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
   `git tag v0.1.0-rc.1` then `git push origin v0.1.0-rc.1`.
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

The maintainer must control the `@storypane` npm scope and have permission to
publish `@storypane/sdk`. This checkout is not itself proof of that permission.
For a new package, make the first publication from a private authenticated
terminal (with npm's required account/2FA checks):

```sh
pnpm install --frozen-lockfile
pnpm test:package
npm publish artifacts/storypane-sdk-0.1.0-rc.1.tgz --access public --tag rc
```

Then configure the package's **Trusted Publisher** on npm:

- GitHub owner: `lkuich`
- Repository: `storypane`
- Workflow filename: `release.yml`
- Environment: leave empty (the workflow has no environment).
- Allow direct publishing with `npm publish`.

Future RCs can use the manual workflow above without an npm token. Do not
republish the already bootstrapped version from CI; use the next candidate.
Trusted publishing needs a GitHub-hosted runner and npm 11.5.1+ / Node 22.14+;
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
