# Security policy

Storypane is currently a release candidate. Security fixes target the newest
`0.1.0-rc` release; older RCs and unpublished/customized copies have no separate
maintenance commitment. Upgrade after reviewing release notes and backups.
There is no security certification, audit claim, response-time SLA, or guaranteed
support period for this community release.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/lkuich/storypane/security/advisories/new).
Include the affected revision/version, deployment configuration with secrets
removed, reproduction steps, impact, and a minimal proof of concept when possible.
Do not open a public issue containing an exploit, token, password, database URL,
private content, or someone else's personal data. Do not test against installations
you do not own or have permission to assess.

The maintainer will triage reports as capacity allows, coordinate a fix, and use
GitHub advisories for disclosure when appropriate. There is no paid bug bounty.
If a credential has leaked, revoke or rotate it with the operator immediately;
a software patch does not invalidate copied secrets.

## Operate securely

Read [authentication](docs/authentication.md), [self-hosting](docs/self-hosting.md),
and [privacy and data handling](docs/privacy.md). Configure HTTPS and the exact
application origin; restrict database/bucket access; use dedicated database roles,
least-privilege memberships and tokens; and keep encryption keys out of source.
Preserve backups and verify restoration before upgrading. Keep one application
replica until a shared collaboration transport is supported.

The [deployment acceptance checklist](docs/deployment-verification.md) records
what a fresh installation must demonstrate. Passing unit tests is not an audit
or verification of your hosted installation. Review dependency/container updates
and third-party notices as well as Storypane changes.
