'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { Button, ErrorNotice, Loading } from '@storypane/ui';
import {
  defaultPreview,
  type UserDeliverySettings,
  type Json,
  type LocaleSnapshot,
  type PreviewSession,
} from '@storypane/core';
import { api, errorMessage, jsonRequest } from './api';

export type ComponentPreview = { blockId: string } | { block: Record<string, Json> };

const previewSizes = [
  { name: 'Mobile', width: 390, icon: Smartphone },
  { name: 'Tablet', width: 768, icon: Tablet },
  { name: 'Desktop', width: 0, icon: Monitor },
];

export function PreviewPanel({
  settings,
  onSettings,
  previewId,
  onPreviewId,
  snapshot,
  spaceId,
  selectedId,
  onSelect,
  component,
  schedule,
}: {
  settings: UserDeliverySettings | null;
  onSettings: (settings: UserDeliverySettings) => void;
  previewId: string | null;
  onPreviewId: (id: string) => void;
  snapshot: LocaleSnapshot;
  spaceId: string;
  selectedId: string | null;
  onSelect: (id: string) => Promise<void>;
  component?: ComponentPreview;
  schedule?: { id: string; revision: number };
}) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState('Waiting for your app'),
    [generation, setGeneration] = useState(0);
  const [componentReady, setComponentReady] = useState(false);
  const [previewSize, setPreviewSize] = useState(previewSizes[2]);
  const [viewportWidth, setViewportWidth] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null),
    selected = useRef(selectedId),
    snapshotRef = useRef(snapshot),
    selectRef = useRef(onSelect);
  const componentRef = useRef(component);
  componentRef.current = component;
  selected.current = selectedId;
  snapshotRef.current = snapshot;
  selectRef.current = onSelect;
  useEffect(() => {
    if (settings) return;
    let stopped = false;
    void api<UserDeliverySettings>('/delivery-settings')
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
    (settings ? defaultPreview(settings) : undefined);
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
  const scheduleId = schedule?.id,
    scheduleRevision = schedule?.revision;
  const src = url?.href,
    origin = url?.origin;
  useEffect(() => {
    if (component || !src || !viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [component, src]);
  const scale =
    viewportWidth && previewSize.width ? Math.min(1, viewportWidth / previewSize.width) : 1;
  useEffect(() => {
    if (!origin || !targetId) return;
    setStatus('Waiting for your app');
    setError('');
    setComponentReady(false);
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
        if (componentRef.current && data.componentPreview !== true) {
          setError('Enable component previews in your app’s Storypane SDK integration.');
          return;
        }
        if (authorizing) return;
        authorizing = true;
        try {
          const session = await api<PreviewSession>(
            `/stories/${current.story.id}/locales/${current.locale.id}/preview`,
            jsonRequest('POST', {
              previewId: targetId,
              ...(scheduleId ? { scheduleId, scheduleRevision } : {}),
            }),
          );
          if (!stopped) {
            setError('');
            iframe.current?.contentWindow?.postMessage(
              { type: 'storypane:init', session },
              origin!,
            );
            if (componentRef.current)
              iframe.current?.contentWindow?.postMessage(
                { type: 'storypane:component', ...componentRef.current },
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
      if (componentRef.current && data?.type === 'storypane:component-rendered') {
        setComponentReady(data.found === true);
        setError(data.found === true ? '' : 'This block is no longer available.');
      }
      if (componentRef.current && data?.type === 'storypane:status' && data.status === 'error') {
        setComponentReady(false);
        setError('Component preview is unavailable.');
      }
      if (data?.type === 'storypane:status' && typeof data.status === 'string')
        setStatus(
          data.status === 'connected'
            ? scheduleId
              ? 'Release preview'
              : 'Live preview'
            : data.status === 'error'
              ? 'Preview unavailable'
              : 'Connecting…',
        );
      if (
        data?.type === 'storypane:click' &&
        !componentRef.current &&
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
  }, [origin, src, targetId, spaceId, generation, scheduleId, scheduleRevision]);
  useEffect(() => {
    if (origin)
      iframe.current?.contentWindow?.postMessage(
        { type: 'storypane:select', blockId: selectedId },
        origin,
      );
  }, [selectedId, origin]);
  useEffect(() => {
    if (!component || !origin) return;
    setComponentReady(false);
    iframe.current?.contentWindow?.postMessage(
      { type: 'storypane:component', ...component },
      origin,
    );
  }, [component, origin]);
  return (
    <section
      className="panel preview-panel"
      aria-label={component ? 'Component preview' : 'Application preview'}
    >
      {!component && (
        <>
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
                    {item.id === settings!.personalDefaultPreviewId
                      ? ' (my default)'
                      : item.id === settings!.defaultPreviewId
                        ? ' (space default)'
                        : ''}
                  </option>
                ))}
              </select>
              <div className="preview-size-switch" role="group" aria-label="Preview size">
                {previewSizes.map((size) => (
                  <Button
                    key={size.name}
                    className="icon-button"
                    variant={previewSize === size ? 'primary' : 'ghost'}
                    aria-label={size.name}
                    aria-pressed={previewSize === size}
                    onClick={() => setPreviewSize(size)}
                    title={`${size.name} · ${size.width ? `${size.width}px viewport` : 'Full panel width'}`}
                  >
                    <size.icon aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <ErrorNotice message={error} />
      {!settings && !error ? (
        <Loading label="Loading preview settings…" />
      ) : src ? (
        <>
          {!component && <div className="preview-address">{src}</div>}
          {component && !componentReady && !error && <Loading label="Loading block preview…" />}
          <div ref={viewport} className={component ? undefined : 'preview-viewport'}>
            <iframe
              ref={iframe}
              key={`${target?.id}:${src}:${generation}`}
              src={src}
              loading="lazy"
              title={component ? 'Block preview' : 'Live application preview'}
              referrerPolicy="no-referrer"
              tabIndex={component ? -1 : undefined}
              style={
                component
                  ? !componentReady || error
                    ? { visibility: 'hidden' }
                    : undefined
                  : {
                      width: previewSize.width || '100%',
                      height: `${100 / scale}%`,
                      transform: `translateX(-50%) scale(${scale})`,
                    }
              }
            />
          </div>
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
