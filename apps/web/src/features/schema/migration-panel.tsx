'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GitBranch,
  History,
  KeyRound,
} from 'lucide-react';
import {
  migrationChanges,
  type ManagementToken,
  type MigrationReview,
  type SchemaMigration,
  type SpaceDetails,
} from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { MigrationReviewDialog } from './migration-review';
import { MigrationHistoryDialog } from './migration-history';
import { MigrationChangeCount } from './migration-diff';
import { api, errorMessage, jsonRequest } from '../editor/api';

function migrationLocation(id?: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('migration', id);
  else url.searchParams.delete('migration');
  window.history.replaceState(window.history.state, '', url);
}
function deployedDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Date unavailable';
}

export function MigrationPanel({
  canDeploy,
  onDeploy,
}: {
  canDeploy: boolean;
  onDeploy: () => Promise<void>;
}) {
  const [history, setHistory] = useState<SchemaMigration[] | null>(null),
    [historyError, setHistoryError] = useState(''),
    [historyAttempt, setHistoryAttempt] = useState(0),
    [showAll, setShowAll] = useState(false);
  const [migrations, setMigrations] = useState<SchemaMigration[] | null>(null),
    [review, setReview] = useState<MigrationReview | null>(null),
    [past, setPast] = useState<SchemaMigration | null>(null);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false),
    [tokens, setTokens] = useState<ManagementToken[] | null>(null),
    [name, setName] = useState(''),
    [capability, setCapability] = useState<ManagementToken['capability']>('stage'),
    [secret, setSecret] = useState('');
  const linkedMigrationHandled = useRef(false);
  const workspace = migrations?.find((item) => item.status === 'active'),
    deployed = migrations?.filter((item) => item.status === 'deployed').at(-1);
  const pendingChanges =
    workspace && deployed ? migrationChanges(deployed.definitions, workspace.definitions) : [];
  const active = workspace && (!deployed?.version || pendingChanges.length) ? workspace : undefined;
  const load = useCallback(async () => {
    setMigrations(await api<SchemaMigration[]>('/migrations?workspace=true'));
    setLoadError('');
    setHistoryAttempt((value) => value + 1);
  }, []);
  const action = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);
  const inspect = useCallback(
    (id: string, destructive = false) =>
      action(async () => {
        setReview(
          await api<MigrationReview>(
            `/migrations/${encodeURIComponent(id)}/review?destructive=${destructive}`,
          ),
        );
        setPast(null);
        migrationLocation(id);
      }),
    [action],
  );
  useEffect(() => {
    let stopped = false,
      refreshing = false;
    const refresh = () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      void api<SchemaMigration[]>('/migrations?workspace=true')
        .then((value) => {
          if (!stopped) {
            setMigrations(value);
            setLoadError('');
          }
        })
        .catch((cause) => {
          if (!stopped) setLoadError(errorMessage(cause));
        })
        .finally(() => {
          refreshing = false;
        });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    if (deployed?.version === undefined) return;
    let stopped = false;
    setHistory(null);
    setHistoryError('');
    void api<SchemaMigration[]>('/migrations')
      .then((value) => {
        if (!stopped) setHistory(value);
      })
      .catch((cause) => {
        if (!stopped) setHistoryError(errorMessage(cause));
      });
    return () => {
      stopped = true;
    };
  }, [deployed?.version, historyAttempt]);
  useEffect(() => {
    let stopped = false;
    void api<SpaceDetails>('/space')
      .then((value) => {
        if (!stopped)
          setPeople(Object.fromEntries(value.members.map((member) => [member.id, member.name])));
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (!history || linkedMigrationHandled.current) return;
    linkedMigrationHandled.current = true;
    const id = new URLSearchParams(window.location.search).get('migration');
    if (!id) return;
    const migration = history.find((item) => item.id === id);
    if (!migration) {
      setError('This migration could not be found in this space.');
      return;
    }
    if (migration.status === 'deployed') setPast(migration);
    else void inspect(id);
  }, [history, inspect]);
  useEffect(() => {
    if (!canDeploy || !tokensOpen) return;
    let stopped = false;
    void api<ManagementToken[]>('/management-tokens')
      .then((value) => {
        if (!stopped) setTokens(value.filter((token) => !token.scopes));
      })
      .catch((cause) => {
        if (!stopped) setError(errorMessage(cause));
      });
    return () => {
      stopped = true;
    };
  }, [canDeploy, tokensOpen]);
  function closeReview() {
    setReview(null);
    setPast(null);
    migrationLocation();
  }
  function openHistory(item: SchemaMigration) {
    setPast(item);
    setReview(null);
    migrationLocation(item.id);
  }
  const releases = (history ?? [])
    .filter((item) => item.status === 'deployed' && item.version > 0)
    .reverse();
  return (
    <section className="panel migration-panel" aria-label="Schema migrations">
      <header className="migration-panel-heading">
        <div>
          <span className="migration-panel-icon">
            <GitBranch size={19} aria-hidden="true" />
          </span>
          <div>
            <h2>Schema migrations</h2>
            <p>Track what’s live and what’s coming next.</p>
          </div>
        </div>
        {canDeploy && (
          <Button variant="ghost" onClick={() => setTokensOpen(true)} disabled={busy}>
            <KeyRound size={15} aria-hidden="true" />
            CLI access
          </Button>
        )}
      </header>
      {(error || loadError) && (
        <div className="migration-panel-error">
          <ErrorNotice
            message={error || loadError}
            retry={() => {
              setError('');
              void load().catch((cause) => setLoadError(errorMessage(cause)));
            }}
          />
        </div>
      )}
      {!migrations ? (
        <Loading label="Loading migrations…" />
      ) : (
        <>
          <div className="migration-release-strip">
            <div className="migration-current-release">
              <span className="migration-overline">Current release</span>
              <div>
                <strong>{deployed?.version ? `v${deployed.version}` : '—'}</strong>
                <span className={`pill ${deployed?.version ? 'pill--green' : 'pill--outline'}`}>
                  {deployed?.version ? (
                    <>
                      <Check size={12} aria-hidden="true" />
                      Deployed
                    </>
                  ) : (
                    'Not deployed'
                  )}
                </span>
              </div>
              <p>
                {deployed?.version ? (
                  <>
                    Deployed{' '}
                    <time dateTime={deployed.deployedAt ?? undefined}>
                      {deployedDate(deployed.deployedAt)}
                    </time>
                  </>
                ) : (
                  'Deploy a migration to make schemas available.'
                )}
              </p>
            </div>
            <div className={`migration-workspace ${active ? 'has-pending' : ''}`}>
              <span className="migration-workspace-icon">
                {active ? (
                  <GitBranch size={21} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={23} aria-hidden="true" />
                )}
              </span>
              <div>
                <span className="migration-overline">
                  {active ? 'Active migration' : 'Workspace'}
                </span>
                <h3>
                  {active
                    ? `Migration ${active.version}`
                    : deployed?.version
                      ? 'All changes deployed'
                      : 'Ready for your first schema'}
                </h3>
                <p>
                  {active
                    ? active.name
                    : deployed?.version
                      ? 'Your schema is up to date.'
                      : 'Add a block to start a migration.'}
                </p>
                {active && <MigrationChangeCount changes={pendingChanges} />}
              </div>
              {active && (
                <Button variant="primary" disabled={busy} onClick={() => void inspect(active.id)}>
                  Review migration {active.version}
                  <ArrowRight size={15} aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          <section className="migration-history" aria-label="Migration history">
            <header>
              <h3>
                <History size={16} aria-hidden="true" />
                Deployment history
              </h3>
              <span>
                {releases.length} {releases.length === 1 ? 'release' : 'releases'}
              </span>
            </header>
            {historyError ? (
              <ErrorNotice
                message={historyError}
                retry={() => setHistoryAttempt((value) => value + 1)}
              />
            ) : !history ? (
              <Loading label="Loading deployment history…" />
            ) : releases.length ? (
              <>
                <ol className="migration-history-list">
                  {(showAll ? releases : releases.slice(0, 3)).map((item) => {
                    const base = history.find((old) => old.version === item.baseVersion);
                    return (
                      <li key={item.id}>
                        <button
                          className="migration-history-row"
                          onClick={() => openHistory(item)}
                          disabled={busy}
                          aria-label={`View migration ${item.version} diff`}
                        >
                          <span className="migration-history-version">{item.version}</span>
                          <span className="migration-history-title">
                            <span>
                              <strong>{item.name}</strong>
                              {item.version === deployed?.version && (
                                <span className="migration-current-tag">Current</span>
                              )}
                              {item.destructive && (
                                <span className="migration-destructive-tag">Destructive</span>
                              )}
                            </span>
                            <small>
                              Migration {item.version}
                              <span aria-hidden="true"> · </span>
                              <time dateTime={item.deployedAt ?? undefined}>
                                {deployedDate(item.deployedAt)}
                              </time>
                            </small>
                          </span>
                          {base && (
                            <MigrationChangeCount
                              changes={migrationChanges(base.definitions, item.definitions)}
                            />
                          )}
                          <span className="migration-history-action">
                            View diff
                            <ChevronRight size={15} aria-hidden="true" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {releases.length > 3 && (
                  <Button
                    variant="ghost"
                    className="migration-history-more"
                    onClick={() => setShowAll((value) => !value)}
                  >
                    {showAll ? 'Show recent releases' : `Show all ${releases.length} releases`}
                  </Button>
                )}
              </>
            ) : (
              <div className="migration-history-empty">
                <Clock3 size={22} aria-hidden="true" />
                <div>
                  <strong>No deployments yet</strong>
                  <p>Deployed migrations and their diffs will appear here.</p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
      <MigrationReviewDialog
        review={review}
        busy={busy}
        error={error}
        canDeploy={canDeploy}
        onClose={() => {
          if (!busy) closeReview();
        }}
        onInspect={(destructive) => {
          if (review) void inspect(review.migration.id, destructive);
        }}
        onDeploy={(confirmation) => {
          if (review)
            void action(async () => {
              await api(
                `/migrations/${review.migration.id}/deploy`,
                jsonRequest('POST', {
                  reviewToken: review.token,
                  destructive: review.destructive,
                  confirmation,
                }),
              );
              closeReview();
              await load();
              await onDeploy();
            });
        }}
      />
      {past && (
        <MigrationHistoryDialog
          key={past.id}
          migration={past}
          base={history?.find((item) => item.version === past.baseVersion)}
          people={people}
          onClose={closeReview}
        />
      )}
      {canDeploy && (
        <Modal
          open={tokensOpen}
          title="CLI & CI access"
          description="Manage space-scoped tokens for schema tooling and deployments."
          onClose={() => {
            if (!busy) setTokensOpen(false);
          }}
        >
          <div className="migration-token-content">
            <ErrorNotice message={error} />
            <p className="field-hint">
              Set <code>STORYPANE_MANAGEMENT_TOKEN</code> in your terminal or CI secrets.
            </p>
            {secret && (
              <label className="field">
                Copy this token now
                <input
                  readOnly
                  aria-label="New management token"
                  value={secret}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            )}
            <form
              className="migration-token-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  const result = await api<ManagementToken & { token: string }>(
                    '/management-tokens',
                    jsonRequest('POST', { name, capability }),
                  );
                  setSecret(result.token);
                  setTokens((items) => [...(items ?? []), result]);
                  setName('');
                });
              }}
            >
              <label className="field">
                Token name
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Local development"
                />
              </label>
              <label className="field">
                Access
                <select
                  value={capability}
                  onChange={(event) =>
                    setCapability(event.target.value as ManagementToken['capability'])
                  }
                >
                  <option value="read">Read migrations</option>
                  <option value="stage">Read and stage</option>
                  <option value="deploy">Read, stage, and deploy</option>
                </select>
              </label>
              <Button type="submit" disabled={busy || !name.trim()}>
                Create management token
              </Button>
            </form>
            {!tokens ? (
              <Loading label="Loading tokens…" />
            ) : tokens.length ? (
              <ul className="migration-token-list">
                {tokens.map((token) => (
                  <li key={token.id}>
                    <KeyRound size={16} aria-hidden="true" />
                    <span>
                      <strong>{token.name}</strong>
                      <small>
                        {token.capability === 'read'
                          ? 'Read migrations'
                          : token.capability === 'stage'
                            ? 'Read and stage'
                            : 'Read, stage, and deploy'}
                      </small>
                    </span>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Revoke “${token.name}”?`))
                          void action(async () => {
                            await api(`/management-tokens/${token.id}`, { method: 'DELETE' });
                            setTokens(
                              (items) => items?.filter((item) => item.id !== token.id) ?? [],
                            );
                            setSecret('');
                          });
                      }}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">No access tokens yet.</p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
