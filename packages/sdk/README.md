# Storypane SDK

Use `createStorypaneClient` for publications and `useStorypanePreview` for a
separate preview route. `useStorypaneStory` adds preview to an existing publication.

TypeScript SDK for published content and live, read-only draft preview. Works with
Node, Workers, browsers, Next.js client components, and Astro islands/scripts.
The delivery and preview entrypoints have no runtime dependencies; React is an optional
peer dependency. The MCP CLI uses the official MCP server package and Zod.

Start with the [Next.js integration guide](https://github.com/lkuich/storypane/blob/main/apps/example-next/README.md) for
server-side fetching, typed block components, and a separate live preview route.
An [Astro example](https://github.com/lkuich/storypane/blob/main/apps/example-astro/README.md) is also included.

The current version is **0.1.0-rc.5**, published on npm as a release candidate:

```sh
npm install @storypane/sdk@0.1.0-rc.5
# Or follow the candidate channel:
npm install @storypane/sdk@rc
```

Pin the explicit version for reproducible builds. npm also assigned `latest` to
this first publication; that tag does not make it stable. See the
[release guide](https://storypane.dev/docs/releases-and-versioning/) for status,
upgrades, and known limits.

You can also build from this monorepo with `pnpm --filter @storypane/sdk build`
and pack/link `packages/sdk`, or install the verified GitHub archive:

```sh
npm install https://github.com/lkuich/storypane/releases/download/v0.1.0-rc.5/storypane-sdk-0.1.0-rc.5.tgz
```

Entrypoints:

- `@storypane/sdk`: delivery client, types, preview detection, editable attributes.
- `@storypane/sdk/preview`: framework-independent browser subscription and editor bridge.
- `@storypane/sdk/react`: `useStorypanePreview`, `useStorypaneStory`, and `editable`.
- `@storypane/sdk/rich-text`: `RichText`, a safe React renderer that works in Server and Client Components.

## Configure the CMS

For a team, start with [production for editors and a linked dev space per developer](https://github.com/lkuich/storypane/blob/main/docs/development-workflow.md).
Use production credentials and production-generated types for the live website,
and a separate dev configuration for schema and frontend testing.

In the selected space’s **Settings → API & preview**, create a **Published content** token and
set the application preview URL, e.g. `https://site.example/{locale}/{slug}`.
The root locale contributes an empty path segment; the editor removes doubled
slashes. `{slug}` is the selected locale's URL slug. Query placeholders also work:
`https://site.example/preview?slug={slug}&locale={locale}`.

Admins set the **Space default** preview URL. Each member can save **My default
preview** in the same settings screen, or choose **Use space default**. This
preference follows the user across browsers in that space. Editor and component
previews use it unless another URL is selected in the editor. Server-created
preview sessions continue to use the space default unless `previewId` is provided.

The default preview parameter is `storypane_preview=1`. You can change its name in
settings; use the same name in your SDK options. Your app must permit the CMS
origin in its CSP `frame-ancestors` policy and must not send a conflicting
`X-Frame-Options` header. An HTTPS CMS requires an HTTPS app; localhost HTTP is
supported for development.

## Published content

```ts
import { createStorypaneClient, type StorypaneBlock } from '@storypane/sdk';
import { storypaneMigrationVersion } from './types/storypane';

const storypane = createStorypaneClient({
  url: process.env.STORYPANE_URL!,
  spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_DELIVERY_TOKEN!,
  migrationVersion: storypaneMigrationVersion,
});

const page = await storypane.getStory({ slug: 'home' });
const byId = await storypane.getStory({ id: page.id });
const { stories, nextOffset } = await storypane.listStories();
const allStories = await storypane.listAllStories();
const locales = await storypane.listLocales(); // [{ id, name: 'Default', slug: '', isDefault: true }, ...]
```

Locale is optional. These calls use the space's configured default locale;
`listStories()` and `listAllStories()` need no options object. A single-story read
still needs its ID or slug. Pass `{ locale: 'fr' }` to either list method, or add
`locale: 'fr'` to a story reference, when you want a specific locale.
You can also set pagination without a locale: `listStories({ limit: 100 })`.
An explicit `locale: ''` selects the root locale, even if another locale is the
configured default. Changing the default does not change URL prefixes.

These reads use the CMS delivery API, which queries publication snapshots in
Postgres. Drafts and unpublished locales never appear. A missing publication in
the selected locale does not fall back to another locale; a single-story read
throws `StorypaneError` with `status === 404`.
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

## Next.js App Router

Keep the client in a module marked `import 'server-only'`. Call `getStory` from
an async Server Component, then pass the content to your own React components.
The client accepts a schema generic once; individual methods can still override
it with `getStory<MyPage>(...)`.

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

```tsx
// src/app/about/page.tsx
import { storypane } from '@/lib/storypane';

export default async function Page() {
  const story = await storypane.getStory({ slug: 'about' });
  return <h1>{story.name}</h1>;
}
```

For static routes, `listAllStories()` returns every published story in the
configured default locale, following pagination. To build routes for every locale,
call `listLocales()` and fetch the others with `listAllStories({ locale: slug })`.
Each locale includes `isDefault`; the default need not have an empty URL prefix.
`getStory`, `listStories`, and `listAllStories` accept fetch options as their second
argument. Choose static rendering or request-time fetching in your Next.js routes;
the SDK does not impose a cache policy on story reads.

### A separate preview route

Use `useStorypanePreview` in a Client Component when no initial publication is
available. It returns `{ story, status, error }`; `story` stays undefined until
the editor authorizes the connection. Pass an undefined story reference until
your route has a slug. Without a parent editor or authenticated `getSession`
callback, the hook stays disabled.

```tsx
'use client';
import { useStorypanePreview } from '@storypane/sdk/react';
import { storypaneMigrationVersion, type StorypaneContentType } from '@/types/storypane';

export function Preview({
  cmsUrl,
  spaceId,
  slug,
  locale = '',
}: {
  cmsUrl: string;
  spaceId: string;
  slug: string;
  locale?: string;
}) {
  const { story, error } = useStorypanePreview<StorypaneContentType>({
    cmsUrl,
    spaceId,
    migrationVersion: storypaneMigrationVersion,
    story: { slug, locale },
  });
  if (error) return <p role="alert">{error.message}</p>;
  if (!story) return <p>Open this page from Storypane's preview.</p>;
  return <h1>{story.name}</h1>; // Render your block components here.
}
```

The [complete Next.js example](https://github.com/lkuich/storypane/blob/main/apps/example-next/README.md) includes routing,
`Suspense` around `useSearchParams`, block rendering, and referenced footer drafts.
It keeps published pages on the server and reuses the renderer inside `/preview`.
Client preview components must not import server-only fetch modules.

### Block hover previews

Component previews are available starting with `@storypane/sdk@0.1.0-rc.3`.

The editor can preview saved blocks and the add-block picker's sample content in
one temporary iframe after a short hover or keyboard focus. It uses the selected
preview URL and the same authenticated, read-only flow as the full preview.
Escape dismisses the preview. Nothing is inserted or saved by hovering.

Opt in by passing a stable `onComponent` callback to `useStorypanePreview`,
`useStorypaneStory`, or `connectPreview`. Render that block alone with your existing
component renderer, without page navigation or preview status chrome:

```tsx
const [component, setComponent] = useState<StorypaneComponent>();
const { story } = useStorypanePreview<StorypaneComponent>({
  cmsUrl,
  spaceId,
  story: { slug, locale },
  onComponent: setComponent,
});
// Keep passing the story's references and other renderer context as usual.
if (story) return <Block block={component ?? story.content} />;
```

Use the generated `StorypaneComponent` union here: picker previews include nestable
blocks as well as content types. Both example apps demonstrate this integration.
Picker previews are opt-in per definition: set **Config → Picker preview data (JSON)**
and deploy the schema migration. This stores an optional `previewData` object with
sample field values; nested blocks use `{ _uid, component, ...fields }`. Use real
representative content, including the nested items your renderer needs. A definition
without sample data has no picker preview. Samples override defaults for this iframe
only; inserting a block still uses its normal field defaults.

For example, a feature grid can have this preview data:

```json
{
  "title": "A fresh perspective",
  "items": [
    { "_uid": "preview-feature", "component": "feature", "title": "Start with a good question." }
  ]
}
```

Samples are validated against field types and allowed nested blocks, limited to
100 KB per definition, and included in full schema migrations. Referenced original
media follows the existing clone/sync/promotion dependency review. They are excluded
from delivery schema metadata and generated component types. Both examples keep
editable fixtures in `storypane/preview-data.json`; the Astro setup script installs
them into newly seeded spaces. For an existing space, copy each fixture into that
block's Config tab and deploy the migration.

Existing integrations without `onComponent` keep full-page preview and show a setup message for hover previews.

If you prefer preview on an existing published route, `useStorypaneStory(initial,
options)` remains available. It starts with the publication and activates drafts
only when its `mode` matches. For Next.js Draft Mode, pass the server's `isEnabled`
value as `mode.draft`; never read the HttpOnly draft cookie from browser JavaScript.
An arbitrary Server Component cannot be re-rendered by changing browser data;
the live region must have a client-compatible renderer.

`editable(block)` supplies selection attributes. Put it on each block's wrapper;
focusable wrappers also support Enter/Space selection in the editor. The SDK
cleans up subscriptions, listeners, and highlighting on unmount.

### Rich text

```tsx
import { RichText } from '@storypane/sdk/rich-text';

<RichText value={block.text} />;
```

The renderer supports the editor's nodes and marks, escapes text, and rejects
unsafe link protocols. It also accepts legacy plain strings and empty draft
values. It has no client-only hooks, so it works in both Server Components and
live previews. It does not inject CMS strings as HTML.

## Astro

Render publications at build time with `@astrojs/react`, without a hydration
directive. The example's app-owned `publishedPages` helper fetches every configured
locale through `listAllStories`, validates routes, and supplies the selected story
and its references:

```astro
---
import { Content } from '../components/content';
import { publishedPages } from '../lib/cms';
export const getStaticPaths = publishedPages;
const { story, references } = Astro.props;
---

<Content block={story.content} references={references} />
```

Keep the delivery token in server-only environment variables. Public pages have
no draft subscription. Put the interactive preview on a separate `/preview` route:

```astro
---
import PreviewShell from '../components/PreviewShell';
import { cmsUrl, spaceId } from '../lib/cms';
---

<PreviewShell client:load cmsUrl={cmsUrl} spaceId={spaceId} />
```

The example's [`PreviewShell`](https://github.com/lkuich/storypane/blob/main/apps/example-astro/src/components/PreviewShell.tsx)
uses `useStorypanePreview` with the URL's `slug` and `locale`, clears stale content
on navigation, and renders the references supplied by the authenticated editor.
It also previews stories that have never been published. Configure the CMS preview
URL as `/preview?slug={slug}&locale={locale}`; no public environment flag is needed.

Without React, use a bundled Astro `<script>` and render the subscribed content:

```ts
import { connectPreview } from '@storypane/sdk/preview';
import { storypaneMigrationVersion } from './types/storypane';
const stop = connectPreview({
  cmsUrl: 'https://cms.example',
  spaceId: 'your-space-id',
  migrationVersion: storypaneMigrationVersion,
  story: { slug: 'home' },
  mode: { query: { name: 'storypane_preview', value: '1' } },
  onChange: (story) => renderWithYourClientComponents(story.content),
});
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
to the iframe URL. The browser receives the story's authorized preview over a
WebSocket.

Outside the iframe, provide `getSession`. Your app's authenticated server endpoint
must verify the visitor may preview before using a **Preview · server only** token:

```ts
// YOUR APP SERVER: only after checking your editor session/authorization.
const previewClient = createStorypaneClient({
  url: process.env.STORYPANE_URL!,
  spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_PREVIEW_TOKEN!,
});
const session = await previewClient.createPreviewSession({ slug: 'home' });
// Return session as JSON with Cache-Control: no-store.
```

`createPreviewSession` also uses the configured default when you omit `locale`.
Include it in the story reference to request a specific locale.

```ts
// In connectPreview(...) or useStorypaneStory(...) options:
getSession: async () => {
  const response = await fetch('/api/my-authenticated-preview-session', { method: 'POST' });
  if (!response.ok) throw new Error('Sign in to preview');
  return response.json();
};
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

Preview stories include a `references` array for direct story-backed option,
multi-option, and story-link fields. These contain current drafts from the same
space, preferring the preview locale with Default as the fallback. References stay
as IDs in `content`; renderers can look them up in `references`. Referenced-story
edits refresh on the 15-second heartbeat even if the parent revision is unchanged.
References are resolved one level deep and are not added to public delivery responses.
After interruptions the SDK reconnects and reads the latest durable draft; older
revisions are ignored. Errors are exposed through `onStatus` / the React hook.

## Current limits

- Live changes arrive after autosave commits (not on each uncommitted keystroke).
- Media and link fields retain their structured references. Use `publicAssetUrl`
  for opted-in public media or `client.getAsset` for server-side static export.
- Component rendering, authentication for standalone preview, application CSP,
  published-site rebuild/revalidation, and unpublished route handling belong to
  the consuming app. The Astro example is built and tested through its real React
  island; the Next.js example remains an integration recipe.

## Management API

Use `@storypane/sdk/management` in server code to read and edit drafts, publish
checkpoints, and manage assets and configuration. Create a scoped token in
**Space settings → API & preview → Management API**. Tokens and writes obey the
issuer's current permissions, content restrictions, and active editor locks.

```ts
import { createManagementClient } from '@storypane/sdk/management';

const management = createManagementClient({
  url: process.env.STORYPANE_URL!,
  spaceId: process.env.STORYPANE_SPACE_ID!,
  token: process.env.STORYPANE_MANAGEMENT_TOKEN!,
});

const stories = await management.stories.list({ limit: 20 });
```

The CLI uses the same environment variables:

```sh
storypane stories list --json
storypane content get STORY_ID LOCALE_ID --json
storypane assets upload ./cover.jpg --mime image/jpeg
storypane api GET /delivery-settings
```

See the [management API guide](https://github.com/lkuich/storypane/blob/main/docs/management-api.md) for safe edits,
publishing, token permissions, pagination, HTTP operations, and CLI JSON input.
The delivery SDK remains the entrypoint for public sites.

### Content releases

Use the management client's existing `request()` method to manage releases:

```ts
const releases = await management.request('/releases');
const release = await management.request('/releases', {
  method: 'POST',
  body: {
    requestId: crypto.randomUUID(),
    name: 'Summer launch',
    localTime: '2027-06-01T09:00',
    timezone: 'America/Vancouver',
    dueAt: '2027-06-01T16:00:00.000Z',
  },
});
```

Choose a future date; retain the same request ID and payload on retries. Add
approved page revisions through the scheduling endpoint, using the release ID and
reviewed revision. See [API contracts](https://github.com/lkuich/storypane/blob/main/docs/management-api.md#content-releases)
and [the release guide](https://github.com/lkuich/storypane/blob/main/docs/releases.md). Releases publish approved nested
content together; later drafts stay unpublished. Delivery and preview calls are
unchanged. No release-specific CLI command is required or provided.

## Schema migrations and generated types

A space has one shared active migration. CMS schema saves and CLI pushes update
that migration; page editing and delivery keep using deployed schemas until an
admin deploys it. New block types must be deployed before they can be inserted.

In your dev space, open **Blocks → Schema migrations → CLI access**. An admin can issue a
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
in the array controls editor order. Definition API names cannot be renamed. Version 2 migration files also carry
`parentDefinitionId` beside each definition’s `schema`; preserve these IDs to keep
the library hierarchy. Version 1 files remain supported and omitted parent metadata
preserves the current parent. Removing a definition is allowed only when the
existing content, folder, and schema-reference checks permit it.

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
Interactive deployment requires typing `DEPLOY <version>` when the review
includes data loss. In the CMS, **Preview destructive deployment** can additionally
remove disallowed/excess nested blocks and reset invalid field values. It still
validates the resulting content and requires explicit confirmation. The CLI uses
standard deployment and does not automatically select this destructive mode.

Drafts and live publications migrate separately in one transaction, so deploying
schemas never publishes unfinished edits. Old values remain in history. Restores
apply intervening migrations; restore an older checkpoint before publishing it.

### Linked development and production spaces

For new teams, create **Production** first for content editors, keep its schema
read-only, and create a dedicated **Development** space per developer using
production as the base. Follow the [UI setup and promotion walkthrough](https://github.com/lkuich/storypane/blob/main/docs/development-workflow.md).
An installation admin can clone a space or choose a base when creating one.
One production space can have multiple linked dev spaces. Starting in dev is supported: creating
production from an unlinked dev space establishes the link. New production spaces
created with an explicit environment start with **Schema read-only** enabled;
existing spaces retain their previous editing behavior.

Cloning takes deployed schemas, block-library nesting, nested-block restrictions,
locales, and required datasource option lists. It excludes bulk content and media,
but reviews and copies the stories and original media required by schema defaults,
including their transitive dependencies (up to 100 stories). Required stories use
published content where available, otherwise their drafts; copies are always
unpublished. Memberships, tokens, integrations, and external option request headers
are not copied. Configure external credentials separately.

In **Settings → General**, admins can make schemas read-only. This blocks local
schema edits, block moves, CLI pushes, and direct deployment. Schema and migration
history stay visible. Reviewed promotion from a linked dev space is still allowed.

Keep `STORYPANE_SPACE_ID` and `STORYPANE_MANAGEMENT_TOKEN` pointed at dev. Set
`STORYPANE_PRODUCTION_MANAGEMENT_TOKEN` to a separate production token. Sync and
promotion require a deploy-capable dev token; production needs read access for
sync and deploy access for promotion. Deploy-capable management tokens need `read`
and `admin`; add `schemas:write` to the dev token for local migration authoring. Both issuers’ current
membership and permissions are checked. Production is resolved from the link,
within the same installation.

```sh
storypane migrations pull
storypane migrations create "Add hero caption"
# Edit storypane/migrations/active.json.
storypane migrations push --deploy
# Test the deployed schema in dev, then review actual production impacts.
storypane migrations status
storypane migrations promote
```

Promotion preserves the order of deployed dev migrations and applies the reviewed
batch in one production transaction. It can copy missing required dependencies as
unpublished drafts. Dependency copying does not overwrite existing production
stories or media; schema migrations still transform affected content.
A required datasource with different option values blocks the transfer until its
configuration is reconciled explicitly. Active schema drafts are not promoted.

Other dev spaces show **Behind production**. Use **Sync from production** in the
Blocks screen or `storypane migrations sync`. Sync preserves deployed history,
replays incoming production transformations, and reconciles local changes by block
and field ID. The UI offers a choice for each conflict. If independent changes
create invalid nesting or references, choose the complete dev or production schema
for that step. The CLI prints conflict
paths; put the choices in a JSON object mapping each path to `"dev"` or `"prod"`,
then run `storypane migrations sync --input resolutions.json`. Review data loss
before applying. Unresolved conflicts and stale reviews block application.

`--yes` accepts the current review for CI, including reported data loss. The CLI
keeps an interrupted operation in `storypane/migrations/.transfer.json`; rerun the
same command to resume it safely. Do not commit this temporary file. A stale
review is discarded so the next invocation can obtain a new review. Pull dev
migrations after sync; divergent local active files must still be reconciled using
a separate `--out` directory.

Production and dev migration numbers can differ. Set `PRODUCTION_SPACE_ID` to
production’s UUID from **Settings → General**. Generate production application
types from production, keeping its files separate from dev:

```sh
STORYPANE_SPACE_ID="$PRODUCTION_SPACE_ID" \
STORYPANE_MANAGEMENT_TOKEN="$STORYPANE_PRODUCTION_MANAGEMENT_TOKEN" \
  storypane migrations pull --out storypane/production-migrations
# Substitute the latest numbered production JSON file returned by this pull.
storypane generate-types --input storypane/production-migrations/3.json \
  --out src/types/storypane.ts
```

### CI/CD

Use separate stages for dev validation and production promotion. The authoring
stage targets dev with its deploy-capable token:

```sh
storypane migrations push --deploy --yes
storypane migrations pull
storypane generate-types --out src/types/storypane.ts
# Run your application's build/tests against dev.
```

After review, a release stage keeps `STORYPANE_SPACE_ID` pointed at dev and adds
`STORYPANE_PRODUCTION_MANAGEMENT_TOKEN` from the CI secret store:

```sh
storypane migrations status
storypane migrations promote --yes
```

If production has advanced, sync and resolve conflicts before this stage. Generate
production types using the separate pull shown above, then build/deploy the live
frontend with production's delivery configuration. Direct `push --deploy` to a
read-only production space is rejected.

`--yes` explicitly accepts the reviewed data loss for noninteractive deployment;
validation and conflict checks still
apply. A stale impact review or failed deployment exits nonzero. Retrying the
same migration is safe, including after a lost response. The CLI does not commit
files or deploy your application. A successful `push --deploy` turns the local
active file into a numbered deployed snapshot. After promotion, pull again to
refresh dev's files before further edits.

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

## Media

`client.getAsset(assetId)` returns a `Response` with the original asset bytes for
server-side rendering or static export. It requires a valid delivery token and
only serves assets referenced by a current publication in that token's space;
draft-only and historical references do not grant access. Keep the token on the
server. Static copies must be rebuilt or removed when their publications change.

### Public media URLs

An administrator can enable **API & preview → Public media delivery** for a space.
It is disabled by default. Only assets referenced by an active current publication
become public; draft-only and historical references do not qualify. Archiving an
asset preserves its live references and original bytes.

`publicAssetUrl` is browser-safe and does not construct a client, make a request,
or accept a delivery token. For example, in a React renderer:

```tsx
import { publicAssetUrl, type PublicImageOptions } from '@storypane/sdk';

const source = { url: 'https://cms.example.com', spaceId, assetId: hero.image.assetId };
const image = (width: PublicImageOptions['width']) =>
  publicAssetUrl(source, { width, aspect: '16:9' });

<img
  src={image(640)}
  srcSet={`${image(320)} 320w, ${image(640)} 640w, ${image(1280)} 1280w`}
  sizes="(max-width: 640px) 100vw, 50vw"
  width={1280}
  height={720}
  alt={hero.image.alt ?? ''}
/>;

const originalDownload = publicAssetUrl(source);
```

Widths are limited to 160, 320, 640, 1280, 1920 and 2560. Optional aspect ratios are
`original`, `1:1`, `4:3`, `3:4`, `16:9` and `9:16`. Explicit ratios support `cover`
(default) or `contain`; original aspect uses scale-down. Output formats are `webp`
(default), `jpeg` and `png`. Lossy output accepts quality 60, 80 (default) or 90;
PNG rejects a quality option. The helper normalizes defaults and rejects unsupported
options. Originals support HEAD, ETags, and a single byte range. Variants support
HEAD and ETags; they do not expose partial image ranges.

Cover crops use the asset's saved focal point, defaulting to center. Saving focal
metadata changes every public crop of that asset immediately; it does not wait for
story publication. The `asset.updated` webhook includes the metadata revision so
static exporters can rebuild. Transformed animations use a still frame; originals
preserve animation. Images larger than 20 MiB, unsupported inputs, or unavailable
image processing return an error rather than substituting the original.

Public responses use `Cache-Control: no-store`. The CMS checks live eligibility
before serving each request. The Node runtime computes image variants on demand.
Disabling the setting or removing the last live reference returns 404 on the next
request, including cached and conditional requests.
Previously downloaded files and static copies cannot be recalled. Keep the existing
authenticated `getAsset` integration for static export when public media is disabled.

## MCP

Launch the pinned package directly (Node 20+), with `STORYPANE_URL`,
`STORYPANE_SPACE_ID`, and a private `STORYPANE_MANAGEMENT_TOKEN` configured in
your MCP client's environment:

```sh
npx --yes --package=@storypane/sdk@0.1.0-rc.5 storypane mcp
```

If installed in your project, `pnpm exec storypane mcp` also works from its root.
The stdio adapter exposes read and write
tools over the management API; the same scopes, issuer permissions and revocation
apply. See [MCP configuration and contracts](https://github.com/lkuich/storypane/blob/main/docs/management-api.md#mcp-adapter).
