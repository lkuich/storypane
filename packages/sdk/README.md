# Storypane SDK

Use `@storypane/sdk`, `createStorypaneClient`, and `useStorypaneStory` in new apps.
The previous `createBlokClient`, `useBlokStory`, and `Blok*` type exports remain
aliases within this package. The `blok` CLI alias and legacy `BLOK_*` environment
variables also continue to work; `STORYPANE_*` settings take precedence.
Preview messages, editable attributes, and the default `blok_preview` parameter
retain their existing identifiers so previously built preview apps still connect.

TypeScript SDK for published content and live, read-only draft preview. Works with
Node, Workers, browsers, Next.js client components, and Astro islands/scripts.
The package has no runtime dependencies; React is an optional peer dependency.

See the [working Astro example](../../apps/example-astro/README.md) in this monorepo
for a built site, typed block registry, locale pages, and unpublished-story preview.

Build from this monorepo with `pnpm --filter @storypane/sdk build`. Until an npm release,
install a packed archive or link `packages/sdk` into your app. Three entrypoints:

- `@storypane/sdk`: delivery client, types, preview detection, editable attributes.
- `@storypane/sdk/preview`: framework-independent browser subscription and editor bridge.
- `@storypane/sdk/react`: `useStorypaneStory` and `editable` for a client component/island.

## Configure the CMS

In **Space settings → API & preview**, create a **Published content** token and
set the application preview URL, e.g. `https://site.example/{locale}/{slug}`.
Default locale contributes an empty path segment; the editor removes doubled
slashes. `{slug}` is the selected locale's URL slug. Query placeholders also work:
`https://site.example/preview?slug={slug}&locale={locale}`.

The default preview parameter is `blok_preview=1`. You can change its name in
settings; use the same name in your SDK options. Your app must permit the CMS
origin in its CSP `frame-ancestors` policy and must not send a conflicting
`X-Frame-Options` header. An HTTPS CMS requires an HTTPS app; localhost HTTP is
supported for development.

## Published content

```ts
import { createStorypaneClient, type StorypaneBlock } from '@storypane/sdk'
import { storypaneMigrationVersion } from './types/storypane'

const storypane = createStorypaneClient({
  url: process.env.STORYPANE_URL!,
  spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_DELIVERY_TOKEN!,
  migrationVersion: storypaneMigrationVersion,
})

const page = await storypane.getStory({ slug: 'home', locale: '' })
const byId = await storypane.getStory({ id: page.id, locale: '' })
const { stories, nextOffset } = await storypane.listStories({ locale: '', limit: 50 })
const locales = await storypane.listLocales() // [{ id, name: 'Default', slug: '' }, ...]
```

These reads use the CMS delivery API, which queries publication snapshots in
Postgres. Drafts and unpublished locales never appear. No locale fallback is
implicit. A missing published story throws `StorypaneError` with `status === 404`.
Each content block includes `_uid` and `component`; nested block fields contain
arrays. Schema-specific generics are supported: `storypane.getStory<MyPage>(...)`.

`listLocales()` reads the names and prefixes configured in **Space settings →
Locales** using a published or preview token. It exposes no draft content. Use
these slugs with `getStory` / `listStories` to build routes; locales with no
published stories return an empty list. Slug changes preserve content IDs but
require updating old links and rebuilding static routes.

API responses are `no-store` so token revocation and new publications take effect
on the next request. Your app can deliberately cache/build the published response.
SSG pages still need a rebuild or framework revalidation after publishing. Preview
does not modify their static HTML or production cache.

## Static Next.js pages

Keep the published fetch at build time. Put the CMS-rendered part of the page
inside a client component that receives the initial content. It renders normally
for visitors, and the hook opens a draft connection only in preview mode.

```tsx
// app/[slug]/page.tsx — supply generateStaticParams for the routes you build.
import { createStorypaneClient } from '@storypane/sdk'
import { storypaneMigrationVersion } from './types/storypane'
import { Content } from './content'

const storypane = createStorypaneClient({
  url: process.env.STORYPANE_URL!, spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_DELIVERY_TOKEN!, migrationVersion: storypaneMigrationVersion,
})

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const initial = await storypane.getStory({ slug }, { cache: 'force-cache' })
  return <Content initial={initial} cmsUrl={process.env.STORYPANE_URL!}
    spaceId={process.env.STORYPANE_SPACE_ID!} />
}
```

```tsx
// app/[slug]/content.tsx
'use client'
import { useStorypaneStory, editable } from '@storypane/sdk/react'
import { storypaneMigrationVersion } from './types/storypane'
import type { StorypaneBlock, StorypaneStory } from '@storypane/sdk'

function Block({ block }: { block: StorypaneBlock }) {
  // Replace this with your own component registry and schema-specific types.
  return <section {...editable(block)} tabIndex={0}>
    {typeof block.title === 'string' && <h1>{block.title}</h1>}
    {typeof block.text === 'string' && <p>{block.text}</p>}
    {Array.isArray(block.body) && (block.body as StorypaneBlock[]).map(child =>
      <Block key={child._uid} block={child} />)}
  </section>
}

export function Content({ initial, cmsUrl, spaceId }: {
  initial: StorypaneStory; cmsUrl: string; spaceId: string
}) {
  const { story, error } = useStorypaneStory(initial, {
    cmsUrl, spaceId, migrationVersion: storypaneMigrationVersion,
    mode: {
      query: { name: 'blok_preview', value: '1' },
      cookie: { name: 'my_preview', value: '1' },
      env: process.env.NEXT_PUBLIC_STORYPANE_PREVIEW,
    },
  })
  return <>{error && <p role="alert">{error.message}</p>}<Block block={story.content} /></>
}
```

`editable(block)` supplies `data-blok-id`; add it to each block's rendered wrapper.
In the editor iframe, clicking it selects the corresponding content editor.
Selecting a block in the editor outlines it in the app. Focusable wrappers support
Enter/Space selection. Modifier-clicks retain normal link behavior.

For native Next.js Draft Mode, read `const { isEnabled } = await draftMode()` on
the server and pass it as `mode.draft` to the client component. Do not try to read
Next's HttpOnly draft cookie from browser JavaScript. Reading Draft Mode invokes
request-time behavior; a fully static export should use the query/cookie bridge
above instead. [Next.js Draft Mode documentation](https://nextjs.org/docs/app/api-reference/functions/draft-mode).

An arbitrary Server Component cannot be re-rendered by changing browser data.
The content that needs live updates must have a client renderer. For stories with
no built route yet, configure a static `/preview` shell or a dynamic catch-all;
the SDK cannot make a missing static route return HTML.

## Astro

Use the same React content component as an island (with `@astrojs/react` in your
app), and hydrate it even on static pages:

```astro
---
import { createStorypaneClient } from '@storypane/sdk'
import { storypaneMigrationVersion } from '../types/storypane'
import { Content } from '../components/Content'
const storypane = createStorypaneClient({
  url: import.meta.env.STORYPANE_URL, spaceId: import.meta.env.STORYPANE_SPACE_ID,
  token: import.meta.env.STORYPANE_DELIVERY_TOKEN, migrationVersion: storypaneMigrationVersion,
})
const initial = await storypane.getStory({ slug: 'home', locale: '' })
---
<Content client:load initial={initial} cmsUrl={import.meta.env.STORYPANE_URL}
  spaceId={import.meta.env.STORYPANE_SPACE_ID} />
```

Use `import.meta.env.PUBLIC_STORYPANE_PREVIEW` for an Astro browser env flag. Astro
preview/draft state is app-specific; pass the boolean from your authenticated
server flow into `mode.draft`. Static pages cannot read per-visitor cookies at
build time, so use the browser detector for them.
[Astro client hydration directives](https://docs.astro.build/en/reference/directives-reference/#client-directives).

Without React, use a bundled Astro `<script>` and render the subscribed content:

```ts
import { connectPreview } from '@storypane/sdk/preview'
import { storypaneMigrationVersion } from './types/storypane'
const stop = connectPreview({
  cmsUrl: 'https://cms.example', spaceId: 'your-space-id', migrationVersion: storypaneMigrationVersion,
  story: { slug: 'home', locale: '' },
  mode: { query: { name: 'blok_preview', value: '1' } },
  onChange: story => renderWithYourClientComponents(story.content),
})
// Call stop() when the page/island unmounts, including Astro client navigation.
```

Pure `.astro` components are server/build-time templates. A browser script must
update their DOM, or a hydrated island must render the live region. The SDK does
not inject HTML or guess how your custom components should render.

## Standalone preview and authorization

Any of these configured signals activates preview: `mode.draft === true`, a true
env flag (`true`, `'true'`, or `'1'`), a matching cookie, or a matching query param.
Signals are ORed. Use `query:false` to disable the default URL trigger. A rule
without `value` checks for presence. HttpOnly cookies require a server-derived
`draft` boolean. Build-time browser env vars require a rebuild when changed.

Inside the CMS iframe, the SDK requests a session from its parent with
`postMessage`; both sides check the exact origin and source window. The editor
uses its authenticated session to grant five minutes of read-only access to one
story locale. The SDK renews that grant while the editor remains authorized.
Third-party cookies are not needed in the iframe, and credentials are not added
to the iframe URL. The browser subscribes directly to the story's Durable Object.

Outside the iframe, provide `getSession`. Your app's authenticated server endpoint
must verify the visitor may preview before using a **Preview · server only** token:

```ts
// YOUR APP SERVER: only after checking your editor session/authorization.
const previewClient = createStorypaneClient({
  url: process.env.STORYPANE_URL!, spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_PREVIEW_TOKEN!,
})
const session = await previewClient.createPreviewSession({ slug: 'home', locale: '' })
// Return session as JSON with Cache-Control: no-store.
```

```ts
// In connectPreview(...) or useStorypaneStory(...) options:
getSession: async () => {
  const response = await fetch('/api/my-authenticated-preview-session', { method: 'POST' })
  if (!response.ok) throw new Error('Sign in to preview')
  return response.json()
}
```

Use a stable callback for the React hook (module function or `useCallback`). Your
endpoint must validate the requested story and CSRF protections appropriate to
your authentication. A query parameter or an unsigned cookie alone must never
authorize that endpoint. Never put the long-lived preview token in browser code,
public env vars, static JSON, or URLs. Only the short-lived session reaches the
browser. The application origin must match the configured preview URL.

Sessions are checked on connect, draft broadcasts, and heartbeats. Revoking a key,
removing a member, or expiring their login stops subsequent draft delivery.
Preview sockets accept only sync/heartbeat requests and never hold editing leases.
After interruptions the SDK reconnects and reads the latest durable draft; older
revisions are ignored. Errors are exposed through `onStatus` / the React hook.

## Current limits

- Live changes arrive after autosave commits (not on each uncommitted keystroke).
- Media and link fields retain their structured references; a public media
  delivery adapter is not part of this SDK version.
- Component rendering, authentication for standalone preview, application CSP,
  published-site rebuild/revalidation, and unpublished route handling belong to
  the consuming app. The Astro example is built and tested through its real React
  island; the Next.js example remains an integration recipe.

## Schema migrations and generated types

A space has one shared active migration. CMS schema saves and CLI pushes update
that migration; page editing and delivery keep using deployed schemas until an
admin deploys it. New block types must be deployed before they can be inserted.

In **Blocks → Schema migrations → CLI & CI access tokens**, an admin can issue a
management token with read, stage, or deploy capability. Set `STORYPANE_URL`,
`STORYPANE_SPACE_ID`, and `STORYPANE_MANAGEMENT_TOKEN` in your terminal or CI secret
store. Management tokens are never browser credentials. Revocation and the
issuer's current membership/permissions are checked on every operation.

```sh
storypane migrations pull
storypane migrations create "Rename hero title"
# Edit storypane/migrations/active.json. Keep existing field IDs when renaming.
storypane migrations push
# Or review and deploy from an admin's terminal:
storypane migrations push --deploy
storypane migrations pull
storypane generate-types --out src/types/storypane.ts
```

If the CMS already has an active migration, `pull` downloads it: edit that file
instead of running `create`. Migration files target exactly one space. Commit the
`storypane/migrations` directory with application code. Numbered JSON files are
immutable deployed history; `active.json` is the editable target schema. New
fields and definitions may omit their IDs; push assigns and persists IDs before
sending them. Existing IDs preserve renames, including nested blocks. Field order
in the array controls editor order. Definition API names cannot be renamed, and
removing an entire definition is not supported.

Local edits and deployed history are never silently overwritten. A stale push or
divergent pull fails with a conflict. Use `storypane migrations pull --out
/tmp/storypane-remote` to inspect a separate remote copy, reconcile your changes
into its active file while preserving its remote revision/source hash, then copy
that reconciled file into your project. Pull the deployed history too if the base
version changed. There is no force-push switch.

Deployment prints the schema diff and affected draft/publication counts. Deleted
fields lose their active values; removing a nested-block field removes its
subtree. Type changes reset values to a valid target default or unset them.
Renames and plain text format changes preserve values. Defaults do not overwrite
unchanged fields. Invalid resulting publications, constraints, references, or
nesting block deployment. Drafts may still omit fields required for publication.

Drafts and live publications migrate separately in one transaction, so deploying
schemas never publishes unfinished edits. Old values remain in history. Restores
apply intervening migrations; restore an older checkpoint before publishing it.

### CI/CD

Use a deploy-capable management token from your CI secret store:

```sh
storypane migrations push --deploy --yes
storypane migrations pull
storypane generate-types --out src/types/storypane.ts
# Run your application's build/tests, then deploy it.
```

`--yes` permits noninteractive deployment; validation and conflict checks still
apply. A stale impact review or failed deployment exits nonzero. Retrying the
same migration is safe, including after a lost response. The CLI does not commit
files or deploy your application. On success, the local active file becomes a
numbered deployed snapshot.

### Runtime version warnings

Codegen exports `storypaneMigrationVersion` with the block types. Pass that
constant as `migrationVersion` to `createStorypaneClient`, `connectPreview`, and
`useStorypaneStory`. Published responses and preview updates include their actual
version. A mismatch logs one warning per observed version per client/connection;
**content is still returned and preview remains connected**. Unversioned clients
also keep working. Existing caching options remain available; cached/static
content has no separate freshness check.

Warnings do not adapt newer content to older application code. Removed/reset
fields can require renderer changes even though requests succeed. Types describe
the locally pulled deployment; draft values can be incomplete. Rebuild static
sites after publishing or deploying schemas.

### Existing schema-pull commands

The original commands still work with `STORYPANE_PREVIEW_TOKEN`:

```sh
storypane pull-components --out storypane/components.json
storypane generate-types --input storypane/components.json --out src/types/storypane.ts
```

The schema endpoint returns only the latest deployed metadata, without content,
defaults, or source URLs. A published-only token cannot read schemas. Codegen is
offline and writes atomically; invalid input preserves the previous output.
Both workflows require the initial schema migration to be deployed first.
The `blok` executable and legacy `BLOK_*` environment names remain supported.
