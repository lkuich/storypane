'use client';

import { useEffect, useState } from 'react';
import type { AssetUsagePage } from '@storypane/core';
import { assetApi } from './api';
import { selectedSpaceId } from '../../lib/space-url';

export function AssetUsage({ assetId }: { assetId: string }) {
  const [page, setPage] = useState<AssetUsagePage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    assetApi<AssetUsagePage>(`/${assetId}/usage`)
      .then((value) => {
        if (active) setPage(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load usage');
      });
    return () => {
      active = false;
    };
  }, [assetId, attempt]);
  async function more() {
    if (!page?.nextCursor || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await assetApi<AssetUsagePage>(
        `/${assetId}/usage?cursor=${encodeURIComponent(page.nextCursor)}`,
      );
      setPage({ items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load usage');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="asset-usage" aria-label="Asset usage">
      <p className="field-hint">
        Current drafts and publications that use this asset. Historical versions are excluded.
      </p>
      {error && (
        <p className="asset-error" role="alert">
          {error}
          {!page && (
            <button
              className="button secondary"
              onClick={() => {
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              Retry loading usage
            </button>
          )}
        </p>
      )}
      {!page && !error && <p role="status">Loading usage…</p>}
      {page && !page.items.length && <p>No usage in content you can access.</p>}
      <ul>
        {page?.items.map((item) => {
          const params = new URLSearchParams({
            space: selectedSpaceId() ?? '',
            story: item.storyId,
            locale: item.localeSlug,
            block: item.blockId,
          });
          return (
            <li key={`${item.localeId}:${item.blockId}:${item.fieldName}:${item.state}`}>
              <a href={`/?${params}`}>
                <strong>{item.storyName}</strong>
                <span>
                  {item.localeName} · {item.blockName} · {item.fieldLabel}
                </span>
              </a>
              <span className="pill">{item.state === 'published' ? 'Published' : 'Draft'}</span>
            </li>
          );
        })}
      </ul>
      {page?.nextCursor && (
        <button className="button secondary" disabled={busy} onClick={() => void more()}>
          {busy ? 'Loading…' : 'Load more usage'}
        </button>
      )}
    </section>
  );
}
