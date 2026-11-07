# Bring your own authentication provider

Connect your company's identity system in application code. Storypane supplies a
small server adapter and a redirect sign-in screen; your integration handles the
provider's protocol and sessions. Local Better Auth and Clerk remain built-in
choices. Neither is a required intermediary for a direct Okta or other provider.

This guide describes the integration contract. It does not ship an Okta adapter
or claim a real Okta tenant has passed acceptance.

## Add one server adapter

Create a module such as `packages/db/src/okta-auth.ts` that exports an
`AuthenticationFactory`. Select it in
[`packages/db/src/auth-providers.ts`](../packages/db/src/auth-providers.ts):

```ts
import { createOktaAuthentication } from './okta-auth.js';

// Inside createAuthentication, before the built-in provider branches:
if (options.provider === 'okta') return createOktaAuthentication(options);
```

Set `AUTH_PROVIDER=okta` in your ignored environment file. Provider names use
lowercase letters, digits and hyphens, start with a letter, and have at most 64
characters. A name without an installed implementation fails at startup. Add your
own secret validation in the adapter factory; keep credentials server-side.
Rebuild the application after adding your module. There is no dynamic plugin loader.

The factory receives the installation `pool`, provider name, application origin
and the built-in providers' optional settings. Read provider-specific credentials
from your server environment. It returns this interface, exported from
`@storypane/db/authentication`:

```ts
interface Authentication {
  config(): AuthConfig;
  getSession(request: Request): Promise<AuthSession | null>;
  assertSession(actor: { userId: string; sessionId: string }): Promise<void>;
  assertIdentity(userId: string): Promise<void>;
  handle(request: Request, tools: AuthRouteTools): Promise<Response>;
}
```

| Method                   | Responsibility                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config()`               | Return only public sign-in presentation. For Okta, use `{ provider: 'redirect', name: 'Okta', signInPath: '/api/auth/sign-in/okta' }`. Never return secrets, tokens or SDK clients.                                                                                       |
| `getSession(request)`    | Verify your cookie or bearer credential and resolve it to `{ user: { id, name, email }, session: { id } }`. The user ID must be the stable installation identity, not an email address or an unverified request value. Return `null` for no session.                      |
| `assertSession(actor)`   | Recheck session existence, expiry, revocation and ownership of the supplied local user ID. Throw `StorypaneError('unauthenticated', ...)` on failure. This runs after HTTP authentication and during preview/collaboration access, including after the initial handshake. |
| `assertIdentity(userId)` | Verify that the mapped provider identity is still allowed to operate. Used for management credentials and background operations that have an identity but no interactive session. Do not require a browser cookie here.                                                   |
| `handle(request, tools)` | Handle only your exact sign-in, callback and sign-out routes/methods under `/api/auth/`. Return 404 for everything else. Manage redirects, protocol state, session cookies and sign-out.                                                                                  |

Storypane separately checks the recorded installation provider and locally disabled
accounts. It retains installation privileges, space membership, roles and content
scopes. The adapter cannot grant these by returning extra user or role properties.
Adding a provider does not require changes to CMS routes, room code or schedulers.

An adapter scope is created for each HTTP request or room operation. You may reuse
SDK clients and deduplicate checks within that scope. Do not cache successful
session/identity decisions across operations without an explicit revocation policy.
The built-in Clerk adapter demonstrates this separation.

## Map identities explicitly

After validating the provider's claims, use the existing installation database:

```ts
import { resolveExternalIdentity } from '@storypane/db/external-identity';

const user = await resolveExternalIdentity(pool, {
  provider: 'okta',
  subject: verifiedClaims.sub,
  email: verifiedClaims.email,
  emailVerified: verifiedClaims.email_verified,
  name: verifiedClaims.name,
});
```

`verifiedClaims` must come from your trusted provider verification, never the
browser's submitted profile. The helper requires a verified email and stores the
mapping in `account` with `providerId = 'storypane:okta'` and `accountId = subject`.
It returns the stable local user, updates its verified profile, rejects locally
disabled users, and serializes concurrent creation for the same subject. It does
not create memberships or installation administrators. An email already belonging
to another identity fails instead of merging accounts.

Pin the expected issuer/tenant in the adapter. If multiple issuers can supply the
same subject, use a distinct provider name per issuer or a stable issuer/subject
pair as the mapping key. Changing that convention later requires explicit mapping.
Keep local user IDs stable when profiles, email addresses or sessions change.

Store your opaque session IDs and their local user ownership durably. The existing
`cms_sessions` table can store local grants with expiry; `assertSession` must still
verify whatever upstream session/identity state your provider requires. Access or
refresh tokens are secrets, not session IDs to expose through `/api/session`,
presence messages or logs. Encrypt any provider tokens you persist.

## Wire an Okta redirect flow

1. Choose your provider SDK or existing server session service and implement the
   adapter against it. Storypane does not mandate a particular SDK. Configure the
   expected issuer, client ID, credentials, exact callback URL and logout behavior
   in your private environment and Okta application.
2. Return the redirect configuration above. The existing screen displays
   **Continue with Okta**, navigates to the local `signInPath`, and preserves the
   current query string so your flow can retain invitation context. Only paths
   matching `/api/auth/` followed by lowercase letters, digits, slashes and hyphens
   are accepted by the screen; do not include a query string in `signInPath` itself.
3. Handle `GET /api/auth/sign-in/okta` by initiating your verified redirect flow.
   Store return context in protected protocol state; do not accept arbitrary
   external return URLs from the query string.
4. Handle your exact callback route/method, validate the provider response, resolve
   the installation identity and establish a secure session cookie. Return the
   user to the same-origin editor or preserved invitation route.
5. Implement `POST /api/auth/sign-out` to revoke the local session and clear its
   cookie. The existing account control posts JSON and expects a JSON success
   response. Use your SDK's supported server logout/revocation flow where needed;
   a front-channel-only logout needs your own account control via `AccountContext`.
6. Verify revoked sessions and disabled provider identities in both authority
   methods. A long-lived local cookie alone does not establish that the upstream
   identity is still active. Choose and document the provider calls or securely
   delivered revocation events that keep your local session state current.

The route supplies `tools.assertOrigin(request)`, bounded
`tools.readJson(request)` and persistent `tools.rateLimit(subject)`. Use them for
editor POST actions such as sign-out. Callbacks are delegated without forcing an
editor Origin header or JSON body, so your adapter must validate their protocol
state and input itself. Use bounded parsing for form callbacks and reject methods
and routes you do not implement. Standard CMS write-origin checks remain in force.
`/api/auth/config` and `/api/auth/accept-invitation` remain Storypane-owned routes.

Use the protocol library to implement authorization-code exchange, state, PKCE
and nonce checks appropriate to your flow. Pin issuer/audience, verify signatures
and expiry, and enforce the exact registered redirect URI. See
[Okta's authorization-code flow documentation](https://developer.okta.com/docs/guides/implement-grant-type/)
and [ID token validation](https://developer.okta.com/docs/guides/validate-id-tokens/main/).
Decoding a token is not verification.

## Install and change providers safely

For a new installation, implement your adapter, set its name and secrets, and run
the transactional operator migrations. After the first verified sign-in creates
an identity, an operator can grant installation administration with
`pnpm admin grant-admin <localUserId>`. Invite users into spaces through Storypane;
provider sign-in does not grant space membership.

For an existing installation, keep the currently recorded provider configured
while preparing the new one. Take a restorable backup, stop the app and jobs, and
preserve local IDs. Link each existing active account to its verified subject:

```sh
pnpm admin link-provider-account <localUserId> okta <verifiedSubjectId>
pnpm admin switch-provider okta
```

The linking command is operator-only, does not match by email, and refuses to move
a subject already linked to another identity. `switch-provider` requires an
installed adapter and mappings for every active account. It clears Storypane's
`session`, `cms_sessions` and `verification` records before recording the new
provider. A custom session store must honor that invalidation or supply its own
cleanup during maintenance; switching cannot revoke an arbitrary upstream cookie.
Only then set `AUTH_PROVIDER=okta` and restart. Keep identities, content,
memberships, media and existing encryption keys intact. The mapping check cannot
prove the target issuer configuration or credentials work; test them first in a
disposable installation.

Local and Clerk retain their existing migration commands. See
[changing providers](authentication.md#change-providers-on-an-existing-installation)
for the complete operator procedure. Do not switch providers by editing an env
file alone or by directly rewriting installation configuration in SQL.

## Verify your integration

Test the adapter's invalid credentials, token ownership, callback replay/state,
expiry, logout, remote revocation, disabled users and identity-linking behavior.
Check sign-in with no memberships, invitation acceptance, scoped HTTP reads,
management credentials, preview and two-editor collaboration. An existing socket
must lose access on the next authorization check; the standard clients heartbeat
periodically, and broadcasts also recheck each recipient. There is no universal
instantaneous provider push-disconnect mechanism.

Run focused Vitest tests, database tests, type checks and the Node build. Exercise
the sign-in/account flow with keyboard access and responsive layouts. Complete
the applicable [deployment acceptance checklist](deployment-verification.md)
against your actual provider before claiming support. Existing custom-adapter
fixture tests verify Storypane's boundary, not your tenant's callback or revocation
configuration.
