# Local issues and product decisions

Recorded 2026-11-06. These are planning and implementation records; each document states its status. No external issues have been created.

- [Product direction](product-direction.md): intentional exclusions of extensions,
  native SSO, and field-level translation, independent locale copies, and a possible
  prompt marketplace.
- [Authentication integration boundaries](authentication-integration-boundaries.md):
  clear interfaces for operator-chosen identity providers and retained authorization.
- [Optional reviewer before publishing](reviewer-before-publish.md): implemented
  in rc.5, with requirements checked against the selected content version.
- [Locale copying and source changes](locale-copying-and-source-changes.md): easier
  initial copying and visibility into default changes without coupling locales.
- [Reliability gaps](reliability.md): outstanding hosted acceptance, recovery,
  security review, load measurement, and the single-replica constraint.
