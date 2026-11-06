'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './page-map.css';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import type { PageMapNode, PageMapResponse, Story } from '@storypane/core';
import { api, errorMessage } from '../editor/api';
import { CopyableValue } from '../../components/copyable-value';
import { PublicationStatus } from '../../components/publication-status';

type CardData = { page: PageMapNode; root: boolean; select: (id: string) => void };
function PageCard({ data }: NodeProps<Node<CardData>>) {
  const page = data.page;
  const { fitView } = useReactFlow();
  return (
    <div className={`map-card${data.root ? ' map-card--root' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <small>
        {data.root ? 'Starting page · ' : ''}
        {page.localeName}
        {page.fallback ? ' · fallback' : ''}
      </small>
      <button
        className="map-card-title"
        title={page.title}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible'))
            void fitView({ nodes: [{ id: page.id }], maxZoom: 1, duration: 200 });
        }}
        onClick={() => data.select(page.id)}
      >
        {page.title}
      </button>
      <span className="map-url" title={`/${page.url}`}>
        /{page.url}
      </span>
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
  root,
  locale,
  onOpen,
}: {
  root: string;
  locale: string;
  onOpen: (story: Story, locale?: string) => Promise<void>;
}) {
  const params = new URLSearchParams({ root, locale }).toString();
  const [result, setResult] = useState<PageMapResponse | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setSelected(null);
    setError(null);
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
  }, [params, refresh]);
  const layout = useMemo(() => {
    if (!result) return { nodes: [], edges: [] };
    const graph = new dagre.graphlib.Graph()
      .setDefaultEdgeLabel(() => ({}))
      .setGraph({ rankdir: 'LR', nodesep: 45, ranksep: 100 });
    for (const page of result.nodes) graph.setNode(page.id, { width: 240, height: 180 });
    for (const edge of result.edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);
    return {
      nodes: result.nodes.map((page) => {
        const p = graph.node(page.id);
        return {
          id: page.id,
          type: 'page',
          position: { x: p.x - 120, y: p.y - 90 },
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
    setSelected(null);
    try {
      await onOpen(await api<Story>(`/stories/${page.id}`), page.locale);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const details = detail && (
    <>
      <div className="map-detail-summary">
        <div className="map-detail-meta">
          <PublicationStatus status={detail.status} />
          <span>
            {detail.localeName}
            {detail.fallback ? ' · fallback' : ''}
          </span>
        </div>
        <h3>{detail.title}</h3>
        <p className="map-detail-url mono">/{detail.url}</p>
        <Button variant="primary" onClick={() => void open(detail)}>
          <ArrowUpRight aria-hidden="true" /> Open page
        </Button>
      </div>
      {(['incoming', 'outgoing'] as const).map((direction) => {
        const connections = result!.edges.filter((edge) =>
          direction === 'incoming' ? edge.target === detail.id : edge.source === detail.id,
        );
        const Icon = direction === 'incoming' ? ArrowDownLeft : ArrowUpRight;
        return (
          <section
            className="map-connection-section"
            key={direction}
            aria-label={`${direction} connections`}
          >
            <h3>
              <Icon aria-hidden="true" />
              {direction === 'incoming' ? 'Incoming' : 'Outgoing'}
              <span className="map-connection-count">{connections.length}</span>
            </h3>
            {!connections.length && (
              <p className="map-connections-empty">No {direction} links in this map.</p>
            )}
            <ul className="map-connections">
              {connections.map((edge) => {
                const other = result!.nodes.find(
                  (node) => node.id === (direction === 'incoming' ? edge.source : edge.target),
                )!;
                return (
                  <li key={`${edge.source}:${edge.target}:${edge.kind}`}>
                    <button
                      className="map-connection-page"
                      aria-label={`Show connections for ${other.title}`}
                      onClick={() => setSelected(other.id)}
                    >
                      <span>
                        <strong>{other.title}</strong>
                        <small title={`/${other.url}`}>/{other.url}</small>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                    <details className="map-link-locations">
                      <summary>
                        <ChevronRight aria-hidden="true" />
                        {edge.count} {edge.kind === 'reference' ? 'reference' : 'link'} location
                        {edge.count === 1 ? '' : 's'}
                      </summary>
                      <ul>
                        {edge.usages.map((usage, i) => (
                          <li key={i}>
                            <div className="map-location-context">
                              <strong>{usage.block}</strong>
                              <ChevronRight aria-hidden="true" />
                              <span>{usage.label}</span>
                            </div>
                            <p className="map-location-field">
                              Field <code>{usage.field}</code>
                            </p>
                            <CopyableValue
                              value={usage.blockId}
                              label="Block ID"
                              name={`${usage.block} · ${usage.label}`}
                            />
                          </li>
                        ))}
                      </ul>
                      {edge.count > edge.usages.length && (
                        <p className="map-locations-limit">
                          Showing {edge.usages.length} of {edge.count} locations.
                        </p>
                      )}
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="map-detail-scope">Only visible connections in this map are listed.</p>
    </>
  );
  return (
    <section className="page-map">
      <p className="map-legend">Published page links · 2 hops. Collapse and reopen to refresh.</p>
      <ErrorNotice message={error} retry={() => setRefresh((v) => v + 1)} />
      {loading && <Loading label="Loading page map…" />}
      {result && (
        <>
          {result.truncated && (
            <p role="status">
              Map limited to 100 pages and 500 connections. Open another page to explore its links.
            </p>
          )}
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
        </>
      )}
      <Modal
        open={!!detail}
        onClose={() => setSelected(null)}
        title="Page details"
        className="map-details-dialog"
      >
        {details}
      </Modal>
    </section>
  );
}
