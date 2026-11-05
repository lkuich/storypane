'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Monitor, RefreshCw } from 'lucide-react';
import { Button, ErrorNotice, Loading } from '@storypane/ui';
import type { DeliverySettings, LocaleSnapshot, PreviewSession } from '@storypane/core';
import { api, errorMessage, jsonRequest } from './api';

export function PreviewPanel({
  settings,
  onSettings,
  previewId,
  onPreviewId,
  snapshot,
  spaceId,
  selectedId,
  onSelect,
}: {
  settings: DeliverySettings | null;
  onSettings: (settings: DeliverySettings) => void;
  previewId: string | null;
  onPreviewId: (id: string) => void;
  snapshot: LocaleSnapshot;
  spaceId: string;
  selectedId: string | null;
  onSelect: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState('Waiting for your app'),
    [generation, setGeneration] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null),
    selected = useRef(selectedId),
    snapshotRef = useRef(snapshot),
    selectRef = useRef(onSelect);
  selected.current = selectedId;
  snapshotRef.current = snapshot;
  selectRef.current = onSelect;
  useEffect(() => {
    if (settings) return;
    let stopped = false;
    void api<DeliverySettings>('/delivery-settings')
      .then((value) => {
        if (!stopped) onSettings(value);
      })
      .catch((cause) => {
        if (!stopped) setError(errorMessage(cause));
      });
    return () => {
      stopped = true;
    };
  }, [settings, onSettings]);
  const target =
    settings?.previewUrls.find((item) => item.id === previewId) ??
    settings?.previewUrls.find((item) => item.id === settings.defaultPreviewId);
  let url: URL | undefined;
  if (settings && target) {
    url = new URL(
      target.url
        .replaceAll('{slug}', snapshot.locale.urlSlug.split('/').map(encodeURIComponent).join('/'))
        .replaceAll('{locale}', encodeURIComponent(snapshot.locale.slug)),
    );
    // The root locale has no path segment, independently of the default setting.
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    url.searchParams.set(settings.previewParameter, '1');
  }
  const targetId = target?.id;
  const src = url?.href,
    origin = url?.origin;
  useEffect(() => {
    if (!origin || !targetId) return;
    setStatus('Waiting for your app');
    setError('');
    let stopped = false,
      authorizing = false;
    async function message(event: MessageEvent) {
      if (event.origin !== origin || event.source !== iframe.current?.contentWindow) return;
      const current = snapshotRef.current,
        data = event.data;
      if (
        data?.type === 'storypane:ready' &&
        data.spaceId === spaceId &&
        (data.locale === undefined || data.locale === current.locale.slug) &&
        (data.id === current.story.id || data.slug === current.locale.urlSlug)
      ) {
        if (authorizing) return;
        authorizing = true;
        try {
          const session = await api<PreviewSession>(
            `/stories/${current.story.id}/locales/${current.locale.id}/preview`,
            jsonRequest('POST', { previewId: targetId }),
          );
          if (!stopped) {
            setError('');
            iframe.current?.contentWindow?.postMessage(
              { type: 'storypane:init', session },
              origin!,
            );
            iframe.current?.contentWindow?.postMessage(
              { type: 'storypane:select', blockId: selected.current },
              origin!,
            );
          }
        } catch (cause) {
          if (!stopped) setError(errorMessage(cause));
        } finally {
          authorizing = false;
        }
      }
      if (data?.type === 'storypane:status' && typeof data.status === 'string')
        setStatus(
          data.status === 'connected'
            ? 'Live preview'
            : data.status === 'error'
              ? 'Preview unavailable'
              : 'Connecting…',
        );
      if (
        data?.type === 'storypane:click' &&
        data.storyId === current.story.id &&
        data.localeId === current.locale.id &&
        current.blocks.some((block) => block.id === data.blockId)
      ) {
        try {
          await selectRef.current(data.blockId);
          document
            .querySelector('[aria-label="Block editor"]')
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (cause) {
          if (!stopped) setError(errorMessage(cause));
        }
      }
    }
    window.addEventListener('message', message);
    return () => {
      stopped = true;
      window.removeEventListener('message', message);
    };
  }, [origin, src, targetId, spaceId, generation]);
  useEffect(() => {
    if (origin)
      iframe.current?.contentWindow?.postMessage(
        { type: 'storypane:select', blockId: selectedId },
        origin,
      );
  }, [selectedId, origin]);
  return (
    <section className="panel preview-panel" aria-label="Application preview">
      <header className="preview-toolbar">
        <span>
          <Monitor size={16} aria-hidden="true" />
          {status}
        </span>
        <div className="button-group">
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Reload preview"
            onClick={() => {
              setStatus('Waiting for your app');
              setGeneration((value) => value + 1);
            }}
          >
            <RefreshCw />
          </Button>
          {src && (
            <a
              className="button button--ghost icon-button"
              href={src}
              target="_blank"
              rel="noreferrer"
              aria-label="Open preview app"
            >
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </header>
      {target && (
        <div className="preview-target-switch">
          <label htmlFor="preview-url">Preview</label>
          <select
            id="preview-url"
            aria-label="Preview URL"
            value={target.id}
            onChange={(event) => onPreviewId(event.target.value)}
          >
            {settings!.previewUrls.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.id === settings!.defaultPreviewId ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorNotice message={error} />
      {!settings && !error ? (
        <Loading label="Loading preview settings…" />
      ) : src ? (
        <>
          <div className="preview-address">{src}</div>
          <iframe
            ref={iframe}
            key={`${target?.id}:${src}:${generation}`}
            src={src}
            title="Live application preview"
            referrerPolicy="no-referrer"
          />
        </>
      ) : (
        <div className="empty-state">
          <h2>Connect your app</h2>
          <p>
            Add a preview URL in Space settings → API & preview, and add the Storypane SDK to your
            app.
          </p>
        </div>
      )}
    </section>
  );
}
