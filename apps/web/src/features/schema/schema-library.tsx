'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Box, ChevronRight, GripVertical, Layers, Plus, Search } from 'lucide-react';
import {
  can,
  definitionInput,
  canonicalJson,
  type BlockDefinition,
  type Datasource,
} from '@storypane/core';
import { Button, EmptyState, ErrorNotice, Loading } from '@storypane/ui';
import { api, dateLabel, errorMessage, jsonRequest } from '../editor/api';
import type { RegisterGuard } from '../editor/navigation';
import { EnvironmentPanel } from './environment-panel';
import { MigrationPanel } from './migration-panel';
import { SchemaDrawer } from './schema-drawer';
import { definitionDescendants, definitionTreeRows } from './definition-tree';
import type { CMSSession } from '../../components/cms-app';

const kindLabels = { nestable: 'Nestable', 'content-type': 'Content type', universal: 'Universal' };
const kindColors = { nestable: 'blue', 'content-type': 'green', universal: 'violet' };

export function SchemaLibrary({
  space,
  registerGuard,
}: {
  space: CMSSession['space'];
  registerGuard: RegisterGuard;
}) {
  const canManage = can(space, 'schemas:write');
  const canDeploy = space.role === 'admin';
  const [deployed, setDeployed] = useState<BlockDefinition[]>([]);
  const [definitions, setDefinitions] = useState<BlockDefinition[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<BlockDefinition | 'new' | null>(null);
  const [initialParentId, setInitialParentId] = useState<string>();
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const requests = useRef({ id: 0, pending: 0 });
  const load = useCallback(async (foreground = true) => {
    const state = requests.current;
    if (!foreground && state.pending) return;
    const current = ++state.id;
    state.pending++;
    if (foreground) setLoading(true);
    try {
      const [blocks, sources, published] = await Promise.all([
        api<BlockDefinition[]>('/definitions'),
        api<Datasource[]>('/datasources'),
        api<BlockDefinition[]>('/definitions?deployed=true'),
      ]);
      if (current !== state.id) return;
      setError(null);
      setDeployed(published);
      setDefinitions(blocks);
      setDatasources(sources);
    } catch (cause) {
      if (current === state.id) setError(errorMessage(cause));
    } finally {
      state.pending--;
      if (current === state.id) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const state = requests.current;
    void load();
    const refresh = () => {
      if (!document.hidden) void load(false);
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      state.id++;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  const rows = definitionTreeRows(definitions, collapsed, search);
  const publishedInputs = new Map(
    deployed.map((item) => [
      item.id,
      canonicalJson({
        schema: definitionInput(item),
        parentDefinitionId: item.parentDefinitionId ?? null,
      }),
    ]),
  );
  const excluded = dragging ? definitionDescendants(definitions, dragging) : new Set<string>();
  const source = definitions.find((item) => item.id === dragging);
  const canDrop = (parentId: string | null) =>
    !!source &&
    !moving &&
    canManage &&
    (source.parentDefinitionId ?? null) !== parentId &&
    (!parentId || !excluded.has(parentId));
  function create(parentId?: string) {
    setInitialParentId(parentId);
    setEditing('new');
  }
  async function move(parentId: string | null) {
    if (!canDrop(parentId) || !source) return;
    setDragging(null);
    setDropTarget(null);
    setMoving(true);
    setMoveError(null);
    try {
      const saved = await api<BlockDefinition>(
        `/definitions/${source.id}/parent`,
        jsonRequest('PUT', {
          parentDefinitionId: parentId,
          expectedParentDefinitionId: source.parentDefinitionId ?? null,
        }),
      );
      requests.current.id++;
      setDefinitions((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      if (parentId)
        setCollapsed((current) => {
          const next = new Set(current);
          next.delete(parentId);
          return next;
        });
      setAnnouncement(
        `Moved ${source.displayName} ${parentId ? `under ${definitions.find((item) => item.id === parentId)?.displayName}` : 'to the root'}. Parent saved.`,
      );
      await load(false);
    } catch (cause) {
      setMoveError(errorMessage(cause));
    } finally {
      setMoving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Block library</h1>
          <p>The building blocks behind your stories.</p>
        </div>
        {canManage && (
          <Button variant="primary" disabled={moving} onClick={() => create()}>
            <Plus /> New block
          </Button>
        )}
      </div>
      <EnvironmentPanel canDeploy={canDeploy} onApply={load} spaceName={space.name} />
      <MigrationPanel canDeploy={canDeploy && canManage} onDeploy={load} />
      <ErrorNotice
        message={moveError ?? error}
        retry={() => {
          setMoveError(null);
          void load();
        }}
      />
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <div className="toolbar definition-library-toolbar">
        <div className="search-input">
          <Search />
          <input
            type="search"
            aria-label="Search blocks"
            placeholder="Search your blocks…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="small muted">{definitions.length} block types</span>
        {dragging && (
          <div
            className="definition-root-drop"
            data-drop-target={dropTarget === 'root' || undefined}
            onDragOver={(event) => {
              if (canDrop(null)) {
                event.preventDefault();
                setDropTarget('root');
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              event.preventDefault();
              void move(null);
            }}
          >
            Move to root · No parent
          </div>
        )}
      </div>
      <div className="panel definition-library" aria-busy={moving}>
        {loading ? (
          <Loading />
        ) : rows.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Usage</th>
                <th className="table-mobile-hide">Fields</th>
                <th className="table-mobile-hide">Updated</th>
                {canManage && (
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ definition: item, depth, hasChildren }) => (
                <tr
                  key={item.id}
                  data-definition-id={item.id}
                  data-depth={depth}
                  data-drop-target={dropTarget === item.id || undefined}
                  onDragOver={(event) => {
                    if (canDrop(item.id)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropTarget(item.id);
                    } else setDropTarget(null);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                      setDropTarget(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void move(item.id);
                  }}
                >
                  <td>
                    <div
                      className="entity-name definition-tree-name"
                      style={{ '--definition-depth': depth } as CSSProperties}
                    >
                      {canManage && (
                        <button
                          className="definition-drag"
                          type="button"
                          draggable={!moving}
                          disabled={moving}
                          aria-label={`Drag ${item.displayName}`}
                          title="Drag to change parent; use Config for keyboard controls"
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', item.id);
                            event.dataTransfer.effectAllowed = 'move';
                            setDragging(item.id);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                        >
                          <GripVertical aria-hidden="true" />
                        </button>
                      )}
                      {hasChildren ? (
                        <button
                          className="definition-toggle"
                          type="button"
                          aria-label={`${collapsed.has(item.id) && !search.trim() ? 'Expand' : 'Collapse'} ${item.displayName}`}
                          aria-expanded={!!search.trim() || !collapsed.has(item.id)}
                          disabled={!!search.trim()}
                          onClick={() =>
                            setCollapsed((current) => {
                              const next = new Set(current);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                        >
                          <ChevronRight aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="definition-toggle-spacer" />
                      )}
                      <span className="entity-icon">
                        {item.kind === 'nestable' ? <Layers /> : <Box />}
                      </span>
                      <div>
                        <button
                          className="entity-title"
                          disabled={moving}
                          onClick={() => setEditing(item)}
                        >
                          {item.displayName}
                        </button>
                        <div>
                          {publishedInputs.get(item.id) !==
                            canonicalJson({
                              schema: definitionInput(item),
                              parentDefinitionId: item.parentDefinitionId ?? null,
                            }) && <span className="pill pill--outline">Pending migration</span>}
                        </div>
                        <div className="entity-subtitle mono">{item.name}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`pill pill--${kindColors[item.kind]}`}>
                      {kindLabels[item.kind]}
                    </span>
                  </td>
                  <td className="table-mobile-hide">
                    <span className="small muted">
                      {item.fields.length} fields · v{item.version}
                    </span>
                  </td>
                  <td className="table-mobile-hide">
                    <span className="small muted">{dateLabel(item.createdAt)}</span>
                  </td>
                  {canManage && (
                    <td>
                      <Button
                        variant="ghost"
                        className="icon-button"
                        disabled={moving}
                        aria-label={`Create nested block under ${item.displayName}`}
                        title="Create nested block"
                        onClick={() => create(item.id)}
                      >
                        <Plus />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title={search ? 'No matching blocks' : 'Good content starts with a block'}
            action={
              canManage &&
              !search && (
                <Button onClick={() => create()}>
                  <Plus /> Create your first block
                </Button>
              )
            }
          >
            Define a content type for your pages, then add nestable sections to compose them.
          </EmptyState>
        )}
      </div>
      {editing && (
        <SchemaDrawer
          key={editing === 'new' ? `new-${initialParentId ?? 'root'}` : editing.id}
          initialDefinition={editing === 'new' ? null : editing}
          initialParentId={editing === 'new' ? initialParentId : undefined}
          definitions={definitions}
          datasources={datasources}
          space={space}
          registerGuard={registerGuard}
          onClose={() => setEditing(null)}
          onSave={async () => setDefinitions(await api<BlockDefinition[]>('/definitions'))}
          onDelete={() => {
            setEditing(null);
            setAnnouncement('Block deletion saved to the active migration.');
            void load();
          }}
        />
      )}
    </>
  );
}
