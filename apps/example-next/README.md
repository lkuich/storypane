# Fieldwork · Next.js example

The same Fieldwork site as the Astro example, using Next.js App Router. It shares
the React block renderer, styles, generated schema types, publication loader and
live preview bridge in `apps/example-astro/src`. Schema and design changes reach
both examples without maintaining a second copy.

## Run locally

First configure the [Astro example](../example-astro/README.md) and start Storypane.
Then, from the repository root:

```sh
pnpm example:setup:next
pnpm dev:example:next
```

Open **http://127.0.0.1:3133/home**. In Storypane, open a story's preview and choose
**Local Next.js** from the application selector. Refresh Storypane after setup if
it was already open. Astro remains the default.

Setup reuses the Astro example's space and published delivery token, writes an
ignored `.env` with owner-only permissions, and adds the Next.js preview target
to the local database. Repeating setup preserves existing configuration, content,
preview targets and the default. It only runs against the local `blok` database;
`DATABASE_URL` must match your local CMS configuration.

For a remote CMS, configure `.env` using `.env.example` and add this target in
**Settings → API & preview** yourself:

```text
http://127.0.0.1:3133/preview?slug={slug}&locale={locale}
```

Use an HTTPS preview host when the CMS uses HTTPS. Keep both examples pointed at
the same space; they share generated types. Delivery tokens stay on the server
and must never use a `NEXT_PUBLIC_` prefix.

## Content and preview

Published pages and their assets are prerendered at build time. Localized pages
use `/fr/home`; the Default locale uses `/home`. The selected footer resolves to
a published story, preferring the current locale with Default as a fallback.
Feature descriptions support the deployed rich-text schema.

The `/preview` shell uses the authenticated editor bridge and can render
unpublished stories and selected footer drafts. It supports live updates and
click-to-edit. Opening the shell outside Storypane does not expose drafts. Draft
images rely on the CMS and preview sharing a site, such as `127.0.0.1` on different
ports. This matches the Astro example.

## Commands

```sh
pnpm --filter @storypane/example-next storypane:generate # pull shared schema + generate types
pnpm --filter @storypane/example-next typecheck
pnpm lint:example                                     # lint shared Astro/React source
pnpm build:example:next
pnpm --filter @storypane/example-next start             # built site on port 3133
pnpm exec playwright test tests/next-example.e2e.ts
```

Stop the Next.js dev server before running `start` on the same port. Publishing
requires rebuilding the production site. The browser test checks published and
French pages, media, mobile layout, preview authorization, unpublished stories,
footer references, block selection and browser bundles for leaked API tokens.
It creates short-lived preview sessions without editing or publishing content.
