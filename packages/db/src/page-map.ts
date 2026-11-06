import type { PoolClient } from 'pg';
import {
  StorypaneError,
  locationAllowed,
  unrestrictedRead,
  type Actor,
  type PageMapQuery,
  type PageMapNode,
  type PageMapEdge,
  type PageMapResponse,
} from '@storypane/core';
import { loadContentAccess } from './content-access.js';

type IndexedField = { definitionId: string; fieldId: string | null };
type Connection = IndexedField & {
  target: string;
  kind: 'link' | 'reference';
  blockId: string;
  block: string;
  field: string;
  label: string;
};
type CatalogRow = {
  id: string;
  locale_id: string;
  space_locale_id: string;
  folder_id: string | null;
  slug: string;
  name: string;
  status: PageMapNode['status'];
  metadata: { title: string; url: string; fields: IndexedField[] };
};

export async function readPageMap(
  client: PoolClient,
  actor: Actor,
  query: PageMapQuery,
): Promise<PageMapResponse> {
  const access = await loadContentAccess(client, actor);
  const restricted = !unrestrictedRead(access);
  const requested =
    query.locale ??
    (
      await client.query('SELECT slug FROM space_locales WHERE space_id=$1 AND is_default', [
        actor.spaceId,
      ])
    ).rows[0].slug;
  const canReadField = (field: IndexedField) =>
    !restricted ||
    ((!access.scopes.read.definitionIds ||
      access.scopes.read.definitionIds.includes(field.definitionId)) &&
      (!access.scopes.read.fieldIds ||
        (!!field.fieldId && access.scopes.read.fieldIds.includes(field.fieldId))));
  // Resolve the locale before permission filtering: a hidden translation must not select a different one.
  const rows = (
    await client.query<CatalogRow>(
      `
    SELECT DISTINCT ON (s.id) s.id,l.id AS locale_id,l.space_locale_id,s.folder_id,l.slug,l.name,i.metadata,
      CASE WHEN p.locale_id IS NULL THEN 'draft' WHEN d.metadata->>'digest'=p.metadata->>'digest' AND d.metadata->>'url'=p.metadata->>'url' THEN 'published' ELSE 'changed' END AS status
    FROM stories s JOIN story_locales l ON l.story_id=s.id
    JOIN page_connections i ON i.locale_id=l.id AND i.mode=$2
    LEFT JOIN page_connections p ON p.locale_id=l.id AND p.mode='published'
    LEFT JOIN page_connections d ON d.locale_id=l.id AND d.mode='draft'
    LEFT JOIN content_folders f ON f.id=s.folder_id
    WHERE s.space_id=$1 AND s.deleted_at IS NULL AND ($4 OR NOT coalesce(f.form_only,false))
      AND l.slug IN ($3,(SELECT slug FROM space_locales WHERE space_id=$1 AND is_default))
    ORDER BY s.id,(l.slug=$3) DESC`,
      [actor.spaceId, query.mode, requested, query.references === 'true'],
    )
  ).rows;
  const catalog = new Map<string, PageMapNode>();
  for (const row of rows) {
    if (
      !locationAllowed(
        access,
        { storyId: row.id, folderId: row.folder_id, spaceLocaleId: row.space_locale_id },
        'content:read',
      ) ||
      !row.metadata.fields.some(canReadField)
    )
      continue;
    catalog.set(row.id, {
      id: row.id,
      localeId: row.locale_id,
      title: row.metadata.title,
      url: row.metadata.url,
      locale: row.slug,
      localeName: row.name,
      fallback: row.slug !== requested,
      status: query.mode === 'published' ? 'published' : row.status,
      incoming: 0,
      outgoing: 0,
    });
  }
  const byLocale = new Map([...catalog.values()].map((node) => [node.localeId, node]));
  async function connections(frontier: string[]) {
    const result = await client.query<{ locale_id: string; connections: Connection[] }>(
      `
      SELECT locale_id,connections FROM page_connections WHERE mode=$1 AND locale_id=ANY($2::uuid[])
      AND (locale_id=ANY($3::uuid[]) OR targets && $4::uuid[])
      ORDER BY locale_id`,
      [query.mode, [...byLocale.keys()], frontier.map((id) => catalog.get(id)!.localeId), frontier],
    );
    const edges = new Map<string, PageMapEdge>();
    for (const row of result.rows) {
      const source = byLocale.get(row.locale_id)!;
      for (const connection of row.connections) connection.target = connection.target.toLowerCase();
      const hiddenFields = new Set(
        row.connections.filter((c) => !catalog.has(c.target)).map((c) => `${c.blockId}:${c.field}`),
      );
      for (const c of row.connections) {
        if (
          !catalog.has(c.target) ||
          !canReadField(c) ||
          (restricted && hiddenFields.has(`${c.blockId}:${c.field}`)) ||
          (c.kind === 'reference' && query.references !== 'true')
        )
          continue;
        const key = `${source.id}:${c.target}:${c.kind}`;
        let edge = edges.get(key);
        if (!edge) {
          edge = { source: source.id, target: c.target, kind: c.kind, count: 0, usages: [] };
          edges.set(key, edge);
        }
        edge.count++;
        if (edge.usages.length < 100)
          edge.usages.push({ blockId: c.blockId, block: c.block, field: c.field, label: c.label });
      }
    }
    return [...edges.values()];
  }
  if (!catalog.has(query.root))
    throw new StorypaneError('not_found', 'Page unavailable in this locale and content mode');
  const selected = new Set([query.root]);
  const edges = new Map<string, PageMapEdge>();
  let frontier = [query.root],
    truncated = false;
  for (let hop = 0; hop < query.depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const edge of await connections(frontier)) {
      const outgoing = frontier.includes(edge.source) && query.direction !== 'incoming';
      const incoming = frontier.includes(edge.target) && query.direction !== 'outgoing';
      if (!outgoing && !incoming) continue;
      const key = `${edge.source}:${edge.target}:${edge.kind}`;
      if (edges.has(key)) continue;
      const added = [edge.source, edge.target].filter((id) => !selected.has(id));
      if (selected.size + new Set(added).size > 100 || edges.size >= 500) {
        truncated = true;
        continue;
      }
      for (const id of added) {
        selected.add(id);
        next.push(id);
      }
      edges.set(key, edge);
    }
    frontier = [...new Set(next)];
  }
  for (const edge of edges.values()) {
    catalog.get(edge.source)!.outgoing++;
    catalog.get(edge.target)!.incoming++;
  }
  return {
    nodes: [...selected].map((id) => catalog.get(id)!),
    edges: [...edges.values()],
    truncated,
    limits: { nodes: 100, edges: 500 },
  };
}
