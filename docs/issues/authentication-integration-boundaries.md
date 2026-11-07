# Clarify authentication integration boundaries

Status: implemented; provider-specific acceptance remains the operator’s responsibility.
Recorded: 2026-11-06.

## Product boundary

Operators choose their identity provider and implement their SSO connection in
application code. Storypane should expose clear interfaces and integration
guidance, without prescribing a third-party vendor or building a generic plugin
framework. Native SSO, additional vendor adapters, and a built-in SCIM service
are not requested by this issue.

## Current state

The shared `AuthenticationFactory` now supplies HTTP authentication, session and
identity authority, auth handlers, and public sign-in configuration for both
built-in providers. Direct providers are selected in one source factory; redirect
providers can reuse the existing UI. Explicit external identity mapping and
provider-switching commands retain local IDs and installation authority.

See [bring your own provider](../bring-your-own-auth-provider.md) for the contract,
integration steps and acceptance requirements. A third-party SDK or tenant is
not supplied or verified by the abstraction itself.

The review below records the pre-change baseline; its coupling findings motivated
the implementation and do not describe the new adapter boundary.

## Implementation verification — 2026-11-06

The full Vitest run passed 543 tests with six opt-in checks skipped. After the
final session-routing and provider-switch changes, all 28 focused auth, route and
installation tests passed. SDK/app/example type checks, lint and the Node build
passed. Five browser checks covered local sign-in/invitation/logout, loading,
redirect sign-in with invitation context, invalid external sign-in paths and
sign-out failure/retry. Responsive and keyboard checks used the disposable local
production build. Custom provider claims and remote checks use fixtures; no real
Okta or Clerk tenant was exercised. See the
[verification record](../deployment-verification.md#authentication-provider-boundary--2026-11-06).

## Pre-change verification results — 2026-11-06

Reviewed source revision `e30a7e0` with the local planning documents. Verdict:
the content authorization boundary is reusable, but provider integration still
requires coordinated application changes. A custom provider cannot currently be
selected through configuration or supplied through one provider-neutral contract.

### Existing integration boundaries

| Boundary                  | Current contract and behavior                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP session resolution   | `authenticateSession(request, services)` resolves `{ user: { id, name, email }, session: { id } }` from local Better Auth or Clerk and checks installation session authority. `authenticate()` selects the space and obtains its role separately.                                                                                       |
| Content session authority | `StorypaneStore` accepts `authorizeSession(actor): Promise<void>` and `authorizeIdentity(userId): Promise<void>`. Failure must reject the operation. `Installation.acquire()` currently supplies its own provider-specific implementations. These callbacks do not replace membership or content-scope checks.                          |
| Identity mapping          | Clerk uses a local identity ID or an explicitly assigned `externalId`; unknown imported IDs and mappings owned by another account are rejected. Provider changes require explicit migration and preserve local identities.                                                                                                              |
| Session lifetime          | Local authority checks the persisted Better Auth session, expiry, and disabled account. Clerk authority checks the persisted grant plus remote session ownership/status and banned/locked users; grant expiry is bounded to 60 seconds or token expiry, whichever is sooner.                                                            |
| Realtime access           | `liveRequest()` authenticates the upgrade and constructs internal actor headers. `Room` rechecks authority and recipient scopes on messages and broadcasts. The Node room service creates fresh Clerk checks per room operation. Revocation is observed on the next check, not through an immediate provider push to every idle socket. |
| Preview access            | Origin-bound opaque preview credentials select the space; user-backed preview reads recheck the originating session and content access. Preview delivery tokens follow their separate token scope and revocation rules.                                                                                                                 |
| UI                        | `AuthenticatedApp` accepts load/sign-in state, `getToken`, a sign-in element, and a `local` flag; `AccountContext` can supply account controls. The root configuration still chooses only local or Clerk.                                                                                                                               |

### Concrete coupling to address or document

- `Provider` and `authProvider()` permit only `local` and `clerk`. Installation
  configuration records that choice; changing environment variables alone cannot
  install another provider.
- HTTP session resolution, `Installation.assertSession()` and `assertIdentity()`,
  and Node room check creation branch on those providers. Implementing sign-in
  alone is insufficient: management identity checks, background work, preview,
  and collaboration must retain the matching authority checks.
- The auth route allowlists local password/session endpoints and otherwise only
  handles Clerk sign-out. New SSO callbacks are not exposed by adding a Better
  Auth plugin alone. POST handling also expects editor origin and a JSON body;
  callback methods, body formats, origin checks, and protocol state validation
  require a deliberate integration path.
- CMS HTTP routing accepts non-management bearer credentials only in Clerk mode.
  A custom bearer-token provider must account for this explicit restriction.
- Frontend configuration, invitation/account controls, environment validation,
  and operator provider migration must be included in a direct integration.

These are integration usability gaps, not evidence of an authorization bypass.
Keep this issue open for a clear end-to-end contract and focused integration
guidance; native SSO remains outside the requested product scope.

### Checks run

Used Node 24.22.0 and a newly created disposable PostgreSQL 18 cluster on
`127.0.0.1:55449`; existing application databases were not used. Across six suites,
147 tests passed:

- `apps/web/src/lib/clerk-auth.test.ts`
- `packages/db/src/clerk-checks.test.ts`
- `packages/db/src/installation.test.ts`
- `apps/realtime/src/room.test.ts`
- `packages/db/src/accept-invitation.test.ts`
- `packages/db/src/store.test.ts`

The initial combined run passed five suites but the installation suite correctly
rejected the fixture: its dedicated cluster also contained the ordinary test
database with public CONNECT. Removed that disposable database and reran the
installation suite in isolation; all 17 installation tests passed. No application
code or isolation guard was changed to make the tests pass.

Coverage includes real local password authentication/recovery, explicit identity
migration, space isolation, disabled-account rejection for preview/management,
socket rejection after access loss, field-scope filtering, and lease secrecy.
Clerk requests and revocation are mocked; this does not establish a working custom
IdP connection, real Clerk acceptance, browser callback compatibility, or hosted
deployment readiness. Runtime code was unchanged; no new build or browser run was
performed for this review.

## Original acceptance criteria

- Document the minimal contract between external identity/session verification
  and Storypane's local identity and authorization services: inputs, returned
  identity/session values, expiry, failures, and revocation behavior.
- Identify the exact integration points for sign-in UI, callback routes, HTTP
  authentication, preview/collaboration connections, and ongoing session checks.
  Explain the auth route allowlist and callback/origin handling.
- Document stable identity mapping and explicit account linking on provider
  changes. Matching email alone must not merge accounts or grant access.
- Preserve Storypane-controlled installation privileges, space membership, roles,
  content scopes, and local disabled-account checks. Successful external sign-in
  must not confer these permissions automatically.
- Explain how expiry, logout, revoked sessions, and disabled identities stop access
  through HTTP and existing WebSocket connections, including reconnects.
- Present existing provider paths as choices; make clear what an operator must
  implement and verify for a different provider, without requiring a Clerk hop.

Inspect the existing boundaries first. Improve documentation where it suffices;
only propose a small shared interface if the current coupling prevents a focused
direct integration. Do not build an adapter registry or framework speculatively.

## Relevant code (review baseline)

- [`apps/web/src/lib/context.ts`](../../apps/web/src/lib/context.ts)
- [`apps/web/src/lib/clerk-auth.ts`](../../apps/web/src/lib/clerk-auth.ts)
- [`packages/db/src/local-auth.ts`](../../packages/db/src/local-auth.ts)
- [`packages/db/src/installation.ts`](../../packages/db/src/installation.ts)
- [`apps/web/src/app/api/auth/[...all]/route.ts`](../../apps/web/src/app/api/auth/[...all]/route.ts)
- [`apps/realtime/src/room.ts`](../../apps/realtime/src/room.ts)

## Provider acceptance

Check the documented contract against both existing provider paths. If runtime
code changes, test identity mapping, denied memberships, expiry/revocation, and
recipient filtering across HTTP and realtime using disposable fixtures. An actual
custom SSO connection must pass its own end-to-end acceptance before being called
supported; interface documentation alone cannot establish that result.

The existing [reliability issues](reliability.md) still require authentication and
revocation verification. Delegating sign-in to a provider does not remove those
obligations from Storypane's integration boundary.
