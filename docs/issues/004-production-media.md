# 004 — Production media delivery and image controls

Status: TODO  
Source: comparison gap 4  
Related: [lifecycle](001-story-lifecycle.md), [webhooks](002-webhooks.md),
[permissions](008-scoped-permissions.md)

## Problem and current implementation

Websites need usable media URLs and responsive image variants without exposing a
delivery token. Editors need focal-point control and a way to find asset usage.

- [The asset service](../../packages/assets/src/index.ts) already streams originals
  from private R2, supports byte ranges, and produces private WebP thumbnails at
  160/320/640/1280px through the Images binding. It authorizes before cache lookup.
- [The delivery route](../../apps/web/src/app/api/delivery/[resource]/route.ts)
  and [SDK](../../packages/sdk/src/index.ts) currently expose authenticated
  original bytes only when an asset is referenced by a current publication.
- [The Astro media route](../../apps/example-astro/src/pages/media/[assetId].ts)
  copies originals during static builds. This remains a supported integration.
- [AssetRecord](../../packages/assets/src/types.ts) has metadata and archive state,
  but no focal point or usage listing. Archiving intentionally preserves bytes.

These existing capabilities count as implemented; extend them instead of replacing
the upload pipeline or introducing another image provider.

## Public delivery contract

Add an explicit admin-controlled public-media setting per space, disabled for
existing and new spaces by default. The setting explains that assets referenced
by live content become publicly retrievable. Enabling it never exposes the entire
library, draft-only assets, upload sessions, or arbitrary R2 keys.

Provide same-origin GET/HEAD routes:

- /media/:spaceId/:assetId/original — original bytes, existing MIME/download
  behavior, ETag handling, and byte-range support.
- /media/:spaceId/:assetId/image — a bounded image transformation, with the
  parameters below. Non-image files are rejected on this route.

On every request, verify the space opted in and that the asset belongs to it and
is referenced by at least one active current publication. Reuse/factor the
eligibility query from authorizePublishedAsset without accepting a fake token.
Draft or historical references do not qualify. Archived assets still qualify
while used by a current publication. Unpublishing one of several referencing
pages must not remove media still needed by another page.

The original authenticated endpoint and private editor thumbnails remain available
when public media is off. Never put delivery/preview tokens in URLs or generated
HTML. Add a browser-safe SDK URL builder accepting only CMS URL, space ID, asset
ID, and supported transform options; export it without constructing a token-bearing
client. URL construction itself does not grant access or require a network request.

## Image transformations and editor behavior

Start with a finite set of canonical variants to bound work and cache cardinality:

| Parameter | Accepted values                                       |
| --------- | ----------------------------------------------------- |
| width     | 160, 320, 640, 1280, 1920, 2560; required             |
| aspect    | original (default), 1:1, 4:3, 3:4, 16:9, 9:16         |
| fit       | cover or contain; relevant when an aspect is supplied |
| format    | webp (default), jpeg, png                             |
| quality   | 60, 80 (default), 90; only for lossy output           |

Derive height from width/aspect. Define defaults and normalize irrelevant options
before building cache keys; reject unknown parameters, duplicate parameters, and
unsupported combinations. Do not accept arbitrary source URLs, storage keys,
crop coordinates, or arbitrary dimensions. Expose the limits in the SDK types.
Requesting more variants requires an explicit future extension of this contract.

Add a nullable asset-level focal point with normalized x/y coordinates in [0, 1]
and a metadata revision. Center is the default. In asset details, show the marker,
provide pointer and keyboard controls, Reset to center, and a crop preview.
Use it for cover crops; contain/original-aspect output does not crop. Map the
normalized point to the Images binding's documented gravity behavior and verify
it with non-square source images. No per-story focal override is introduced.

Focal-point changes affect every public transformation of that asset after save;
they are asset metadata changes, not staged story changes. Label that behavior in
the editor and emit asset.updated through 002 so sites exporting images can rebuild.
Preserve the original bytes. For oversized/unsupported inputs or unavailable Images
processing, return an explicit error; never silently substitute an unexpected
original. Document whether animation is flattened (v1 follows existing thumbnails
and uses a still frame). Original downloads continue to preserve animation/bytes.

## Caching, availability, and usage lookup

- Keep R2 private. Optimize its byte streams with the existing Images binding.
  No public bucket, new upload provider, or remote-image fetch is needed.
- Check public eligibility before any cache hit or conditional 304 response.
  Cache transformed bytes internally using space/asset identity, source ETag,
  metadata revision, canonical options, and transform-version identity.
- Return public-route responses with Cache-Control: no-store in v1; internal
  transformed-byte caching still avoids repeat image processing. Ensure no outer
  CDN/Worker cache serves the route before eligibility checks. This trades a
  database eligibility lookup per request for immediate revocation on the next
  request; a long public TTL needs a separate documented revocation policy.
- Disable public media or remove the last live reference and the next request
  returns 404, including previously cached variants. Fail closed if the database
  is unavailable. Bytes already downloaded or copied by a site cannot be recalled.
- Preserve safe content-disposition, MIME, nosniff, and sandbox behavior for
  originals. Serve transformed raster formats with accurate content types and
  ETags. Test HEAD and invalid ranges; do not cache error responses as images.
- Add a paginated “Used in” tab to asset details, linking to story/locale/block and
  distinguishing current draft and current publication usage. Archived assets can
  still be inspected. Exclude historical snapshots from the default listing.
- Enumerate typed asset/link fields using their schema, with stable story/block
  IDs and per-locale state. Begin with bounded Postgres queries over current
  content; add a maintained reference index only if measured data size requires it.
  Filter results and counts through 008's read policy; never leak hidden story
  names or links. This UI requires CMS authentication even when media is public.

## Implementation reach

- DB migration/registration for public-media setting, focal point/revision, and
  any image dimensions needed for validation; asset types/metadata validation.
  Backfill without modifying existing bytes or asset-reference shapes.
- Shared published-asset eligibility in the store; public HTTP routes, asset
  streaming/transformation/cache logic, and usage lookup. Update lifecycle/schema
  mutation paths if reference queries are replaced by an index later.
- Space delivery settings, asset details/focal-point UI, accessible controls, and
  authenticated picker previews. Keep image controls out of non-image dialogs.
- SDK URL helper/types/exports/tests and a responsive-image example using srcset.
  Update Astro/docs to demonstrate public URLs as an opt-in alternative to export.
- Existing R2 and IMAGES bindings suffice. Verify deployment enables Images and
  cache routing behaves as specified; update env/type files only if necessary.
- Extend asset, DB eligibility, SDK, and browser tests with non-square images,
  focal edges, animation, archived assets, and multiple publication references.

## Acceptance tests

- [ ] A clean upgrade and new space expose no unauthenticated media until opted in.
- [ ] URLs work without credentials only for eligible current published assets;
      wrong-space, draft-only, history-only, deleted-story, and disabled-space cases fail.
- [ ] Revocation works after warming the transform cache; shared live references
      preserve access and archived-but-published assets remain usable.
- [ ] Allowed sizes/formats/crops have the expected dimensions and focal placement;
      unknown/unbounded inputs and unsupported MIME/size fail predictably.
- [ ] Focal editing is keyboard accessible, preserves source bytes, invalidates
      variant identity, and emits the asset event. Non-image metadata remains editable.
- [ ] Original byte ranges/HEAD and authenticated SDK export remain compatible;
      public helper output and example HTML contain no credentials.
- [ ] Usage results accurately distinguish draft/live references without leaking
      hidden content. Local image simulation and a real deployed Images smoke test pass.

## References

[Storyblok asset usage/focal points](https://www.storyblok.com/docs/manuals/assets)
and [focal-point transformations](https://www.storyblok.com/docs/api/image-service/operations/focal-point)
establish the product gap.

[Cloudflare Images binding](https://developers.cloudflare.com/images/optimization/binding/)
can transform private R2 bytes. It does not automatically cache its results.
[Cache API behavior](https://developers.cloudflare.com/workers/runtime-apis/cache/)
must be checked alongside authorization; the finite variants and no-store public
response policy above are Storypane decisions.
