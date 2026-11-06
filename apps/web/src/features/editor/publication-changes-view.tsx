import { useMemo } from 'react';
import { ChevronRight, FileDiff } from 'lucide-react';
import type { BlockDraft, Json, LocaleSnapshot, PublicationReview } from '@storypane/core';
import { blockSummary, blockTitle, definitionFor } from './block-navigation';
import { publicationChanges } from './publication-changes';

function location(snapshot: LocaleSnapshot, block: BlockDraft) {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: BlockDraft | undefined = block;
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = snapshot.blocks.find((item) => item.id === current!.parentId);
    if (!parent) break;
    const field = definitionFor(snapshot, parent)?.fields.find(
      (item) => item.name === current!.parentField,
    );
    const position =
      snapshot.blocks
        .filter(
          (item) =>
            item.parentId === current!.parentId && item.parentField === current!.parentField,
        )
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .findIndex((item) => item.id === current!.id) + 1;
    path.unshift(
      `${blockTitle(snapshot, parent)} / ${field?.label ?? current.parentField} ${position}`,
    );
    current = parent;
  }
  return path.join(' › ') || 'Page content';
}

function valueLabel(value: Json | undefined) {
  if (value === undefined || value === null || value === '') return 'Empty';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

const labels = { added: 'Added', updated: 'Edited', moved: 'Moved', removed: 'Removed' };

export function PublicationChangesView({ review }: { review: PublicationReview }) {
  const { snapshot, publishedSnapshot: live } = review;
  const changes = useMemo(() => publicationChanges(snapshot, live), [snapshot, live]);
  const unchanged =
    snapshot.blocks.length - changes.filter((item) => item.kind !== 'removed').length;
  const list = (
    <div className="publication-change-list">
      {changes.map((change) => {
        const source = change.kind === 'removed' ? live! : snapshot;
        const definition = definitionFor(source, change.block);
        const summary = blockSummary(change.block);
        return (
          <details className="publication-change" key={change.block.id}>
            <summary>
              <ChevronRight className="publication-change-chevron" size={16} aria-hidden="true" />
              <span className="publication-change-heading">
                <strong>
                  {blockTitle(source, change.block)}
                  {summary && <span> · {summary}</span>}
                </strong>
                <small>{location(source, change.block)}</small>
                {change.kind === 'updated' && (
                  <small className="publication-change-fields">
                    {change.fields
                      .map(
                        (name) =>
                          definition?.fields.find((field) => field.name === name)?.label ?? name,
                      )
                      .join(', ')}
                    {change.moved && ' · Position changed'}
                  </small>
                )}
              </span>
              <span className={`publication-change-kind publication-change-kind--${change.kind}`}>
                {labels[change.kind]}
              </span>
            </summary>
            <div className="publication-change-detail">
              {change.kind === 'removed' && (
                <p className="small muted">
                  This component and its content will be removed from the live page.
                </p>
              )}
              {change.moved && change.before && (
                <p className="small muted">
                  Moved from {location(live!, change.before)} to {location(snapshot, change.block)}.
                </p>
              )}
              {change.fields.map((name) => (
                <div className="publication-field-change" key={name}>
                  <h4>{definition?.fields.find((field) => field.name === name)?.label ?? name}</h4>
                  <div className="publication-field-values">
                    {change.kind !== 'added' && (
                      <div>
                        <span>Live</span>
                        <pre>{valueLabel(change.before?.fields[name])}</pre>
                      </div>
                    )}
                    {change.kind !== 'removed' && (
                      <div>
                        <span>To publish</span>
                        <pre>{valueLabel(change.block.fields[name])}</pre>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
  return (
    <section className="publication-changes" aria-label="Changes to publish">
      <div className="publication-changes-heading">
        <FileDiff size={19} aria-hidden="true" />
        <div>
          <h3>
            {!live
              ? 'No live version to compare'
              : changes.length
                ? `${changes.length} component${changes.length === 1 ? '' : 's'} changed`
                : 'Content matches the live version'}
          </h3>
          <p>
            {!live
              ? `All ${snapshot.blocks.length} components will be published.`
              : `${unchanged} unchanged component${unchanged === 1 ? '' : 's'} hidden. Compared with the live page when this review opened.`}
          </p>
        </div>
      </div>
      {!live ? (
        <details className="publication-first-publish">
          <summary>View {changes.length} components</summary>
          {list}
        </details>
      ) : (
        list
      )}
    </section>
  );
}
