'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import './page-map.css';
import { Button, ErrorNotice, Field, Loading, Modal } from '@storypane/ui';
import type {
  PageMapNode,
  PageMapResponse,
  PageMapPages,
  SpaceLocale,
  Story,
} from '@storypane/core';
import { api, errorMessage } from '../editor/api';
import { PublicationStatus } from '../../components/publication-status';

type CardData = { page: PageMapNode; root: boolean; select: (id: string) => void };
function PageCard({ data }: NodeProps<Node<CardData>>) {
  const page = data.page;
  return (
    <div className={`map-card${data.root ? ' map-card--root' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <small>
        {data.root ? 'Starting page · ' : ''}
        {page.localeName}
        {page.fallback ? ' · fallback' : ''}
      </small>
      <button className="map-card-title" onClick={() => data.select(page.id)}>
        {page.title}
      </button>
      <span className="map-url">/{page.url}</span>
      <PublicationStatus status={page.status} />
      <small>
        {page.incoming} incoming · {page.outgoing} outgoing
      </small>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { page: PageCard };

export default function PageMap({
  params,
  onChange,
  onList,
  onOpen,
}: {
  params: string;
  onChange: (params: string) => void;
  onList: () => void;
  onOpen: (story: Story, locale?: string) => void;
}) {
  const query = useMemo(() => new URLSearchParams(params), [params]);
  const root = query.get('root');
  const [locales, setLocales] = useState<SpaceLocale[]>([]);
  const [result, setResult] = useState<PageMapResponse | null>(null);
  const [pages, setPages] = useState<PageMapPages | null>(null);
  const [orphans, setOrphans] = useState<PageMapPages | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [pickerOffset, setPickerOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<SpaceLocale[]>('/locales', { signal: controller.signal })
      .then(setLocales)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setSelected(null);
    setError(null);
    if (!root) return () => controller.abort();
    setLoading(true);
    void api<PageMapResponse>(`/page-map?${params}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params, root, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setPages(null);
    const p = new URLSearchParams(params);
    p.set('search', search);
    p.set('offset', String(pickerOffset));
    const timer = setTimeout(
      () =>
        void api<PageMapPages>(`/page-map/pages?${p}`, { signal: controller.signal })
          .then((data) => {
            if (!controller.signal.aborted) setPages(data);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(errorMessage(e));
          }),
      200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [params, search, pickerOffset, refresh]);
  useEffect(() => {
    if (!showOrphans) return;
    const controller = new AbortController();
    setOrphans(null);
    const p = new URLSearchParams(params);
    p.set('offset', String(offset));
    void api<PageMapPages>(`/page-map/orphans?${p}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setOrphans(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [params, offset, showOrphans, refresh]);
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setOffset(0);
    setPickerOffset(0);
    onChange(next.toString());
  }
  const layout = useMemo(() => {
    if (!result) return { nodes: [], edges: [] };
    const graph = new dagre.graphlib.Graph()
      .setDefaultEdgeLabel(() => ({}))
      .setGraph({ rankdir: 'LR', nodesep: 45, ranksep: 100 });
    for (const page of result.nodes) graph.setNode(page.id, { width: 240, height: 155 });
    for (const edge of result.edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);
    return {
      nodes: result.nodes.map((page) => {
        const p = graph.node(page.id);
        return {
          id: page.id,
          type: 'page',
          position: { x: p.x - 120, y: p.y - 77.5 },
          data: { page, root: page.id === root, select: setSelected },
          ariaLabel: `${page.title}, ${page.localeName}. Show connections`,
          draggable: false,
          deletable: false,
        };
      }),
      edges: result.edges.map((edge) => ({
        id: `${edge.source}:${edge.target}:${edge.kind}`,
        source: edge.source,
        target: edge.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        label: edge.count > 1 ? String(edge.count) : undefined,
        style: { strokeDasharray: edge.kind === 'reference' ? '6 4' : undefined },
        deletable: false,
      })),
    };
  }, [result, root]);
  const detail = result?.nodes.find((node) => node.id === selected);
  async function open(page: PageMapNode) {
    try {
      onOpen(await api<Story>(`/stories/${page.id}`), page.locale);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const details = detail && (
    <>
      <h2>{detail.title}</h2>
      <p>
        /{detail.url} · {detail.localeName}
        {detail.fallback ? ' (fallback)' : ''}
      </p>
      <div className="button-group">
        <Button onClick={() => void open(detail)}>Open page</Button>
        <Button onClick={() => change('root', detail.id)}>Explore from here</Button>
      </div>
      {(['incoming', 'outgoing'] as const).map((direction) => (
        <section key={direction}>
          <h3>{direction === 'incoming' ? 'Incoming' : 'Outgoing'} in this map</h3>
          <ul className="map-connections">
            {result!.edges
              .filter((e) =>
                direction === 'incoming' ? e.target === detail.id : e.source === detail.id,
              )
              .map((edge) => {
                const other = result!.nodes.find(
                  (n) => n.id === (direction === 'incoming' ? edge.source : edge.target),
                )!;
                return (
                  <li key={`${edge.source}:${edge.target}:${edge.kind}`}>
                    <button onClick={() => setSelected(other.id)}>{other.title}</button>
                    <small>
                      {edge.kind === 'reference' ? 'Content reference' : 'Page link'} · {edge.count}{' '}
                      usage{edge.count === 1 ? '' : 's'}
                    </small>
                    <ul>
                      {edge.usages.map((usage, i) => (
                        <li key={i}>
                          {usage.block} → {usage.label} <code>{usage.field}</code>{' '}
                          <small>Block {usage.blockId}</small>
                        </li>
                      ))}
                    </ul>
                    {edge.count > edge.usages.length && (
                      <p>Showing the first {edge.usages.length} usages.</p>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </>
  );
  return (
    <section className="page-map">
      <div className="page-heading">
        <div>
          <h1>Page map</h1>
          <p>Explore page links and find potential orphans.</p>
        </div>
        <div className="button-group" aria-label="Content view">
          <Button onClick={onList}>List</Button>
          <Button aria-pressed>Map</Button>
          <Button onClick={() => setRefresh((v) => v + 1)}>Refresh</Button>
        </div>
      </div>
      <div className="map-toolbar">
        <Field label="Content mode" htmlFor="map-mode">
          <select
            id="map-mode"
            value={query.get('mode') ?? 'published'}
            onChange={(e) => change('mode', e.target.value)}
          >
            <option value="published">Published content</option>
            <option value="draft">Saved drafts</option>
          </select>
        </Field>
        <Field label="Locale" htmlFor="map-locale">
          <select
            id="map-locale"
            value={query.get('locale') ?? locales.find((l) => l.isDefault)?.slug ?? ''}
            onChange={(e) => change('locale', e.target.value)}
          >
            {locales.map((l) => (
              <option key={l.id} value={l.slug}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Depth" htmlFor="map-depth">
          <select
            id="map-depth"
            value={query.get('depth') ?? '2'}
            onChange={(e) => change('depth', e.target.value)}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} hop{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Direction" htmlFor="map-direction">
          <select
            id="map-direction"
            value={query.get('direction') ?? 'outgoing'}
            onChange={(e) => change('direction', e.target.value)}
          >
            <option value="outgoing">Outgoing</option>
            <option value="incoming">Incoming</option>
            <option value="both">Both</option>
          </select>
        </Field>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={query.get('references') === 'true'}
            onChange={(e) => change('references', String(e.target.checked))}
          />
          Include content references
        </label>
      </div>
      <details className="map-picker" open={!root || undefined}>
        <summary>
          Choose a starting page
          {result ? ` · ${result.nodes.find((n) => n.id === root)?.title ?? ''}` : ''}
        </summary>
        <Field label="Find a page" htmlFor="map-search">
          <input
            id="map-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPickerOffset(0);
            }}
            placeholder="Search title or URL"
          />
        </Field>
        <ul className="map-page-list">
          {pages?.pages.map((page) => (
            <li key={page.id}>
              <Button onClick={() => change('root', page.id)}>
                {page.title}{' '}
                <small>
                  /{page.url} · {page.localeName}
                  {page.fallback ? ' · fallback' : ''}
                </small>
              </Button>
            </li>
          ))}
        </ul>
        {pages?.pages.length === 0 && <p>No pages in this content mode and locale.</p>}
        <div className="button-group">
          <Button
            disabled={!pickerOffset}
            onClick={() => setPickerOffset((v) => Math.max(0, v - 50))}
          >
            Previous pages
          </Button>
          <Button
            disabled={pages?.nextOffset == null}
            onClick={() => setPickerOffset(pages!.nextOffset!)}
          >
            More pages
          </Button>
        </div>
      </details>
      <ErrorNotice message={error} retry={() => setRefresh((v) => v + 1)} />
      {loading && root && <Loading label="Loading page map…" />}
      {result && (
        <>
          <p className="map-legend">
            → Page links · ╌→ Content references (not necessarily navigation). Counts show visible
            connections in this map.
          </p>
          {result.truncated && (
            <p role="status">
              Map limited to 100 pages and 500 connections. Select a page and choose Explore from
              here to continue.
            </p>
          )}
          <div className="map-workspace">
            <div className="map-canvas" aria-label="Page connections canvas">
              <ReactFlow
                key={`${params}:${refresh}`}
                nodes={layout.nodes}
                edges={layout.edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
                minZoom={0.1}
                maxZoom={2}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesReconnectable={false}
                deleteKeyCode={null}
                onNodeClick={(_, node) => setSelected(node.id)}
                nodesFocusable={false}
              >
                <Background gap={22} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
            {!narrow && detail && (
              <aside className="map-details" aria-label="Page details">
                <Button onClick={() => setSelected(null)}>Close details</Button>
                {details}
              </aside>
            )}
          </div>
          <details className="map-accessible-list" open>
            <summary>
              Connection list · {result.nodes.length} pages, {result.edges.length} connections
            </summary>
            <ul>
              {result.nodes.map((page) => (
                <li key={page.id}>
                  <Button onClick={() => setSelected(page.id)}>
                    {page.title} — {page.incoming} incoming, {page.outgoing} outgoing
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <Button onClick={() => setShowOrphans((v) => !v)} aria-expanded={showOrphans}>
        Potential orphans
      </Button>
      {showOrphans && (
        <section className="map-orphans">
          <h2>{orphans?.restricted ? 'No visible incoming links' : 'Potential orphans'}</h2>
          <p>
            Pages with no incoming page links from another page across this locale and content mode.
            External entry points and frontend-generated navigation are outside this check. A
            candidate is not automatically an error.
          </p>
          {!orphans ? (
            <Loading label="Checking incoming links…" />
          ) : (
            <>
              <ul className="map-page-list">
                {orphans.pages.map((page) => (
                  <li key={page.id}>
                    <span>
                      {page.title} · /{page.url} · {page.localeName}
                      {page.fallback ? ' · fallback' : ''}
                    </span>
                    <Button onClick={() => change('root', page.id)}>View in map</Button>
                  </li>
                ))}
              </ul>
              {!orphans.pages.length && <p>No candidates found.</p>}
              <div className="button-group">
                <Button disabled={!offset} onClick={() => setOffset((v) => Math.max(0, v - 50))}>
                  Previous
                </Button>
                <Button
                  disabled={orphans.nextOffset === null}
                  onClick={() => setOffset(orphans.nextOffset!)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </section>
      )}
      {narrow && (
        <Modal
          open={!!detail}
          onClose={() => setSelected(null)}
          title="Page details"
          className="map-sheet"
        >
          {details}
        </Modal>
      )}
    </section>
  );
}
