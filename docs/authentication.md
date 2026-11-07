# Authentication and access

Storypane includes invitation-only email/password sign-in. Accounts and sessions
live in your installation PostgreSQL database; you do not need Clerk or SMTP to
get started. The local provider is built on Better Auth. Clerk is an optional,
explicitly selected provider, with an existing path to company SSO. You own the
authentication code and can adapt your copy for another identity provider.

Authentication identifies a person. Space memberships, roles, and content scopes
determine what that person can do. Neither a successful sign-in nor an API token
bypasses those permissions.

<aside class="agent-instructions" aria-labelledby="auth-agent">
<div class="agent-instructions-top"><span class="eyebrow">For coding agents</span></div>

## Configure authentication with an agent

```text
Read AGENTS.md, docs/authentication.md and docs/self-hosting.md in this checkout.
Inspect the existing installation without printing credentials, cookies or tokens.
Use local authentication unless I explicitly select Clerk. Generate configuration
with scripts/setup-env.mjs for a new installation; preserve an existing env file,
identity IDs, database volumes and encryption keys. Set the exact public HTTPS
origin and explain how I enter the first administrator password privately.
Configure SMTP only if I request emailed invitations and password recovery.
For a provider change, prepare identity mappings and maintenance steps before
switching; an env-only change is not a migration. Verify sign-in, invitations,
recovery, permissions and revoked sessions on a disposable installation. Report
any checks you could not run. Never paste secrets into chat or commit them.
```

</aside>

## Choose a provider

| Provider          | Required configuration                                                                                              | Account management                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Built-in, default | `AUTH_PROVIDER=local`, `BETTER_AUTH_SECRET`, installation database, `STORYPANE_APP_URL`                             | Bootstrap and recovery CLI; invitations and account controls in the editor.                                            |
| Clerk, optional   | `AUTH_PROVIDER=clerk`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, installation database, `STORYPANE_APP_URL` | Clerk handles sign-in; Storypane still controls installation privileges, space memberships, roles, and content scopes. |

Local authentication uses Better Auth with password hashing, database-backed
sessions, and persisted authentication rate limits. Public signup is disabled.
Built-in MFA, SAML, and OIDC federation are not included in this RC. If you need
those sign-in features, evaluate your Clerk configuration and its provider pricing;
Storypane's MIT license does not cover third-party service charges.

## Set up local sign-in

With the [Railway template](deploy-railway.md), enter your first administrator’s
name, email, and password before deploying. Sign in when the app is healthy, then
remove the three `STORYPANE_ADMIN_*` variables. You do not need the bootstrap CLI;
redeploys preserve existing accounts and cannot reset their passwords.

Follow [getting started](getting-started.md) to create configuration and start the
services. `node scripts/setup-env.mjs` generates a private `BETTER_AUTH_SECRET`
and the other installation keys without printing them. Keep these values on
upgrades. The command refuses to overwrite an existing file.

For Docker, create your first installation administrator:

```sh
docker compose --env-file .env.production -f compose.node.yaml exec web \
  node --import tsx scripts/admin.ts bootstrap
```

For a source/server checkout with `.env.production`, use `pnpm admin bootstrap`.
The command requires a terminal and asks for name, email, and a hidden password
of 12–128 characters. It refuses to bootstrap a second installation admin.
Open the configured application URL and sign in.

Set `STORYPANE_APP_URL` to the **exact origin** people use, such as
`https://cms.example.com`, and configure HTTPS at your reverse proxy. Scheme,
host, and port must agree with the browser. HTTPS enables secure session cookies;
plain HTTP is intended for local development. Keep the database and bucket off
the public internet wherever possible. Auth writes must originate from the
configured editor origin; do not weaken that check to fix a proxy mismatch.

## Invite your team

1. Open the space's **Settings → Members & roles**. Choose the invited email and
   the appropriate role, then create the invitation.
2. Share its single-use URL privately. Invitations expire after seven days. Add
   `SMTP_URL` and `MAIL_FROM` if you want Storypane to attempt email delivery;
   otherwise share the link yourself. A link is still available if email fails.
3. A new local user enters their name and password, then signs in. An existing
   user signs in with the matching invited account before accepting.
4. Repeat for other spaces. Access to one space does not grant membership in
   production, a developer's space, or another team's space.

Invitation possession is not email verification. Local accounts are created
unverified; the RC has no built-in email-verification flow. An invitation cannot
reset an existing account's password or replace its existing membership role.
Revoke and recreate a lost invitation rather than reusing a leaked URL.

An installation administrator provisions databases and manages installation
connections. Space roles and content scopes govern content access separately;
installation administration is not a blanket space-content permission. Use
`pnpm admin grant-admin <userId>` only to deliberately grant installation control
to an existing identity. Keep operator shell and database access restricted.

## Password changes and recovery

Signed-in local users choose **Account → Change password** and supply their
current password. Other sessions are revoked. Signing out revokes the current
session. Resetting or recovering a password revokes the account's existing sessions.

Set both optional variables and restart the app to enable emailed invitations
and **Forgot password?**:

```dotenv
SMTP_URL=smtps://user:password@mail.example.com:465
MAIL_FROM=Storypane <cms@example.com>
```

Use your mail provider's real settings in an ignored env file or secret manager.
URL-encode special characters in SMTP credentials. Verify actual email delivery
before relying on password resets; do not publish this example as credentials.
Without SMTP, or if mail is unavailable, an operator can recover a local account:

```sh
docker compose --env-file .env.production -f compose.node.yaml exec web \
  node --import tsx scripts/admin.ts recover
```

The terminal asks for the account email and a new hidden password. In a server
checkout, use `pnpm admin recover`. Never put passwords in command arguments,
issue reports, screenshots, or an agent conversation. Account recovery is a
privileged operator action, not an unauthenticated web endpoint.

## Optional Clerk setup

For a **new, empty installation**, set `AUTH_PROVIDER=clerk`, the backend secret
key and the matching publishable key before migrations and startup. Configure
your exact editor origin in Clerk. The publishable key is public by design;
the secret key stays server-side. The bundled Docker Compose passes both at runtime.

Sign in with a Clerk account whose primary email is verified. Storypane records
that identity in its installation database. An operator then grants the first
installation administrator with `pnpm admin grant-admin <userId>` using the
**installation identity ID**. Do not run the local `bootstrap` command in Clerk
mode. Invite users into spaces and assign roles in Storypane.

Clerk sessions, banned/locked status, local disabled-account status, and space
permissions are checked during authenticated operations. Clerk adds an external
authentication dependency; configure its production instance and test its own
account recovery and session revocation. Enabling an upstream sign-up method
does not itself grant a Storypane space membership.

## Company SSO, including Okta

Use Storypane's existing **Clerk provider** to connect your company's identity
provider. Clerk supports enterprise connections over SAML and OIDC, including
Okta Workforce. Configure the connection in your Clerk instance; Storypane keeps
using Clerk sessions and its own space permissions. SSO availability and charges
depend on your Clerk plan, not a Storypane enterprise license. See
[Clerk enterprise SSO](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/overview).

1. Configure Storypane's Clerk provider using the setup above. For an existing
   local installation, complete the identity mapping/provider switch below first;
   preserve existing user IDs rather than creating duplicate accounts.
2. In the Clerk Dashboard, create an enterprise connection for your company.
   For Okta Workforce, follow [Clerk's Okta SAML guide](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/saml/okta).
   Exchange the actual callback/ACS URLs, entity IDs, and certificates shown by
   Clerk and Okta; do not guess values from a generic example. Configure domain
   matching and the allowed application origin for your installation.
3. Test the full sign-in flow using a verified primary email and a deliberately
   invited Storypane account. Signing in through your company's IdP does not
   automatically grant space membership, a role, or installation administration.
4. Verify sign-out, session expiry/revocation, disabled/locked users, and access
   through HTTP, preview, and collaboration. Test your provider's MFA and recovery
   policy separately. Record the result for your own installation.

This is a provider configuration guide, not a claim that an Okta-backed fresh
installation has passed acceptance for this RC.

## Customize your sign-in flow

Your authentication flow belongs to your copy. A coding agent can extend the
existing Better Auth integration, connect Okta directly, or adapt another company
identity provider in application code. Keep the change focused on that provider;
there is no need for a generic authentication extension framework.

Use the [bring your own provider guide](bring-your-own-auth-provider.md) for the
shared server adapter, redirect sign-in screen, explicit identity mapping and
operator commands. Local and Clerk use the same adapter boundary. Custom providers
require source integration and verification; setting a new name alone is not enough.

Better Auth offers [SSO support over OIDC and SAML](https://better-auth.com/docs/plugins/sso)
and an [Okta SAML guide](https://better-auth.com/docs/guides/saml-sso-with-okta).
These are upstream capabilities: Storypane's default Better Auth configuration
currently exposes local email/password sign-in. A direct Okta flow or Better Auth
SSO extension requires implementation and verification in your copy.

Give your coding agent this task alongside the setup instructions above:

```text
Read AGENTS.md, docs/authentication.md and docs/bring-your-own-auth-provider.md.
Connect our specified identity provider through AuthenticationFactory in
packages/db/src/auth-providers.ts. Reuse redirect sign-in for a cookie-backed
provider; implement exact callback routes and session/identity rechecks inside
the adapter. Use resolveExternalIdentity for verified claims and the operator
link-provider-account command to preserve existing identities. Inspect the built-in
adapters, installation authority, auth route, UI and realtime callers before edits.
Adding an upstream plugin alone will not implement Storypane's adapter contract.
Review callback methods/origins individually rather than relaxing origin checks
for all auth routes. Preserve stable identity IDs,
explicit account linking, invitation-only space membership, role/content scopes,
revocation and expired-session behavior for HTTP and WebSockets. Keep IdP secrets
server-side and out of chat. Add focused tests and run the authentication and
installation-isolation tests against disposable databases. Do not claim support
until sign-in, logout, recovery and permission/revocation checks pass end to end.
```

## Change providers on an existing installation

Take a restorable backup of the installation database and every space database.
Stop the web process and jobs for the maintenance window. Preserve identity IDs;
Storypane never merges accounts just because their email addresses match.
Run operator commands with the **currently recorded provider** configured:

- **Clerk to local:** run `pnpm admin migrate-local-account <userId>` for each
  active installation identity and assign its hidden local password. This retains
  the Clerk mapping and revokes that identity's sessions.
- **Local to Clerk:** create/configure the corresponding Clerk accounts, set each
  Clerk account's `externalId` to its existing installation user ID, and run
  `pnpm admin link-clerk-account <userId> <clerkUserId>` for each active identity.
- Run `pnpm admin switch-provider local` or `pnpm admin switch-provider clerk`.
  It requires mappings/credentials for every active account and revokes sessions.
- Update `AUTH_PROVIDER` and the target provider's required configuration, restart,
  and verify sign-in, membership, content permissions, preview, and collaboration.

Changing only `AUTH_PROVIDER` is rejected. A provider switch does not delete old
identities or migrate third-party MFA/recovery settings. Keep the maintenance
window open until the checks pass; see [backup and recovery](self-hosting.md#backups-upgrades-and-health).

## API, agents, and preview credentials

Use credentials for their intended boundary:

| Credential                                 | Purpose                                             | Handling                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor session                             | Interactive editing and authenticated collaboration | Browser session; do not copy its cookie into CI or an agent.                                                                                         |
| Management token                           | Management API, CLI, and MCP                        | Space-scoped with explicit capabilities, constrained by the issuer's current access. Store privately on the server/agent host; revoke when finished. |
| Published delivery token                   | Website reads of published snapshots                | Keep server-side; it does not grant editor access. Cache published output deliberately in your frontend.                                             |
| Preview token or short-lived preview grant | Authorized draft preview                            | Follow the SDK's server-token/preview-bridge guidance; never expose a management token in the preview page.                                          |

An agent does not need your administrator password. Create a narrowly scoped
management token under **Settings → API & preview → Management API** and configure it privately.
See [management API, CLI, and MCP](management-api.md) for scopes and connection
examples, and the [SDK preview guide](../packages/sdk/README.md) for origin-bound
preview. Revocation, session expiry, and content filtering also apply to live
connections; reconnecting must authenticate again.

## Troubleshooting

- **Sign-in or auth writes return 403:** compare the browser origin, reverse proxy,
  and `STORYPANE_APP_URL`, including HTTP/HTTPS and port. Use the configured URL.
- **Invitation already used or expired:** revoke/reissue it; for an existing account,
  sign in with the invited email. A different signed-in account cannot accept it.
- **No Forgot password? link:** configure both mail variables and restart, or use
  operator recovery. Local signup and email verification are not recovery methods.
- **Provider mismatch after an upgrade:** restore the recorded configuration or
  complete the explicit mapping/switch procedure; do not edit identity IDs in SQL.
- **Signed in but cannot see a space:** check membership, role, and content scopes.
  Creating an identity or granting installation administration does not invite it
  into every space.

Run the [fresh-install checklist](deployment-verification.md), including recovery
and revoked-session checks, before relying on a new hosted installation.
