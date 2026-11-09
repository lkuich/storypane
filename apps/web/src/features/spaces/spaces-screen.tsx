'use client';

import { AccountControl } from '../../components/account-control';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  Building2,
  FileText,
  Plus,
  Search,
  Settings2,
  Users,
} from 'lucide-react';
import { DependencySummary } from '../schema/environment-panel';
import type { Space, SchemaTransferReview } from '@storypane/core';
import { Button, EmptyState, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { errorMessage, jsonRequest, requestJson } from '../editor/api';
import './spaces.css';
import { ThemePicker } from '../../components/theme-picker';
import { EnvironmentBadge } from '../../components/environment-badge';

export function SpacesScreen({ installationAdmin = false }: { installationAdmin?: boolean }) {
  const [mode, setMode] = useState('create');
  const [environment, setEnvironment] = useState<'prod' | 'dev'>('prod');
  const [baseSpaceId, setBaseSpaceId] = useState('');
  const [cloneReview, setCloneReview] = useState<SchemaTransferReview | null>(null);
  const [connectionString, setConnectionString] = useState('');
  const [operationId, setOperationId] = useState('');
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [creating, setCreating] = useState(false);
  const [name, setName] = useState(''),
    [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false),
    [formError, setFormError] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    try {
      setSpaces(await requestJson<Space[]>('/api/spaces'));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const filtered = spaces.filter((space) =>
    `${space.name} ${space.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="spaces-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="spaces-header">
        <a className="brand-lockup" href="/" aria-label="Storypane home">
          <span className="brand-mark">
            <Boxes aria-hidden="true" />
          </span>
          <span className="brand-name">
            storypane<span className="brand-period">.</span>
          </span>
        </a>
        <span className="spaces-header-label">
          <Building2 aria-hidden="true" />
          Spaces
        </span>
        <div className="spaces-account">
          <ThemePicker />
          <AccountControl />
        </div>
      </header>
      <main className="spaces-main" id="main-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">Your workspace, organized</div>
            <h1>Spaces</h1>
            <p>A home for every project. Pick up where your team left off.</p>
          </div>
          {installationAdmin && (
            <Button
              variant="primary"
              onClick={() => {
                setOperationId(crypto.randomUUID());
                setMode('create');
                setConnectionString('');
                setBaseSpaceId('');
                setCloneReview(null);
                setEnvironment('prod');
                setName('');
                setDescription('');
                setFormError('');
                setCreating(true);
              }}
            >
              <Plus aria-hidden="true" />
              Create space
            </Button>
          )}
        </div>
        <div className="spaces-toolbar">
          <label className="search-input">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="Search spaces"
              placeholder="Search your spaces…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span>
            {spaces.length} {spaces.length === 1 ? 'space' : 'spaces'}
          </span>
        </div>
        <ErrorNotice message={error} retry={load} />
        {loading ? (
          <Loading label="Loading your spaces…" />
        ) : (
          !error &&
          (filtered.length ? (
            <div className="spaces-grid">
              {filtered.map((space) => (
                <article
                  className="space-card"
                  key={space.id}
                  aria-label={space.name}
                  data-environment={space.environment === 'dev' ? 'dev' : 'prod'}
                >
                  <div className="space-card-top">
                    <span className="space-emblem">
                      <Building2 aria-hidden="true" />
                    </span>
                    <EnvironmentBadge environment={space.environment} />
                  </div>
                  <h2>
                    {space.role ? <a href={`/?space=${space.id}`}>{space.name}</a> : space.name}
                  </h2>
                  <p className="space-description">
                    {space.description || 'Your stories, blocks, and assets in one place.'}
                  </p>
                  {space.environment === 'dev' &&
                    (() => {
                      const production = spaces.find(
                        (s) => s.id === space.productionSpaceId && s.role,
                      );
                      return (
                        <p className="space-family">
                          {production ? (
                            <>
                              Production: <a href={`/?space=${production.id}`}>{production.name}</a>
                            </>
                          ) : space.productionSpaceId ? (
                            'Linked production space'
                          ) : (
                            'Standalone development space'
                          )}
                        </p>
                      );
                    })()}
                  {space.environment !== 'dev' &&
                    (() => {
                      const linked = spaces.filter(
                        (s) => s.productionSpaceId === space.id && s.role,
                      );
                      return linked.length ? (
                        <details className="space-family">
                          <summary>
                            {linked.length} linked development{' '}
                            {linked.length === 1 ? 'space' : 'spaces'}
                          </summary>
                          <ul>
                            {linked.map((dev) => (
                              <li key={dev.id}>
                                <a href={`/?space=${dev.id}`}>{dev.name}</a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null;
                    })()}
                  <div className="space-stats">
                    <span>
                      <FileText aria-hidden="true" />
                      {space.storyCount} {space.storyCount === 1 ? 'story' : 'stories'}
                    </span>
                    <span>
                      <Users aria-hidden="true" />
                      {space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                  {space.role ? (
                    <footer>
                      {installationAdmin && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setOperationId(crypto.randomUUID());
                            setMode('create');
                            setConnectionString('');
                            setBaseSpaceId(space.id);
                            setEnvironment('dev');
                            setCloneReview(null);
                            setName(`${space.name} dev`);
                            setDescription('');
                            setFormError('');
                            setCreating(true);
                          }}
                        >
                          Clone space
                        </Button>
                      )}
                      <a
                        className="button button--ghost button--small"
                        href={`/?space=${space.id}&view=settings`}
                        aria-label={`Settings for ${space.name}`}
                      >
                        <Settings2 aria-hidden="true" />
                        Settings
                      </a>
                      <a
                        className="space-open"
                        href={`/?space=${space.id}`}
                        aria-label={`Open ${space.name}`}
                      >
                        Open space
                        <ArrowRight aria-hidden="true" />
                      </a>
                    </footer>
                  ) : (
                    <p role="status">
                      {space.provisioningStatus === 'ready'
                        ? 'Membership required or database unavailable'
                        : space.provisioningStatus}
                    </p>
                  )}
                  {installationAdmin && space.provisioningStatus === 'failed' && (
                    <Button
                      onClick={() => {
                        setMode(space.provisioningMode === 'attach' ? 'attach' : 'create');
                        setOperationId(space.id);
                        setEnvironment(space.environment ?? 'prod');
                        setBaseSpaceId(space.cloneSourceSpaceId ?? '');
                        setCloneReview(null);
                        setFormError('');
                        setName(space.name);
                        setDescription(space.description);
                        setCreating(true);
                      }}
                    >
                      Retry provisioning
                    </Button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="panel">
              <EmptyState title={spaces.length ? 'No matching spaces' : 'Create your first space'}>
                {spaces.length
                  ? 'Try a different name or description.'
                  : 'Bring a project’s content, blocks, and assets together in a dedicated workspace.'}
              </EmptyState>
            </div>
          ))
        )}
      </main>
      <Modal
        className="environment-dialog clone-space-dialog"
        open={creating}
        onClose={() => {
          if (!submitting) setCreating(false);
        }}
        title="Create a space"
        description={
          baseSpaceId
            ? 'Start with an existing schema, including block nesting.'
            : 'Choose an environment and a starting point for your project.'
        }
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setFormError('');
            try {
              if (baseSpaceId && !cloneReview) {
                setCloneReview(
                  await requestJson<SchemaTransferReview>(
                    '/api/spaces/clone-review',
                    jsonRequest('POST', { id: operationId, baseSpaceId, environment }),
                  ),
                );
                return;
              }
              await requestJson(
                '/api/spaces',
                jsonRequest('POST', {
                  id: operationId,
                  name,
                  description,
                  mode,
                  environment,
                  ...(baseSpaceId ? { baseSpaceId, reviewToken: cloneReview?.token } : {}),
                  ...(mode === 'attach' && connectionString ? { connectionString } : {}),
                }),
              );
              await load();
              setSearch('');
              setCreating(false);
            } catch (cause) {
              setFormError(errorMessage(cause));
              setCloneReview(null);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="clone-fields">
            <fieldset className="space-settings-fields" disabled={submitting}>
              <label className="field">
                Space name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={120}
                  placeholder="e.g. Marketing website"
                  autoFocus
                />
              </label>
              <label className="field">
                Description{' '}
                <span className="field-hint">Optional · Help your team recognize this space.</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={1000}
                  placeholder="What will you create here?"
                />
              </label>
              <label className="field">
                Environment
                <select
                  value={environment}
                  onChange={(event) => {
                    setEnvironment(event.target.value as 'prod' | 'dev');
                    setCloneReview(null);
                  }}
                >
                  <option value="prod">Production</option>
                  <option value="dev">Development</option>
                </select>
              </label>
              <div className="clone-guidance">
                <EnvironmentBadge environment={environment} />
                <p>
                  {environment === 'dev'
                    ? 'Build and test schema changes here before promoting them to production.'
                    : 'Schemas start read-only. Review and promote changes from a linked development space.'}
                </p>
              </div>
              <label className="field">
                Base space
                <select
                  aria-label="Base space"
                  aria-describedby="base-space-guidance"
                  value={baseSpaceId}
                  onChange={(event) => {
                    setBaseSpaceId(event.target.value);
                    setCloneReview(null);
                  }}
                >
                  <option value="">Empty space</option>
                  {spaces
                    .filter((s) => s.role && s.provisioningStatus === 'ready')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.environment === 'dev' ? 'Dev' : 'Prod'})
                      </option>
                    ))}
                </select>
                <span className="field-hint" id="base-space-guidance">
                  {baseSpaceId
                    ? (() => {
                        const base = spaces.find((s) => s.id === baseSpaceId);
                        const production =
                          base?.environment === 'dev'
                            ? spaces.find((s) => s.id === base.productionSpaceId)
                            : base;
                        return environment === 'dev' && production
                          ? `Linked to production: ${production.name}.`
                          : environment === 'dev' && base?.productionSpaceId
                            ? `Links to the same production space as ${base.name}.`
                            : environment === 'prod' &&
                                base?.environment === 'dev' &&
                                !base.productionSpaceId
                              ? `Links ${base.name} to this new production space.`
                              : 'Creates an independent space from the deployed schema.';
                      })()
                    : 'Start empty, or copy deployed blocks and their nesting from another space.'}
                </span>
              </label>
              {baseSpaceId && (
                <p className="small muted">
                  Content and media stay in the base space, except dependencies required by schema
                  defaults. Review these before creating.
                </p>
              )}
              <details className="clone-database" open={mode === 'attach' || undefined}>
                <summary>Database options</summary>
                <label className="field">
                  Database
                  <select value={mode} onChange={(event) => setMode(event.target.value)}>
                    <option value="create">Create a database</option>
                    <option value="attach">Attach an empty database</option>
                  </select>
                </label>
                {mode === 'attach' && (
                  <label className="field">
                    Database connection URL
                    <input
                      type="password"
                      autoComplete="off"
                      value={connectionString}
                      onChange={(event) => setConnectionString(event.target.value)}
                      placeholder="postgresql://role:password@host/database"
                    />
                  </label>
                )}
              </details>
              {cloneReview && <DependencySummary review={cloneReview} />}
              <p className="small muted">You’ll be the administrator of this space.</p>
            </fieldset>
          </div>
          <ErrorNotice message={formError} />
          <div className="dialog-actions">
            <Button disabled={submitting} onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={submitting || !name.trim()}>
              {submitting
                ? 'Saving…'
                : baseSpaceId && !cloneReview
                  ? 'Review clone'
                  : 'Create space'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
