'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Layers, Plus, Search } from 'lucide-react';
import type { BlockDefinition, Datasource } from '@storypane/core';
import { Button, EmptyState, ErrorNotice, Loading } from '@storypane/ui';
import { api, dateLabel, errorMessage } from '../editor/api';
import type { RegisterGuard } from '../editor/navigation';
import { MigrationPanel } from './migration-panel';
import { SchemaDrawer } from './schema-drawer';

const kindLabels = { nestable: 'Nestable', 'content-type': 'Content type', universal: 'Universal' };
const kindColors = { nestable: 'blue', 'content-type': 'green', universal: 'violet' };

export function SchemaLibrary({
  canManage,
  canDeploy,
  registerGuard,
}: {
  canManage: boolean;
  canDeploy: boolean;
  registerGuard: RegisterGuard;
}) {
  const [deployed, setDeployed] = useState<BlockDefinition[]>([]);
  const [definitions, setDefinitions] = useState<BlockDefinition[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<BlockDefinition | 'new' | null>(null);
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
  const filtered = definitions.filter((item) =>
    `${item.name} ${item.displayName}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Block library</h1>
          <p>The building blocks behind your stories.</p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus /> New block
          </Button>
        )}
      </div>
      <MigrationPanel canDeploy={canDeploy} onDeploy={load} />
      <ErrorNotice message={error} retry={() => void load()} />
      <div className="toolbar">
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
      </div>
      <div className="panel">
        {loading ? (
          <Loading />
        ) : filtered.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Usage</th>
                <th className="table-mobile-hide">Fields</th>
                <th className="table-mobile-hide">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="entity-name">
                      <span className="entity-icon">
                        {item.kind === 'nestable' ? <Layers /> : <Box />}
                      </span>
                      <div>
                        <button className="entity-title" onClick={() => setEditing(item)}>
                          {item.displayName}
                        </button>
                        <div>
                          {deployed.find((definition) => definition.id === item.id)?.versionId !==
                            item.versionId && (
                            <span className="pill pill--outline">Pending migration</span>
                          )}
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
                <Button onClick={() => setEditing('new')}>
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
          initialDefinition={editing === 'new' ? null : editing}
          definitions={definitions}
          datasources={datasources}
          canManage={canManage}
          registerGuard={registerGuard}
          onClose={() => setEditing(null)}
          onSave={async () => setDefinitions(await api<BlockDefinition[]>('/definitions'))}
        />
      )}
    </>
  );
}
