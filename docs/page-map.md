# Page map

Use the **View in map** icon beside a page in the Content list, or the **View in
map** button at the top right of an open page, to explore its connections. Leaving the editor uses the same unsaved-change check as other
navigation. The map is read-only: pan or zoom the canvas, but do not move cards,
create links, or edit content there.

## Explore connections

The page you open is the starting point. The default view shows **Published
content**, outgoing page links, and two hops. Select a locale, switch to saved
drafts, choose one to four hops, or follow incoming links or both directions.
The starting page and filters are stored in the URL; browser Back restores the
previous exploration. Use **Refresh** after another editor changes content.

Cards show the page title, URL, resolved locale, publication status, and visible
incoming/outgoing counts **within this map**. A fallback badge means the selected
locale has no snapshot in this mode and the configured default locale was used.
A restricted translation is not replaced with another locale to bypass access.
Published mode uses the current published snapshot; Draft uses the latest saved
checkpoint. Unsaved edits are outside the map.

Select a card to inspect its incoming and outgoing connections, including the
originating block and field. **Open page** opens its resolved locale in the editor.
**Explore from here** makes it the new starting point. Use Tab to focus a card’s
title and Enter to open its details; keyboard focus brings the card into view.
Details appear beside the canvas on desktop and in a dismissible sheet on narrow
screens. Use **List** to return to Content and choose another page.

Solid arrows represent explicit story-link fields, including links in nested
blocks. **Include content references** also shows story-backed option fields as
dashed arrows. These references may embed shared content; they do not necessarily
represent clickable navigation. Repeated links between the same pages and of the
same kind share an edge with a usage count. Details show up to 100 usages per edge.

Each map is limited to 100 nodes and 500 edges. A notice appears when either cap
is reached. Select a boundary page and use **Explore from here** to continue.
There are no saved layouts, screenshots, crawling, analytics, or inferred links
from rich text, Markdown, or frontend code.

## Upgrade existing instances

Migration **028_page_connections** adds one rebuildable table and outgoing and
incoming indexes. It backfills only the current draft and publication for each
locale. Historical snapshots, migration history, original media, and encryption
keys remain unchanged. A deferred transactional trigger maintains the index when
checkpoint or publication pointers change, including saves, restores, schema
migrations, imports, cloning, and scheduled releases. Soft-deleted content is
filtered when queried; deleting a locale removes its derived row.

Use the existing upgrade procedure in [self-hosting](self-hosting.md). With the
correct instance credentials in the ignored `.env.production`, run:

```sh
pnpm db:migrate:production
```

The runner upgrades the installation and every attached space database. It uses
transactional migrations and records 028 once; repeated runs do not rebuild it.
Backfill work scales with current content, so allow time for it during the upgrade
and retain normal database backups. A failed migration rolls back its schema and
backfill together. Legacy splits preserve an existing index or build it when
upgrading an older source. Do not use the local-only `db:setup` for production.

The map is an authenticated CMS feature. Delivery SDK contracts are unchanged.
