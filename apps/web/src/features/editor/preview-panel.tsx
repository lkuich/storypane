'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Monitor, RefreshCw } from 'lucide-react';
import { Button, ErrorNotice, Loading } from '@blok/ui';
import type { DeliverySettings, LocaleSnapshot, PreviewSession } from '@blok/core';
import { api, errorMessage, jsonRequest } from './api';

export function PreviewPanel({ snapshot, spaceId, selectedId, onSelect }: { snapshot:LocaleSnapshot; spaceId:string; selectedId:string | null; onSelect:(id:string) => Promise<void> }) {
  const [settings,setSettings] = useState<DeliverySettings | null>(null), [error,setError] = useState(''), [status,setStatus] = useState('Waiting for your app'), [generation,setGeneration] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null), selected = useRef(selectedId), snapshotRef = useRef(snapshot), selectRef = useRef(onSelect);
  selected.current = selectedId; snapshotRef.current = snapshot; selectRef.current = onSelect;
  useEffect(() => { void api<DeliverySettings>('/delivery-settings').then(setSettings).catch(cause => setError(errorMessage(cause))); },[]);
  let url:URL | undefined;
  if (settings?.previewUrl) {
    url = new URL(settings.previewUrl.replaceAll('{slug}',snapshot.locale.urlSlug.split('/').map(encodeURIComponent).join('/')).replaceAll('{locale}',encodeURIComponent(snapshot.locale.slug)));
    // Default locale has no path segment.
    url.pathname = url.pathname.replace(/\/{2,}/g,'/');
    url.searchParams.set(settings.previewParameter,'1');
  }
  const src = url?.href, origin = url?.origin;
  useEffect(() => {
    if (!origin) return;
    let stopped = false, authorizing = false;
    async function message(event:MessageEvent) {
      if (event.origin !== origin || event.source !== iframe.current?.contentWindow) return;
      const current = snapshotRef.current, data = event.data;
      if (data?.type === 'blok:ready' && data.spaceId === spaceId && data.locale === current.locale.slug && (data.id === current.story.id || data.slug === current.locale.urlSlug)) {
        if (authorizing) return;
        authorizing = true;
        try {
          const session = await api<PreviewSession>(`/stories/${current.story.id}/locales/${current.locale.id}/preview`,jsonRequest('POST',{}));
          if (!stopped) { setError(''); iframe.current?.contentWindow?.postMessage({ type:'blok:init',session },origin!); iframe.current?.contentWindow?.postMessage({ type:'blok:select',blockId:selected.current },origin!); }
        } catch (cause) { if (!stopped) setError(errorMessage(cause)); }
        finally { authorizing = false; }
      }
      if (data?.type === 'blok:status' && typeof data.status === 'string') setStatus(data.status === 'connected' ? 'Live preview' : data.status === 'error' ? 'Preview unavailable' : 'Connecting…');
      if (data?.type === 'blok:click' && data.storyId === current.story.id && data.localeId === current.locale.id && current.blocks.some(block => block.id === data.blockId)) {
        try { await selectRef.current(data.blockId); document.querySelector('[aria-label="Block editor"]')?.scrollIntoView({ behavior:'smooth',block:'nearest' }); }
        catch (cause) { if (!stopped) setError(errorMessage(cause)); }
      }
    }
    window.addEventListener('message',message);
    return () => { stopped = true; window.removeEventListener('message',message); };
  },[origin,spaceId,generation]);
  useEffect(() => { if (origin) iframe.current?.contentWindow?.postMessage({ type:'blok:select',blockId:selectedId },origin); },[selectedId,origin]);
  return <section className="panel preview-panel" aria-label="Application preview"><header className="preview-toolbar"><span><Monitor size={16} aria-hidden="true" />{status}</span><div className="button-group"><Button variant="ghost" className="icon-button" aria-label="Reload preview" onClick={() => { setStatus('Waiting for your app'); setGeneration(value => value+1); }}><RefreshCw /></Button>{src && <a className="button button--ghost icon-button" href={src} target="_blank" rel="noreferrer" aria-label="Open preview app"><ExternalLink size={16} /></a>}</div></header>
    <ErrorNotice message={error} />
    {!settings && !error ? <Loading label="Loading preview settings…" /> : src ? <><div className="preview-address">{src}</div><iframe ref={iframe} key={`${src}:${generation}`} src={src} title="Live application preview" referrerPolicy="no-referrer" /></> : <div className="empty-state"><h2>Connect your app</h2><p>Set an application preview URL in Space settings → API & preview, and add the Blok SDK to your app.</p></div>}
  </section>;
}
