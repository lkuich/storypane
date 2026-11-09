# Documentation screenshots

`architecture.svg` is a diagram of the Node application, PostgreSQL database
boundaries, private media storage, and website integration. It is maintained with
the [architecture guide](../architecture.md).

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
