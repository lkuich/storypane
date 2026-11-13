# Documentation screenshots

`architecture.svg` is a diagram of the Node application, PostgreSQL database
boundaries, private media storage, and website integration. It is maintained with
the [architecture guide](../architecture.md).

`preview-flow.svg` diagrams the iframe, session grant, and WebSocket connection
between the editor, your frontend, and the CMS server, as described in that guide.

Captured November 6, 2026 from the current Storypane UI using an isolated local
installation and fictional Studio website, Maya, and Sam spaces. These are real
browser captures, with no mocked UI, customer content, or credentials.

- `development-space.png`: dev environment label, production link, a deployed
  caption-field migration ready to promote, and nested block-library definitions.
- `space-switcher.png`: production and its linked dev spaces, with the current
  space marked.
- `promotion-review.png`: review of that caption-field migration before applying
  it to production.
- `component-previews.png`: the real Add a block picker and isolated Hero renderer
  from the fictional Fieldwork example, captured November 6, 2026. No content is
  inserted and no customer project or credentials appear in the capture.

Refresh these when the corresponding UI changes. Keep image text legible and add
alt text where each image is embedded. The website's `pnpm docs:sync` copies this
folder alongside the canonical guides.

Captured November 12, 2026 from a disposable local installation for the
[recommended setup guide](../recommended-setup.md):

- `recommended-production.png`: fictional Studio website production space with
  **Schema read-only** enabled in General settings.
- `recommended-previews.png`: the current member's three block hover preview
  preferences disabled and saved. This is a browser capture cropped to the controls.

These captures contain no customer content or credentials.

## Documentation readability audit — November 12, 2026

- `editor-overview.png`, `block-library.png`, and `migration-review.png` reuse
  the website's November 5 Fieldwork demo captures. The editor's collaborator
  avatars are staged presentation data; they do not demonstrate live concurrency.
- `page-map.png` reuses the November 9 real, cropped panel capture from a
  disposable Fieldwork installation. It shows the current two-hop published view.
- `local-sign-in.png` and `members-and-roles.png` were captured November 12 from
  the disposable review-installation fixture with fictional accounts and real UI.
  No production content, tokens, passwords, or invitation URLs appear.
- `schema-workflow.svg`, `publication-flow.svg`, and `webhook-delivery.svg` explain
  the corresponding documented workflows. Each has a title, description, and
  equivalent alt text in its guide. These are diagrams, not UI screenshots.

`media-cdn-flow.svg` explains server-authorized publication exports and the separate
public CDN boundary. It is an illustration, not a claim of a configured CDN zone.
