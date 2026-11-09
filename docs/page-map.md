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
previous exploration. Open a page in the editor and expand **Page map** below the editor and Live Preview columns, spanning the full page width.
It starts collapsed for each page and locale. The map code and graph request load
only after expansion; collapsing cancels pending requests. Collapse and reopen to
refresh the graph. If the preview is hidden, choose **Preview** to show the panel.

## Explore connections

The map starts from the open page and follows its **published page links** for
two hops, using the editor’s selected locale. Changing the editor locale opens a
fresh, collapsed panel. Pages without an accessible publication are unavailable
in the map. Saved drafts and unsaved edits are outside this view.

Cards show the page title, URL, resolved locale, publication status, and visible
incoming/outgoing counts **within this map**. A fallback label means the selected
locale has no publication and the configured default locale was used. A restricted
translation is not replaced with another locale to bypass access.

Select a card to inspect incoming and outgoing connections, including the
originating block and field. Use Tab to focus a card’s title and Enter to open its
details; keyboard focus brings the card into view. Details open in a dialog, or a
bottom sheet on narrow screens. **Open page** opens its resolved locale in the
editor, using the normal unsaved-change guard. Expand that page’s map to continue
exploring.

Arrows represent explicit story-link fields, including links in nested blocks.
Repeated links between the same pages share an edge with a usage count. Details
show up to 100 usages per edge. Counts include only visible connections in this
map. Story-backed option fields are content references and are excluded.

The map is read-only: pan, zoom, and fit the canvas, but do not move cards, create
links, or edit content there. Each map is limited to 100 nodes and 500 edges. A
notice appears when either cap is reached. Open a boundary page to explore its
links. There are no saved layouts, screenshots, crawling, analytics, or inferred
links from rich text, Markdown, or frontend code.

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
