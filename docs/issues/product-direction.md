# Product direction

Status: product decision recorded; marketplace idea uncommitted.
Recorded: 2026-11-06.

## Extensions are intentionally out of scope

Storypane will not pursue an extension or plugin framework for Storyblok parity.
The absence of an extension ecosystem is a deliberate scope choice, not a missing
feature to put on the implementation backlog. Direct integrations belong in
application code, using existing services and controls, as described in
[AGENTS.md](../../AGENTS.md).

## Possible prompt marketplace

The owner may explore a prompt marketplace. This is an idea, not a committed
feature or a replacement plugin architecture. No marketplace implementation,
distribution model, moderation system, or payment scope has been agreed.

Next decision: establish a concrete user need and the smallest useful prompt
sharing flow before choosing implementation work.

## Approval workflow direction

The owner reports that their team did not use Storyblok's approval gates because
they did not work well with releases. Do not treat configurable workflow parity
as a requirement. The narrower candidate is an
[optional tagged reviewer who blocks publication](reviewer-before-publish.md).

## SSO belongs to the operator's identity provider

Native SSO and a catalog of vendor-specific integrations are intentionally out of
scope. Operators choose their third-party identity software and wire it into
their installation. Storypane's responsibility is to provide clear, documented
integration boundaries while retaining its own authorization rules.

Existing local Better Auth and optional Clerk support are available implementation
paths, not a requirement to use Clerk or adopt a particular SSO vendor. This
decision does not request their removal. Provider-specific SAML/OIDC, MFA, and
provisioning configuration belong to the chosen provider and integration.

Track the remaining interface/documentation work in
[authentication integration boundaries](authentication-integration-boundaries.md).
Absence of built-in SSO is not a parity issue; unclear integration contracts or
incorrect identity/session handling are issues to address.

## Independent locale pages are intentional

Field-level translation is deliberately excluded from the current model. Each
locale has its own page content and block structure, allowing editors to translate
copy, reorder or replace sections, and adapt layouts for the local market. Editors
can import from the default locale as a starting point and publish locales
independently. Do not treat field-level translation parity as a backlog requirement.

The implementation imports selected block subtrees into a destination blocks field
with fresh IDs. Copies retain their nested content and become independent; later
default edits do not propagate. The current UI excludes the source root block,
so this is not a whole-page copy of root fields such as page-level metadata.
Import appends copies rather than merging updates into an earlier import.

References: [editor import UI](../../apps/web/src/features/editor/story-workspace.tsx),
[import command](../../packages/db/src/store.ts),
[independence test](../../packages/db/src/store.test.ts), and
[editor guide](../editor-quickstart.md#continue-with-your-team).

### Comparison and tradeoffs

Storyblok supports both field-level translation for similar structures and
folder-level translation for independent component structures and ordering.
Storypane therefore chooses one localization model rather than introducing a
capability Storyblok lacks. Keeping locale variants under one story with locale
tabs avoids requiring editors to organize them into separate language folders.
See [Storyblok internationalization](https://www.storyblok.com/docs/concepts/internationalization).

Independent copies suit market-specific landing pages and regional layouts.
Field-level translation is more economical when many languages share a structure
and most non-translated values should remain shared. With independent copies,
source corrections and common layout changes must be applied deliberately to each
affected locale; re-importing adds copies, it does not reconcile existing edits.
Copied text is a starting point, not a completed translation.

Track easier root-field copying and visibility into default changes in the
[locale copying issue](locale-copying-and-source-changes.md). Implementation is
not started; the issue preserves independent locales without automatic inheritance
or a field-level translation system.
