'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Button, EmptyState, ErrorNotice, Loading, Modal } from '@storypane/ui';
import type { LocaleSnapshot, LocaleSourceInput, LocaleSourceReview, Json } from '@storypane/core';
import { api, errorMessage } from './api';
import { blockTitle, blockSummary } from './block-navigation';
import './locale-source.css';

const valueText = (value: Json) =>
  typeof value === 'string'
    ? value || 'Empty'
    : value === null
      ? 'Empty'
      : JSON.stringify(value, null, 2);
export function LocaleSourceDialog({
  snapshot,
  blockId,
  sourceName,
  onClose,
  prepare,
  apply,
}: {
  snapshot: LocaleSnapshot;
  blockId?: string;
  sourceName: string;
  onClose: () => void;
  prepare: () => Promise<void>;
  apply: (input: LocaleSourceInput) => Promise<unknown>;
}) {
  const [review, setReview] = useState<LocaleSourceReview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, 'apply' | 'keep' | ''>>({});
  const [copyIds, setCopyIds] = useState<string[]>([]),
    [copyRoot, setCopyRoot] = useState(true);
  const [pairs, setPairs] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState('');
  const empty = snapshot.blocks.length === 1;
  const base = `/stories/${snapshot.story.id}/locales/${snapshot.locale.id}/locale-source`;
  const query = blockId ? `?blockId=${encodeURIComponent(blockId)}` : '';
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await prepareRef.current();
      const next = await api<LocaleSourceReview>(base + query);
      setReview(next);
      setDecisions(
        Object.fromEntries(next.changes.map((c) => [c.id, c.safe && !c.blocked ? 'apply' : ''])),
      );
      setCopyIds(
        next.source.blocks
          .filter((b) => b.parentId === next.source.locale.rootBlockId)
          .map((b) => b.id),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [base, query]);
  useEffect(() => {
    void load();
  }, [load]);
  async function submit(input: LocaleSourceInput) {
    setBusy(true);
    setError('');
    try {
      await apply(input);
      setNotice(
        input.action === 'copy'
          ? 'Content copied. Translate and review it before publishing.'
          : input.action === 'link'
            ? 'Source relationship saved. Your local content has not changed.'
            : 'Choices saved to this locale’s draft.',
      );
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const rootId = snapshot.locale.rootBlockId;
  const linkedScope = !blockId || Object.values(review?.mappings ?? {}).includes(blockId);
  const title =
    review && !review.linked
      ? empty
        ? `Create from ${sourceName}`
        : `Link to ${sourceName}`
      : blockId
        ? `Updates to ${blockTitle(
            snapshot,
            snapshot.blocks.find((b) => b.id === blockId)!,
          )}`
        : `Updates from ${sourceName}`;
  const chosen = Object.entries(decisions).filter(([, action]) => !!action);
  const updates = chosen.filter(([, action]) => action === 'apply').length;
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={title}
      description={
        review && !review.linked
          ? 'Independent locale content, with a remembered source for future updates.'
          : `${snapshot.locale.name} keeps its own content and publishing. Only the changes you choose will be applied.`
      }
      wide
    >
      <div className="locale-source-dialog" aria-busy={busy}>
        <ErrorNotice message={error} />
        {notice && (
          <p className="notice" role="status">
            <Check size={16} aria-hidden="true" /> {notice}
          </p>
        )}
        {!review ? (
          busy ? (
            <Loading label="Checking source changes…" />
          ) : (
            <Button onClick={() => void load()}>Try again</Button>
          )
        ) : !review.linked ? (
          <>
            {blockId && (
              <p className="notice">
                First link this page to {sourceName}. Linking is a one-time page setup; later checks
                stay within the selected block.
              </p>
            )}
            {empty ? (
              <>
                <p>
                  Start with the whole page, including its nested blocks. Deselect any sections you
                  do not need. Your locale URL and publication state stay unchanged.
                </p>
                <label className="locale-source-option">
                  <input
                    type="checkbox"
                    checked={copyRoot}
                    disabled={busy}
                    onChange={(e) => setCopyRoot(e.target.checked)}
                  />
                  <span>
                    <strong>Page fields and metadata</strong>
                    <small>Replace this locale’s page fields with the source values.</small>
                  </span>
                </label>
                <div className="locale-source-summary">
                  <span>{copyIds.length} sections selected</span>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setCopyIds(
                        review.source.blocks
                          .filter((b) => b.parentId === review.source.locale.rootBlockId)
                          .map((b) => b.id),
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setCopyIds([])}>
                    Clear selection
                  </Button>
                </div>
                <div className="locale-source-list">
                  {review.source.blocks
                    .filter((b) => b.parentId === review.source.locale.rootBlockId)
                    .sort((a, b) => a.position - b.position)
                    .map((b) => (
                      <label className="locale-source-option" key={b.id}>
                        <input
                          type="checkbox"
                          checked={copyIds.includes(b.id)}
                          disabled={busy}
                          onChange={(e) =>
                            setCopyIds((ids) =>
                              e.target.checked ? [...ids, b.id] : ids.filter((id) => id !== b.id),
                            )
                          }
                        />
                        <span>
                          <strong>{blockTitle(review.source, b)}</strong>
                          <small>
                            {blockSummary(b) || 'Includes nested content'} · needs translation
                          </small>
                        </span>
                      </label>
                    ))}
                </div>
                <div className="dialog-actions">
                  <Button disabled={busy} onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || (!copyIds.length && !copyRoot)}
                    onClick={() =>
                      void submit({
                        action: 'copy',
                        token: review.token,
                        blockIds: copyIds,
                        copyRoot,
                      })
                    }
                  >
                    Create from {sourceName}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>
                  This page was created before source tracking. Match corresponding sections below;
                  nested blocks are paired only when their structure matches. Unmatched sections
                  stay independent.
                </p>
                <p className="notice">
                  No content will be changed. The current {sourceName} version becomes your starting
                  point; earlier changes cannot be reconstructed. Page fields are linked
                  automatically.
                </p>
                <div className="locale-source-list">
                  {review.source.blocks
                    .filter((b) => b.parentId === review.source.locale.rootBlockId)
                    .sort((a, b) => a.position - b.position)
                    .map((b) => (
                      <div className="locale-source-pair" key={b.id}>
                        <label htmlFor={`pair-${b.id}`}>
                          <strong>{blockTitle(review.source, b)}</strong>
                          <small>{blockSummary(b) || 'Source section'}</small>
                        </label>
                        <select
                          id={`pair-${b.id}`}
                          value={pairs[b.id] ?? ''}
                          disabled={busy}
                          onChange={(e) => setPairs((p) => ({ ...p, [b.id]: e.target.value }))}
                        >
                          <option value="">Leave unlinked</option>
                          {snapshot.blocks
                            .filter(
                              (t) => t.parentId === rootId && t.definitionId === b.definitionId,
                            )
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {blockTitle(snapshot, t)}
                                {blockSummary(t) ? ` · ${blockSummary(t)}` : ''}
                              </option>
                            ))}
                        </select>
                      </div>
                    ))}
                </div>
                <div className="dialog-actions">
                  <Button disabled={busy} onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void submit({
                        action: 'link',
                        token: review.token,
                        pairs: Object.entries(pairs)
                          .filter(([, id]) => id)
                          .map(([sourceId, targetId]) => ({ sourceId, targetId })),
                      })
                    }
                  >
                    Confirm source links
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="locale-source-summary">
              <span>
                <strong>{review.changes.length}</strong>{' '}
                {review.changes.length === 1 ? 'source change' : 'source changes'} to review
              </span>
              <div className="button-group">
                <Button
                  variant="ghost"
                  disabled={busy || !review.changes.some((c) => c.safe && !c.blocked)}
                  onClick={() =>
                    setDecisions(
                      Object.fromEntries(
                        review.changes.map((c) => [c.id, c.safe && !c.blocked ? 'apply' : '']),
                      ),
                    )
                  }
                >
                  Select all safe updates
                </Button>
                <Button
                  variant="ghost"
                  className="icon-button"
                  aria-label="Refresh source updates"
                  title="Refresh source updates"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              </div>
            </div>
            {!review.changes.length && (
              <EmptyState
                title={
                  linkedScope
                    ? `${blockId ? 'This block' : snapshot.locale.name} is up to date with ${sourceName}`
                    : 'This block is local to this locale'
                }
              >
                {linkedScope
                  ? 'Your translations and local edits are preserved.'
                  : 'It has no corresponding source block. Check updates from the page toolbar to review linked sections.'}
              </EmptyState>
            )}
            <div className="locale-source-list">
              {review.changes.map((c) => (
                <article className="locale-source-change" key={c.id}>
                  <header>
                    <div>
                      <span className={`locale-source-status ${c.safe ? 'is-safe' : ''}`}>
                        {c.kind === 'add'
                          ? 'New section'
                          : c.kind === 'remove'
                            ? 'Removed in source'
                            : c.kind === 'move'
                              ? 'Section moved'
                              : c.kind === 'order'
                                ? 'Layout change'
                                : c.safe
                                  ? 'Safe update'
                                  : 'Translation needs review'}
                      </span>
                      <h3>{c.title}</h3>
                      <p>{c.blocked ?? c.detail}</p>
                    </div>
                    <select
                      aria-label={`Decision for ${c.title} (${c.kind})`}
                      disabled={busy}
                      value={decisions[c.id] ?? ''}
                      onChange={(e) =>
                        setDecisions((d) => ({
                          ...d,
                          [c.id]: e.target.value as 'apply' | 'keep' | '',
                        }))
                      }
                    >
                      <option value="">Decide later</option>
                      <option value="apply" disabled={!!c.blocked}>
                        {c.kind === 'remove'
                          ? 'Remove localized section'
                          : c.kind === 'content' && !c.safe
                            ? 'Replace changed fields'
                            : 'Apply update'}
                      </option>
                      <option value="keep">Keep {snapshot.locale.name} version</option>
                    </select>
                  </header>
                  {c.fields && c.fields.length > 0 && (
                    <details>
                      <summary>
                        Compare {c.fields.length} changed{' '}
                        {c.fields.length === 1 ? 'field' : 'fields'}
                      </summary>
                      {c.fields.map((f) => (
                        <section className="locale-source-field" key={f.name}>
                          <h4>
                            {f.label}
                            {f.conflict ? ' · localized value differs' : ''}
                          </h4>
                          <div className="locale-source-comparison">
                            <div>
                              <span>Previous source</span>
                              <pre>{valueText(f.before)}</pre>
                            </div>
                            <div>
                              <span>Current {sourceName}</span>
                              <pre>{valueText(f.source)}</pre>
                            </div>
                            <div>
                              <span>Current {snapshot.locale.name}</span>
                              <pre>{valueText(f.local)}</pre>
                            </div>
                          </div>
                        </section>
                      ))}
                    </details>
                  )}
                </article>
              ))}
            </div>
            {review.needsTranslation.length > 0 && (
              <details className="locale-source-translation">
                <summary>
                  {review.needsTranslation.length} copied{' '}
                  {review.needsTranslation.length === 1 ? 'block needs' : 'blocks need'} translation
                  review
                </summary>
                <p>
                  Copied content remains a draft. Mark each block reviewed when its localized
                  content is ready.
                </p>
                {review.needsTranslation.map((item) => (
                  <div key={item.id}>
                    <span>{item.title}</span>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void submit({
                          action: 'update',
                          token: review.token,
                          blockId,
                          decisions: [],
                          reviewedIds: [item.id],
                        })
                      }
                    >
                      Mark reviewed
                    </Button>
                  </div>
                ))}
              </details>
            )}
            <div className="dialog-actions">
              <Button disabled={busy} onClick={onClose}>
                Done
              </Button>
              <Button
                variant="primary"
                disabled={busy || !chosen.length}
                onClick={() =>
                  void submit({
                    action: 'update',
                    token: review.token,
                    blockId,
                    decisions: chosen.map(([id, action]) => ({
                      id,
                      action: action as 'apply' | 'keep',
                    })),
                    reviewedIds: [],
                  })
                }
              >
                {busy
                  ? 'Saving…'
                  : updates
                    ? `Apply ${updates} ${updates === 1 ? 'update' : 'updates'}`
                    : 'Save review choices'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
