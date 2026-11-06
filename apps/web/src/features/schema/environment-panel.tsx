'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SchemaStatus, SchemaTransferReview, SchemaResolutions } from '@storypane/core';
import { Button, ErrorNotice, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';

export function DependencySummary({ review }: { review: SchemaTransferReview }) {
  return (
    <div>
      <p>
        Required dependencies: {review.dependencies.stories.length} stories,{' '}
        {review.dependencies.assets.length} media files, {review.dependencies.datasources.length}{' '}
        datasources. Copied stories remain unpublished.
      </p>
      {[
        ...review.dependencies.stories.map((s) => `Story: ${s.name}`),
        ...review.dependencies.assets.map(
          (a) => `Media: ${a.filename} (${a.byteSize.toLocaleString()} bytes)`,
        ),
        ...review.dependencies.datasources.map((d) => `Datasource: ${d.name}`),
      ].map((label) => (
        <p className="small" key={label}>
          {label}
        </p>
      ))}
    </div>
  );
}
export function EnvironmentPanel({
  canDeploy,
  onApply,
}: {
  canDeploy: boolean;
  onApply: () => Promise<void>;
}) {
  const [status, setStatus] = useState<SchemaStatus | null>(null);
  const [review, setReview] = useState<SchemaTransferReview | null>(null);
  const [resolutions, setResolutions] = useState<SchemaResolutions>({});
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    setStatus(await api<SchemaStatus>('/migrations/environment'));
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void load().catch((e) => setError(errorMessage(e)));
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  async function inspect(
    action: 'sync' | 'promote',
    id = crypto.randomUUID(),
    choices: SchemaResolutions = {},
  ) {
    setBusy(true);
    setError('');
    setConfirmation('');
    try {
      setReview(
        await api<SchemaTransferReview>(
          '/migrations/transfer-review',
          jsonRequest('POST', { id, action, resolutions: choices }),
        ),
      );
      setResolutions(choices);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const blockers = review?.steps.flatMap((s) => s.blockers) ?? [];
  return (
    <section className="panel" aria-label="Space environment">
      <div className="panel-body">
        <ErrorNotice message={error} />
        {status && (
          <>
            <strong>
              {status.environment === 'prod' ? 'Production' : 'Development'}
              {status.schemaReadOnly ? ' · Schema read-only' : ''}
            </strong>
            {status.production && (
              <p>
                <a href={`/?space=${status.production.id}&view=blocks`}>{status.production.name}</a>{' '}
                · v{status.production.version} ·{' '}
                {status.behind ? 'Behind production' : 'Up to date'} · {status.pending.length}{' '}
                pending migrations
              </p>
            )}
            {canDeploy && status.production && (
              <div className="dialog-actions">
                <Button disabled={busy || !status.behind} onClick={() => void inspect('sync')}>
                  Sync from production
                </Button>
                <Button
                  disabled={busy || status.behind || !status.pending.length}
                  onClick={() => void inspect('promote')}
                >
                  Promote to production
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Modal
        open={!!review}
        onClose={() => {
          if (!busy) setReview(null);
        }}
        title={review?.action === 'sync' ? 'Sync from production' : 'Promote to production'}
      >
        {review && (
          <>
            <DependencySummary review={review} />
            {review.conflicts.map((conflict) => (
              <fieldset key={conflict.path} disabled={busy}>
                <legend>{conflict.path}</legend>
                <details>
                  <summary>Compare changes</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {JSON.stringify(
                      { baseline: conflict.base, dev: conflict.dev, production: conflict.prod },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <label className="field">
                  Resolution
                  <select
                    value={resolutions[conflict.path] ?? ''}
                    onChange={(e) =>
                      setResolutions({
                        ...resolutions,
                        [conflict.path]: e.target.value as 'dev' | 'prod',
                      })
                    }
                  >
                    <option value="" disabled>
                      Choose a version
                    </option>
                    <option value="dev">Keep dev change</option>
                    <option value="prod">Keep production change</option>
                  </select>
                </label>
              </fieldset>
            ))}
            {review.steps.map((step) => (
              <section key={step.id}>
                <h3>{step.name}</h3>
                {step.changes.map((change, i) => (
                  <p key={i}>
                    {change.kind}: {change.definition}
                    {change.field ? ` / ${change.field}` : ''}
                  </p>
                ))}
                {step.impacts
                  .filter((i) => i.deletedValues + i.resetValues + i.deletedBlocks)
                  .map((i) => (
                    <p key={`${i.localeId}:${i.target}`}>
                      {i.name} / {i.locale} ({i.target}): {i.deletedValues} deleted values,{' '}
                      {i.resetValues} reset values, {i.deletedBlocks} deleted blocks.
                    </p>
                  ))}
              </section>
            ))}
            {blockers.map((b, i) => (
              <p className="notice" key={i}>
                {b.path}: {b.message}
              </p>
            ))}
            {review.confirmation && (
              <label className="field">
                Type {review.confirmation} to accept data loss
                <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
              </label>
            )}
            <ErrorNotice message={error} />
            <div className="dialog-actions">
              <Button disabled={busy} onClick={() => setReview(null)}>
                Cancel
              </Button>
              {review.conflicts.length ? (
                <Button
                  disabled={busy || review.conflicts.some((c) => !resolutions[c.path])}
                  onClick={() =>
                    void inspect(review.action as 'sync' | 'promote', review.id, resolutions)
                  }
                >
                  Review resolved changes
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={
                    busy ||
                    !!blockers.length ||
                    (!!review.confirmation && confirmation !== review.confirmation)
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await api(
                        '/migrations/transfer-apply',
                        jsonRequest('POST', {
                          id: review.id,
                          action: review.action,
                          resolutions,
                          reviewToken: review.token,
                          ...(confirmation ? { confirmation } : {}),
                        }),
                      );
                      setReview(null);
                      await load();
                      await onApply();
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? 'Applying…' : 'Apply reviewed changes'}
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
