'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SchemaStatus, SchemaTransferReview, SchemaResolutions } from '@storypane/core';
import { Button, ErrorNotice, Modal } from '@storypane/ui';
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  LockKeyhole,
} from 'lucide-react';
import { EnvironmentBadge } from '../../components/environment-badge';
import { api, errorMessage, jsonRequest } from '../editor/api';

export function DependencySummary({ review }: { review: SchemaTransferReview }) {
  return (
    <div className="dependency-summary">
      <p>
        Required dependencies: {review.dependencies.stories.length} stories,{' '}
        {review.dependencies.assets.length} media files, {review.dependencies.datasources.length}{' '}
        datasources. Copied stories remain unpublished.
      </p>
      {!!(
        review.dependencies.stories.length +
        review.dependencies.assets.length +
        review.dependencies.datasources.length
      ) && (
        <details>
          <summary>View items to copy</summary>
          <ul>
            {[
              ...review.dependencies.stories.map((s) => ({ id: s.id, label: `Story: ${s.name}` })),
              ...review.dependencies.assets.map((a) => ({
                id: a.id,
                label: `Media: ${a.filename} (${a.byteSize.toLocaleString()} bytes)`,
              })),
              ...review.dependencies.datasources.map((d) => ({
                id: d.id,
                label: `Datasource: ${d.name}`,
              })),
            ].map(({ id, label }) => (
              <li key={id}>{label}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
export function EnvironmentPanel({
  canDeploy,
  onApply,
  spaceName,
}: {
  canDeploy: boolean;
  onApply: () => Promise<void>;
  spaceName: string;
}) {
  const [status, setStatus] = useState<SchemaStatus | null>(null);
  const [review, setReview] = useState<SchemaTransferReview | null>(null);
  const [resolutions, setResolutions] = useState<SchemaResolutions>({});
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
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
  const readyToPromote = !!status?.production && !status.behind && status.pending.length > 0;
  return (
    <section
      className="panel environment-panel"
      aria-label="Space environment"
      data-environment={status?.environment ?? 'prod'}
    >
      <div className="panel-body">
        <ErrorNotice message={error} />
        {notice && <p role="status">{notice}</p>}
        {!status && !error && <p>Loading environment…</p>}
        {status && (
          <>
            <div className="environment-panel-heading">
              <div className="environment-actions">
                <EnvironmentBadge environment={status.environment} />
                {status.schemaReadOnly && (
                  <span className="environment-state">
                    <LockKeyhole aria-hidden="true" /> Schema read-only
                  </span>
                )}
              </div>
              {status.production && (
                <span className="environment-state" data-behind={status.behind}>
                  <span aria-hidden="true">{status.behind ? <Clock3 /> : <CheckCircle2 />}</span>
                  {status.behind ? 'Behind production' : 'Up to date'}
                </span>
              )}
            </div>
            <h2>
              {status.environment === 'prod'
                ? status.schemaReadOnly
                  ? 'Protected production schema'
                  : 'Production schema'
                : status.production
                  ? status.behind
                    ? 'Bring this space up to date'
                    : readyToPromote
                      ? 'Ready for production review'
                      : 'Develop and test your schema'
                  : 'Your development workspace'}
            </h2>
            {status.production && (
              <p>
                Linked to <strong>{status.production.name}</strong> · Production v
                {status.production.version} · {status.pending.length}{' '}
                {status.pending.length === 1 ? 'migration' : 'migrations'} to promote.{' '}
                {status.behind
                  ? 'Sync first to review incoming changes and resolve conflicts.'
                  : readyToPromote
                    ? 'Review the impact on production content before applying.'
                    : 'Deploy a migration here, test it, then promote it.'}
              </p>
            )}
            {!status.production && (
              <p>
                {status.environment === 'prod'
                  ? status.schemaReadOnly
                    ? 'Make schema changes in a linked development space, then review and promote them here. Your content remains editable.'
                    : 'Direct schema editing is enabled. Enable Schema read-only in Settings to require reviewed promotions.'
                  : 'To link production, create a production space using this space as its base.'}
              </p>
            )}
            {canDeploy && status.production && (
              <div className="environment-actions">
                <Button
                  variant={status.behind ? 'primary' : undefined}
                  disabled={busy || !status.behind}
                  onClick={() => void inspect('sync')}
                >
                  <ArrowDownToLine aria-hidden="true" />
                  Sync from production
                </Button>
                <Button
                  variant={readyToPromote ? 'primary' : undefined}
                  disabled={busy || status.behind || !status.pending.length}
                  onClick={() => void inspect('promote')}
                >
                  <ArrowUpRight aria-hidden="true" /> Review promotion
                </Button>
              </div>
            )}
            {busy && !review && <p role="status">Reviewing schema and content changes…</p>}
          </>
        )}
      </div>
      <Modal
        open={!!review}
        onClose={() => {
          if (!busy) setReview(null);
        }}
        title={review?.action === 'sync' ? 'Sync from production' : 'Promote to production'}
        description={
          review?.action === 'sync'
            ? 'Review incoming changes and how they combine with your development work.'
            : 'Review every migration before applying this batch to production.'
        }
      >
        {review && (
          <>
            <div className="environment-route">
              <EnvironmentBadge environment={review.action === 'sync' ? 'prod' : 'dev'} />
              <strong>{review.action === 'sync' ? status?.production?.name : spaceName}</strong>
              <ArrowRight aria-label="to" />
              <EnvironmentBadge environment={review.action === 'sync' ? 'dev' : 'prod'} />
              <strong>{review.action === 'sync' ? spaceName : status?.production?.name}</strong>
            </div>
            <DependencySummary review={review} />
            {review.conflicts.map((conflict, index) => (
              <fieldset className="transfer-conflict" key={conflict.path} disabled={busy}>
                <legend>Conflict {index + 1} · Choose which change to keep</legend>
                {conflict.path.endsWith('blocks.structure') && (
                  <p>
                    The combined changes have incompatible nesting or references. Choose the
                    complete dev or production schema for this step.
                  </p>
                )}
                <details>
                  <summary>Compare changes</summary>
                  <code>{conflict.path}</code>
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
            {review.steps.map((step, index) => (
              <section className="transfer-step" key={step.id}>
                <h3>
                  <span>
                    {index + 1} / {review.steps.length}
                  </span>
                  {step.name}
                </h3>
                <ul>
                  {step.changes.map((change, i) => (
                    <li key={i}>
                      {change.kind}: {change.definition}
                      {change.field ? ` / ${change.field}` : ''}
                    </li>
                  ))}
                </ul>
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
              <label className="field transfer-confirmation">
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
                      setNotice(
                        review.action === 'sync'
                          ? 'Development space synced with production.'
                          : `Migrations applied to ${status?.production?.name ?? 'production'}.`,
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
