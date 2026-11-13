# Fieldwork · Astro example

A complete, statically built website using `@storypane/sdk`: Astro routes, typed
React block components, pulled schema JSON, and generated TypeScript block props.
Published pages render at build time; only the dedicated preview route hydrates React.

If published delivery runs separately, set `STORYPANE_DELIVERY_URL` to its origin.
It defaults to `STORYPANE_URL`, which remains the editor/preview and schema-tooling
origin. Published content and exported assets use the delivery URL.

The [Next.js version](../example-next/README.md) implements the same content contract
and can be selected as another Storypane preview application. Each example owns
its renderer, styles, schema snapshot, generated types, and publication helpers.

Configuration uses server-only `STORYPANE_*` variables.

## Add Storypane to an existing Astro app

Install the published SDK in your Astro project:

```sh
npm install @storypane/sdk@0.1.0-rc.10
```

Use its delivery client in server-side page frontmatter with private space and
delivery-token configuration. Follow the [SDK guide](../../packages/sdk/README.md)
for generated types and the React-based live preview used by this example.
Use `@storypane/sdk@rc` instead if you deliberately want to follow candidates.
The monorepo example below keeps its workspace link for source development.

## Run it

From the monorepo root, first configure local `.env` and start the current Node
installation as described in [self-hosting](../../docs/self-hosting.md#backups-upgrades-and-health):

```sh
pnpm db:start
node --env-file=.env --import tsx scripts/admin.ts migrate
node --env-file=.env --import tsx scripts/admin.ts bootstrap
pnpm dev
```

In another terminal:

```sh
pnpm --filter @storypane/example-astro setup
pnpm --filter @storypane/example-astro dev
```

Open **http://127.0.0.1:3132/home**. The setup command creates a separate
**Fieldwork · Astro example** space, six schemas, a published Home story with
Default and French locales, and an unpublished Work in progress story. It creates
scoped API keys and writes them to an ignored, owner-readable `.env`. It only
seeds a local CMS and preserves an existing `.env` and content on subsequent runs.

Set `STORYPANE_SESSION_COOKIE` from your signed-in local editor session when
running `pnpm --filter @storypane/example-astro setup`; Clerk installs can use the private
`STORYPANE_SESSION_TOKEN`. Do not commit or share either value. The French hero is translated; the other blocks deliberately start as copies.

Manage locale names and URL prefixes in **Space settings → Locales**. The build
discovers them with `client.listLocales()`; no `STORYPANE_LOCALES` environment variable
is needed. A locale gets a public route only when that story locale is published. After adding or renaming locales, rebuild the site (or restart the dev server).

For the configured default locale, call `client.listStories()` for one page or
`client.listAllStories()` for every publication; no options object is needed. Read one story with `client.getStory({ slug: 'home' })`. Add `locale: 'fr'` to
select another locale. An explicit `locale: ''` selects the root URL locale,
which may differ from the configured default.

This example paginates publications for every configured locale, using
`listAllStories()` for the default and `listAllStories({ locale: slug })` for the
others. Route generation rejects
invalid or duplicate paths, the reserved `preview`, `media`, `llms`, and `_astro` prefixes,
and Default slugs that occupy a configured locale prefix, such as `fr/home`.

To use an existing space instead, copy `.env.example` to `.env`, configure its
URL/space/tokens, and run `pnpm --filter @storypane/example-astro storypane:generate`.
Adjust the block components to match that space's schemas. Do not put either
token in a `PUBLIC_` variable. Preview tokens are used only by schema tooling;
published tokens are used only by the Astro build/server.

Content editors can group approved production pages into [content releases](../../docs/releases.md).
The existing SDK reads need no changes: only published revisions reach this site.
Rebuild static pages or revalidate cached routes after a release. Webhooks emit
one `story.published` event per page; coalesce these when triggering builds.

## Try live editing

Sign in to the CMS, open **Fieldwork · Astro example → Home → Preview**, then edit
the Hero title or a nested Feature. Updates appear after autosave. Click a block
in the iframe to select its content editor; select a block in the editor to
outline it in the iframe. Focusable blocks also support Enter/Space.

The seeded preview URL is:

```text
http://127.0.0.1:3132/preview?slug={slug}&locale={locale}
```

This static shell loads a story through the authenticated editor bridge, including
unpublished stories/locales with no built route. Open **Work in progress → Preview**
to try it. Opening `/preview` outside the CMS shows instructions, not draft data.

Use this `/preview` URL for existing integrations too. Published routes such as
`/home` and `/fr/home` always show the built publication, including inside an iframe;
preview query parameters, cookies, and the old `PUBLIC_STORYPANE_PREVIEW*` settings
no longer activate drafts on those routes. Standalone preview needs your own
authenticated session endpoint (see the SDK guide).

`PreviewShell.tsx` uses `useStorypanePreview` and the current URL's story and locale.
Changing the URL without reloading clears the old draft and disconnects its live
subscription before connecting the new story. References arrive with the authorized
preview payload, so the shell does not need a build-time copy of published stories.

To prove preview works after a static build, stop the dev server and run:

```sh
pnpm --filter @storypane/sdk build
pnpm --filter @storypane/example-astro build
pnpm --filter @storypane/example-astro preview
```

Now edit in the CMS again. The public HTML remains the published snapshot; `/preview`
updates through its React island. Publishing requires rebuilding/redeploying the
public site. Published pages ship no React runtime or preview subscription; a small
script restores the decorative artwork if a hero image fails to load.

The preview island also enables [component hover previews](../../packages/sdk/README.md#block-hover-previews). It passes `onComponent` to the SDK and renders that block through the same `Content`
renderer, without the preview status bar. Hover or focus an existing block or a
picker entry in the editor; saved blocks use their content, and picker entries
use the samples in `storypane/preview-data.json`.

The setup script installs these
samples in new spaces. For an existing space, paste each sample into its block's
**Config → Picker preview data (JSON)** and deploy the schema migration. Blocks
without samples have no picker preview. Samples never change inserted defaults. No separate preview route or token is needed.

## Pull schemas and generate TypeScript

```sh
pnpm --filter @storypane/example-astro storypane:pull     # CMS → storypane/components.json
pnpm --filter @storypane/example-astro storypane:types    # local JSON → src/types/storypane.ts
pnpm --filter @storypane/example-astro storypane:generate # both steps
```

`storypane:pull` loads this app's `.env` and uses a **Preview · server only** token.
The schema endpoint is space-scoped, rejects published-only/revoked tokens, and
exports deployed schema metadata without defaults, draft values, or data-source
URLs. `storypane:types` works offline. Commit both files; regenerate after deploying
schema migrations. The checked-in schema is a sample; setup replaces its IDs with those in
your own local space.

The SDK's `storypane` executable can be used in other projects too:

```sh
storypane pull-components --out storypane/components.json
storypane generate-types --input storypane/components.json --out src/types/storypane.ts
```

Pull reads `STORYPANE_URL`, `STORYPANE_SPACE_ID`, and `STORYPANE_PREVIEW_TOKEN` from the process
environment. With Node 24 you can load a file explicitly using
`node --env-file=.env node_modules/@storypane/sdk/bin/storypane.mjs pull-components --out storypane/components.json`.
Invalid input leaves the previous output untouched.

Generated types include `HeroBlock`, `PageBlock`, `StorypaneComponentMap`, and unions for
all blocks, nestable blocks, and content types. Each interface has a literal
`component` discriminant and `_uid`. Nested fields honor allowed definitions;
inline choices become literal unions; dynamic choices remain string IDs. Asset,
link, rich text, number, boolean, date, and text formats have matching value types.
Optional fields account for empty values; required fields describe valid
publications. Dates remain strings, markdown remains text, and story options
remain IDs—the SDK does not silently resolve references.

For example:

```tsx
import { editable } from '@storypane/sdk';
import type { HeroBlock } from '../types/storypane';

function Hero({ block }: { block: HeroBlock }) {
  return (
    <section {...editable(block)} tabIndex={0}>
      <h1>{block.title || 'Untitled'}</h1>
      <p>{block.description}</p>
    </section>
  );
}
```

The switch in `src/components/blocks/block.tsx` maps each schema name to a typed
component in its own file. Add a case when adding a schema. `Page` composes the
header, `PageBody`, and selected footer; `PageBody` groups adjacent feature cards. References and preview settings are explicit props, matching the Next.js example.

Drafts can be incomplete; renderers should tolerate missing required content. Generated types are compile-time contracts, not runtime validators. They describe
the pulled deployed migration. The delivery client and preview components pass
its generated `storypaneMigrationVersion`; outdated integrations warn and keep
receiving content. Schema deployment migrates both drafts and live publications.

The current example supports hero images, rich-text descriptions, linked feature cards placed directly in
a page body, and a shared footer selected through `page.footer`. Story links and
footer references use published stories in the page's locale, with Default as a
fallback. Publish the referenced footer (separately or with the page during publish
review) and rebuild before it appears on the public site.

In authenticated live
preview, the selected footer uses its current draft,
including unpublished footers. Changes made in another tab refresh on the preview
heartbeat (within 15 seconds); changing the selection refreshes with the page save.

Published assets are downloaded through the server-side delivery client and built
into `/media/` alongside the static pages. Visitors never receive a CMS token or
need a CMS login. Rebuild after changing or removing published assets. Local CMS
preview uses the signed-in editor's asset URLs so newly selected draft images can
appear immediately; this relies on the CMS and example using the same site
(such as `127.0.0.1` on different ports).

### Opt-in public responsive media

Static export remains the default. To serve responsive variants directly from the
CMS, an administrator must enable **API & preview → Public media delivery** for
the space. Use the SDK's standalone helper in an Astro component or renderer:

```astro
---
import { publicAssetUrl, type PublicImageOptions } from '@storypane/sdk';
const { assetId, alt, spaceId, cmsUrl } = Astro.props;
const image = (width: PublicImageOptions['width']) =>
  publicAssetUrl({ url: cmsUrl, spaceId, assetId }, { width, aspect: '16:9' });
---

<img
  src={image(640)}
  srcset={`${image(320)} 320w, ${image(640)} 640w, ${image(1280)} 1280w`}
  sizes="(max-width: 640px) 100vw, 50vw"
  width="1280"
  height="720"
  alt={alt ?? ''}
/>
```

The HTML contains IDs and supported image options, never a token. Public URLs work
only while an active publication uses the asset; draft preview still uses the
authenticated editor route. Saving focal metadata updates cover crops globally. Public responses are not browser/CDN cached; the Node runtime rechecks eligibility
and computes variants on demand.

Disabling the setting or removing the last
live reference returns 404 on the next request. Already exported `/media/` files
remain until a rebuild removes them. See the [SDK media contract](../../packages/sdk/README.md#public-media-urls)
for supported variants, still-frame animation, and image size limits.

## Files and checks

| File                                                  | Purpose                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/cms.ts`                                      | Discover space locales, fetch publications, paginate, build routes |
| `src/lib/publications.ts`                             | SDK publication pagination and Astro route validation              |
| `src/pages/[...path].astro`                           | Static route generation                                            |
| `src/components/PreviewShell.tsx`                     | Preview of unpublished stories/locales                             |
| `src/components/content.tsx`                          | Shared entry point for public and preview rendering                |
| `src/components/blocks/`                              | Block switch, individual components, and page body layout          |
| `storypane/components.json`, `src/types/storypane.ts` | Pulled schema and generated types                                  |

From the repository root, `pnpm --filter './apps/example-*' lint` checks both self-contained examples with ESLint and Prettier. The shared configuration includes recommended
JavaScript/TypeScript/Astro rules, React hook checks, and Next.js rules for the Next
example. `pnpm --filter @storypane/example-astro lint` checks only this app.
Generated schema types are checked by TypeScript instead. Use `pnpm format` to
apply the repository's formatting conventions.

`pnpm typecheck` includes Astro checking. `pnpm --filter @storypane/example-astro build` checks and builds
this site; root `pnpm build` builds the CMS/SDK independently of a configured CMS
connection. With the CMS running and the example built, run:

```sh
pnpm exec playwright test tests/astro.e2e.ts
```

Playwright starts the built Astro preview server. The publication and preview
contract test checks static pages, assets and image fallback, locales, unpublished
preview, selected footers, URL changes, and absence of API keys in browser assets.
It uses the local example's preview token and requires no saved Clerk session:

```sh
pnpm exec playwright test tests/astro.e2e.ts -g 'Astro publication and preview contract'
```

The editor integration test also verifies live edits and nested selection using
a configured Clerk admin session. It restores the edited draft and preview settings.
The full browser suite skips this test if the example has not been configured.

The generated `dist/` can be hosted as static assets, including on Cloudflare.
Use an HTTPS preview URL when the CMS is HTTPS, permit the CMS origin in
`frame-ancestors`, and avoid an incompatible `X-Frame-Options` header. Deployment,
standalone preview authentication, and a public DAM/CDN are outside this example.

For authoring and CI/CD, the SDK also supports `storypane migrations pull`,
`storypane migrations create "description"`, and `storypane migrations push
--deploy --yes`. These use a separate management token issued by an admin in
**Blocks → Schema migrations → CLI access**. See the
[SDK guide](../../packages/sdk/README.md#schema-migrations-and-generated-types).

## Working with linked dev spaces

For a new team, follow the [recommended setup](../../docs/development-workflow.md):
one production space for content editors, with schema protection enabled, and one
linked dev space per developer. The seeded Fieldwork example is a local demo;
cloning its schema does not copy its sample site content in bulk.

Keep authoring CLI credentials pointed at a linked dev space and provide its
production token separately as `STORYPANE_PRODUCTION_MANAGEMENT_TOKEN`. Deploy and
test schema changes in dev, then run `storypane migrations promote`. Use
`storypane migrations status` and `storypane migrations sync` when another
developer advances production. Block-library nesting and nested-block restrictions
travel with the migration; content dependencies are reviewed and copied as drafts.

Configure a local/test instance of this frontend with dev's space ID, tokens,
and deployed types; create sample stories there and register its preview URL in
dev. Configure the live frontend and its preview with production's credentials.
The preview bridge is bound to one space, so a production-configured instance
cannot preview a dev story. Clones do not copy preview targets or tokens.

Before building this example for production, point its existing delivery/preview
configuration at production and run `pnpm storypane:generate` from this app's
directory. That pulls production's deployed schema and migration version. Keep
management tokens server-side and separate from delivery configuration. See the
[linked-space workflow](../../packages/sdk/README.md#linked-development-and-production-spaces)
for conflict resolution, CI, and generating from a separately pulled production
migration file.

## SEO and Markdown mirrors

The Page schema has an optional `seo` blocks field (maximum one **SEO & AI**
block). `src/lib/seo.ts` maps its title, description, canonical, social image,
and robots settings into page metadata. Set `SITE_URL` to your public frontend
origin before a production build.

Enable **Markdown mirror enabled**, publish the page, and rebuild to generate
`/llms/{locale}/{slug}.md`; omit the locale segment for the root locale. An
alternate link in the HTML and `/llms.txt` advertise eligible mirrors. Mirrors
require published, explicitly enabled, indexable pages. Missing/false settings,
no-index pages, and non-page content types are excluded. New presets default to
off; the fresh Astro setup opts its fictional default-locale Home page in.

The serializer includes known visible body fields and plain rich-text content.
Extend it alongside your renderers when adding components. An SEO block has no
visible body renderer. Publishing an opt-out and rebuilding removes both the
mirror and its discovery entry; deploy a complete fresh build to remove stale
files. The [SEO & AI guide](../../docs/seo-ai.md) explains setup, hosting headers,
and the limits of AI discovery.

## Edge-optimized image delivery

For a public website CDN, follow the [media CDN guide](../../docs/media-cdn.md).
Adapt the existing published-asset export to content-hashed paths, then configure
responsive edge variants and a verified removal/purge workflow. Keep authenticated
preview images on the CMS route; direct public-media variants remain `no-store`.
