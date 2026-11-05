'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, FileText } from 'lucide-react';
import type { DefinitionReferencesPage } from '@storypane/core';
import { Button, EmptyState, ErrorNotice, Loading } from '@storypane/ui';
import { api, errorMessage } from '../editor/api';
import { selectedSpaceId, storyUrl } from '../../lib/space-url';

export function DefinitionReferences({
  definitionId,
  active,
  onCount,
}: {
  definitionId?: string;
  active: boolean;
  onCount: (count: number | '…' | '—') => void;
}) {
  const [page, setPage] = useState<DefinitionReferencesPage | null>(null);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!definitionId) {
      onCount(0);
      return;
    }
    let stopped = false,
      pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setBusy(true);
      try {
        const result = await api<DefinitionReferencesPage>(
          `/definitions/${definitionId}/references?cursor=${cursor}`,
        );
        if (stopped) return;
        setPage(result);
        onCount(result.total);
        setError(null);
      } catch (cause) {
        if (!stopped) {
          setError(errorMessage(cause));
          onCount('—');
        }
      } finally {
        pending = false;
        if (!stopped) setBusy(false);
      }
    }
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [definitionId, cursor, active, attempt, onCount]);
  function navigate(next: number) {
    setPage(null);
    setCursor(next);
  }
  return (
    <section className="definition-references" aria-label="Block references" aria-busy={busy}>
      <p className="field-hint">
        Stories containing this block in current drafts or published content. Each story is counted
        once. Links open in a new tab.
      </p>
      <ErrorNotice message={error} retry={() => setAttempt((value) => value + 1)} />
      {!definitionId ? (
        <EmptyState title="No references yet">
          Save and deploy this block to start using it in stories.
        </EmptyState>
      ) : !page ? (
        !error && <Loading label="Loading references…" />
      ) : !page.total ? (
        <EmptyState title="No references yet">
          No stories you can access currently use this block.
        </EmptyState>
      ) : (
        <>
          <ul className="definition-reference-list">
            {page.items.map((item) => (
              <li key={item.storyId}>
                <h3>
                  <FileText aria-hidden="true" />
                  {item.storyName}
                </h3>
                {item.locales.map((locale) => (
                  <a
                    key={locale.localeId}
                    href={storyUrl({
                      spaceId: selectedSpaceId() ?? '',
                      storyId: item.storyId,
                      localeSlug: locale.localeSlug,
                      blockId: locale.blockId ?? undefined,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${item.storyName} · ${locale.localeName} in a new tab`}
                  >
                    <span className="definition-reference-locale">
                      <strong>{locale.localeName}</strong>
                      <small className="mono">
                        /{[locale.localeSlug, locale.path].filter(Boolean).join('/')}
                      </small>
                    </span>
                    <span className={`pill ${locale.published ? 'pill--green' : 'pill--blue'}`}>
                      {locale.published
                        ? locale.draft
                          ? 'Draft & published'
                          : 'Published only'
                        : 'Draft'}
                    </span>
                    <ExternalLink aria-hidden="true" />
                  </a>
                ))}
              </li>
            ))}
          </ul>
          {!page.items.length && (
            <p>No stories on this page. Go back to see the remaining references.</p>
          )}
          {(cursor > 0 || page.nextCursor) && (
            <div className="definition-reference-pagination">
              <Button
                variant="ghost"
                disabled={busy || !cursor}
                onClick={() => navigate(Math.max(0, cursor - 20))}
              >
                <ArrowLeft />
                Previous
              </Button>
              <span className="small muted">
                {page.items.length
                  ? `${cursor + 1}–${cursor + page.items.length} of ${page.total}`
                  : `${page.total} stories`}
              </span>
              <Button
                variant="ghost"
                disabled={busy || !page.nextCursor}
                onClick={() => navigate(Number(page.nextCursor))}
              >
                Next
                <ArrowRight />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
