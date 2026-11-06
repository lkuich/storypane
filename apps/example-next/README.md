# Storypane + Next.js

A self-contained App Router example. Published content is fetched on the server;
React components render the returned blocks. A separate `/preview` route subscribes
to live drafts. Nothing in this app imports the Astro example.

## Start with these files

| File                                                                   | What you change                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`src/lib/storypane.ts`](src/lib/storypane.ts)                         | Connect to your Storypane space. The delivery token stays here, on the server. |
| [`src/app/[...path]/page.tsx`](src/app/[...path]/page.tsx)             | Fetch a story, set metadata, and render it in a Next.js page.                  |
| [`src/components/blocks/block.tsx`](src/components/blocks/block.tsx)   | Map Storypane component names to your React components.                        |
| [`src/components/blocks/hero.tsx`](src/components/blocks/hero.tsx)     | An example of rendering generated, typed fields in your own markup.            |
| [`src/components/preview-story.tsx`](src/components/preview-story.tsx) | Subscribe to drafts with `useStorypanePreview`.                                |
| [`src/types/storypane.ts`](src/types/storypane.ts)                     | Generated types for the deployed schema; regenerate instead of editing.        |

Content editors can group approved production pages into [content releases](../../docs/releases.md).
The existing SDK reads need no changes: only published revisions reach this site.
Rebuild static pages or revalidate cached routes after a release. Webhooks emit
one `story.published` event per page; coalesce these when triggering builds.

## Add Storypane to an existing Next.js app

You don't need to adopt this example's layout or routing. The basic integration
is one server client and a fetch in any Server Component.

Install the published SDK and `server-only` in your Next.js project:

```sh
npm install @storypane/sdk@0.1.0-rc.2 server-only
```

This monorepo uses a workspace link for its example. In your own app, pin the
published version, or use `@storypane/sdk@rc` to follow candidates. Generate your
schema types using the CLI described below, then configure the client:

```ts
// src/lib/storypane.ts
import 'server-only';
import { createStorypaneClient } from '@storypane/sdk';
import { storypaneMigrationVersion, type StorypaneContentType } from '@/types/storypane';

export const storypane = createStorypaneClient<StorypaneContentType>({
  url: process.env.STORYPANE_URL!,
  spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_DELIVERY_TOKEN!,
  migrationVersion: storypaneMigrationVersion,
});
```

Fetch content in your route. The generated union narrows when you check
`content.component`, so fields stay typed without casts:

```tsx
// src/app/about/page.tsx
import { storypane } from '@/lib/storypane';

export default async function AboutPage() {
  const story = await storypane.getStory({ slug: 'about' });
  if (story.content.component !== 'page') {
    return null;
  }
  return <h1>{story.content.title}</h1>;
}
```

For a page composed of blocks, pass `story.content` to your renderer instead.
This example's [`Block`](src/components/blocks/block.tsx) uses a plain `switch`:
`hero` renders `Hero`, `feature` renders `Feature`, and so on. Each component
accepts its generated type and renders normal JSX. Add `editable(block)` to its
wrapper to support selection in the editor. Rich text uses
`<RichText value={block.text} />` from `@storypane/sdk/rich-text`.

The SDK returns content, not React components. You own the markup, styling,
URLs, and which CMS fields appear on a page.

## How this example loads data

```text
Next.js build / Server Component
  → lib/storypane.ts (server-only credentials)
  → Storypane delivery API (published snapshots)
  → story.content (typed blocks)
  → StoryContent → Block → Hero / Feature / Footer
```

- `getStory({ slug })` reads one published story in the configured default locale.
  Add `locale: 'fr'` to select another locale. Missing publications
  throw `StorypaneError` with status `404`; the catch-all route calls `notFound()`
  only for that case. Other failures surface rather than becoming false 404s.
- `listStories()` reads one page; `listAllStories()` follows pagination. Both use
  the configured default locale with no options object. `getPublishedStories`
  also fetches the other configured locales with `listAllStories({ locale: slug })`
  to build the site index.
- `generateStaticParams` turns the index into paths. Default uses `/home`;
  French uses `/fr/home`; nested slugs work. Reserved or ambiguous paths fail the build.
- [`lib/content.ts`](src/lib/content.ts) resolves story links and the selected
  footer. It prefers the page's locale and falls back to Default for shared content.
- [`app/media/[assetId]/route.ts`](src/app/media/[assetId]/route.ts) copies referenced
  published assets into build output. The browser loads `/media/:id`, without a token.

An explicit `locale: ''` selects the root URL locale, even if another locale is
configured as the default. The catch-all route keeps this explicit to match its URL.

This example explicitly prerenders pages and media at build time. Its SDK client
bypasses persistent fetch caching, and React `cache()` deduplicates calls during
rendering. **Rebuild after publishing content or deploying a schema migration.**
For request-time pages, use the same client in your own dynamic route; choose
caching to match your app rather than copying these static-route settings.

Published pages render through Server Components. Only the hero's image-error
fallback needs client state. No preview subscription is shipped by the published
page renderer.

## Live preview

Configure this application URL in **Storypane → Settings → API & preview**:

```text
http://127.0.0.1:3133/preview?slug={slug}&locale={locale}
```

[`app/preview/page.tsx`](src/app/preview/page.tsx) passes the public CMS URL and
space ID into a Client Component, wrapped in `Suspense` for `useSearchParams`.
The client reads `slug` and `locale` from the URL and calls:

```tsx
const { story, status, error } = useStorypanePreview<StorypaneContentType>({
  cmsUrl,
  spaceId,
  migrationVersion: storypaneMigrationVersion,
  story: { slug, locale },
});
```

The SDK obtains a short-lived session from the authenticated editor, subscribes
to updates, and cleans up when the route changes or unmounts. The same block
components render the draft. Referenced footer drafts arrive in `story.references`,
so an unpublished footer can appear without rebuilding the public site.

This route also works for stories that have never been published. Opening it
outside Storypane shows an empty preview, without fetching drafts. No long-lived
token is passed to a Client Component or placed in the URL. The separate
`STORYPANE_PREVIEW_TOKEN` setting is for schema tooling and browser tests, not the
preview component.

Allow the CMS origin to frame your preview host, and use HTTPS when your CMS uses
HTTPS. Draft images use the editor's CMS cookie; run the CMS and preview on the
same site (locally, `127.0.0.1` on different ports). The example bypasses Next's
image optimizer so authenticated draft images load in the browser.

## Run locally

With an existing local Fieldwork space from the Astro demo:

```sh
# Repository root: reuse that space and register an optional Next.js preview target.
pnpm --filter @storypane/example-next setup
pnpm --filter @storypane/sdk build
pnpm --filter @storypane/example-next dev
```

Open **http://127.0.0.1:3133/home** and choose **Local Next.js** in the editor's
preview selector. Setup preserves existing content, preview targets, and the
default target. Sharing the demo space is optional; the app itself is independent.

To use your own space, copy `.env.example` to `.env` in this directory. Set
`STORYPANE_URL`, `STORYPANE_SPACE_ID`, and a **Published content** delivery token.
Set a server-only **Preview** token as `STORYPANE_PREVIEW_TOKEN` when pulling
schemas. Never prefix either token with `NEXT_PUBLIC_`. Register the preview URL
in Storypane yourself for a remote CMS; the setup script only configures the selected local demo space through the CMS API.

## Schema and checks

From the repository root:

```sh
pnpm --filter @storypane/example-next storypane:generate # pull deployed schema + generate local types
pnpm --filter @storypane/example-next storypane:types    # regenerate offline from the checked-in snapshot
pnpm --filter @storypane/example-next lint
pnpm --filter @storypane/example-next typecheck
pnpm --filter @storypane/sdk build
pnpm --filter @storypane/example-next build
pnpm --filter @storypane/example-next start              # production server on port 3133
pnpm exec playwright test tests/next-example.e2e.ts
```

Commit `storypane/components.json` and `src/types/storypane.ts` together. These
belong to this app and track its deployed migration version. Pulling does not
apply an active migration or publish content. An outdated SDK logs a version
warning while continuing to return content.

Stop the dev server before starting a production server on the same port. The
browser test uses this app's `.env` and preview token; it covers publications,
locales, assets, unpublished previews, footer references, block selection, mobile
layout, and checks for tokens in browser output. It creates temporary preview
sessions without editing or publishing stories.

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
