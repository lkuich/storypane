# Fieldwork · Astro example

A complete, statically built website using `@storypane/sdk`. It follows the reference
Storyblok app's structure: Astro routes, a hydrated React component registry,
pulled schema JSON, and generated TypeScript block props.

New configuration uses `STORYPANE_*` / `PUBLIC_STORYPANE_*` variables. Existing
`BLOK_*` / `PUBLIC_BLOK_*` values remain supported, so the rename does not require
replacing your local `.env` or its tokens.

## Run it

From the monorepo root, start the local CMS first (see the root README):

```sh
pnpm db:start
pnpm db:setup
pnpm dev
```

In another terminal:

```sh
pnpm example:setup
pnpm dev:example
```

Open **http://127.0.0.1:3132/home**. The setup command creates a separate
**Fieldwork · Astro example** space, five schemas, a published Home story with
Default and French locales, and an unpublished Work in progress story. It creates
scoped API keys and writes them to an ignored, owner-readable `.env`. It only
seeds a local CMS and preserves an existing `.env` and content on subsequent runs.
The French hero is translated; the other blocks deliberately start as copies.

Manage locale names and URL prefixes in **Space settings → Locales**. The build
discovers them with `client.listLocales()`; no `STORYPANE_LOCALES` environment variable
is needed. A locale gets a public route only when that story locale is published.
After adding or renaming locales, rebuild the site (or restart the dev server).

To use an existing space instead, copy `.env.example` to `.env`, configure its
URL/space/tokens, and run `pnpm --filter @storypane/example-astro storypane:generate`.
Adjust the component registry to match that space's schemas. Do not put either
token in a `PUBLIC_` variable. Preview tokens are used only by schema tooling;
published tokens are used only by the Astro build/server.

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

To test preview on the built page itself, change **Settings → API & preview →
Application preview URL** to `http://127.0.0.1:3132/{locale}/{slug}`. Default locale
has no prefix; French uses `/fr/home`. The query parameter, a `blok_preview=1`
cookie, or `PUBLIC_STORYPANE_PREVIEW=true` activates the SDK in `Story.tsx`; the parent
editor still supplies authorization. Standalone preview needs your own
authenticated session endpoint (see the SDK guide).

To prove preview works after a static build, stop the dev server and run:

```sh
pnpm build:example
pnpm --filter @storypane/example-astro preview
```

Now edit in the CMS again. The public HTML remains the published snapshot; preview
updates through the React island. Publishing requires rebuilding/redeploying the
public site. Astro's [`client:load` integration](https://docs.astro.build/en/guides/integrations-guide/react/)
hydrates the same component tree that produced the build-time HTML.

## Pull schemas and generate TypeScript

```sh
pnpm --filter @storypane/example-astro storypane:pull     # CMS → storypane/components.json
pnpm --filter @storypane/example-astro storypane:types    # local JSON → src/types/storypane.ts
pnpm --filter @storypane/example-astro storypane:generate # both steps
```

`storypane:pull` loads this app's `.env` and uses a **Preview · server only** token.
The schema endpoint is space-scoped, rejects published-only/revoked tokens, and
exports current schema metadata without defaults, draft values, or data-source
URLs. `storypane:types` works offline. Commit both files; regenerate after changing
schemas. The checked-in schema is a sample; setup replaces its IDs with those in
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
  return <section {...editable(block)} tabIndex={0}>
    <h1>{block.title || 'Untitled'}</h1>
    <p>{block.description}</p>
  </section>;
}
```

The registry in `src/components/blocks.tsx` uses `satisfies StorypaneComponentMap`'s
mapped props, so missing registrations or incompatible props fail type checking.
Drafts can be incomplete; renderers should tolerate missing required content.
Generated types are compile-time contracts, not runtime validators. They describe
the current schema; older publications keep their original schema until migrated.

## Files and checks

| File | Purpose |
| --- | --- |
| `src/lib/cms.ts` | Discover space locales, fetch publications, paginate, build routes |
| `src/pages/[...path].astro` | Static route generation |
| `src/components/Story.tsx` | Published-first rendering and live preview hook |
| `src/components/PreviewShell.tsx` | Preview of unpublished stories/locales |
| `src/components/blocks.tsx` | Typed component registry and editable markers |
| `storypane/components.json`, `src/types/storypane.ts` | Pulled schema and generated types |

`pnpm typecheck` includes Astro checking. `pnpm build:example` checks and builds
this site; root `pnpm build` builds the CMS/SDK independently of a configured CMS
connection. With the CMS running and the example built, run:

```sh
pnpm exec playwright test tests/astro.e2e.ts
```

Playwright starts the built Astro preview server, verifies live updates, nested
selection, locales, unpublished preview, unchanged public HTML, and absence of
API keys in browser assets. It restores the edited draft and preview settings.
The full browser suite skips this test if the example has not been configured.

The generated `dist/` can be hosted as static assets, including on Cloudflare.
Use an HTTPS preview URL when the CMS is HTTPS, permit the CMS origin in
`frame-ancestors`, and avoid an incompatible `X-Frame-Options` header. Deployment,
standalone preview authentication, and public DAM delivery are outside this example.
