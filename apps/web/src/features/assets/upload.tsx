'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, ChevronDown, ChevronUp, FileText, Pause, RotateCcw, UploadCloud, X } from 'lucide-react';
import type { AssetPart, AssetRecord } from '@storypane/assets';
import { assetApi, assetErrorMessage, formatBytes } from './api';
import { spaceHeaders } from '../../lib/space-url';
import './assets.css';

type Status = 'queued' | 'uploading' | 'paused' | 'error' | 'done';
interface Pending { id: string; filename: string; mimeType: string; byteSize: number | string; lastModified: number | null }
interface UploadSession { id: string; partBytes: number; parts: AssetPart[] }
interface UploadItem {
  id: string; filename: string; byteSize: number; lastModified: number | null; mimeType: string;
  file?: File; folderId: string | null; uploadId?: string; status: Status; progress: number; error?: string;
}
const mimeByExtension: Record<string, string> = { jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mov:'video/quicktime',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

async function uploadFile(item: UploadItem, signal: AbortSignal, onSession: (id: string) => void, onProgress: (value: number) => void) {
  const file = item.file!;
  // Keep the session receipt even if Pause is clicked while the upload is being created.
  const state = item.uploadId
    ? await assetApi<UploadSession>(`/uploads/${item.uploadId}`)
    : await assetApi<UploadSession>('/uploads', { method:'POST', body:JSON.stringify({ filename:item.filename, mimeType:item.mimeType, byteSize:file.size, lastModified:file.lastModified, title:item.filename.slice(0,200), folderId:item.folderId }) });
  onSession(state.id);
  const uploaded = new Set(state.parts.map(part => part.partNumber));
  for (let part = 1; part <= Math.ceil(file.size / state.partBytes); part++) {
    signal.throwIfAborted();
    if (!uploaded.has(part)) {
      const chunk = file.slice((part - 1) * state.partBytes, part * state.partBytes);
      for (let attempt = 0;; attempt++) {
        try {
          const response = await fetch(`/api/cms/assets/uploads/${state.id}/parts/${part}`, { method:'PUT', body:chunk, signal, headers:spaceHeaders() });
          if (!response.ok) {
            const result = await response.json().catch(() => null);
            throw Object.assign(new Error(assetErrorMessage(result, `Upload failed (${response.status})`)), { permanent:response.status < 500 && response.status !== 429 });
          }
          break;
        } catch (cause) {
          if (signal.aborted || attempt >= 3 || (cause instanceof Error && 'permanent' in cause && cause.permanent)) throw cause;
          await new Promise(resolve => setTimeout(resolve, [1000,3000,5000][attempt]));
        }
      }
    }
    onProgress(Math.round(Math.min(part * state.partBytes, file.size) / file.size * 95));
  }
  signal.throwIfAborted();
  return assetApi<{ asset:AssetRecord }>(`/uploads/${state.id}/complete`, { method:'POST', signal });
}

const UploadContext = createContext<{
  enqueue: (files: File[], folderId: string | null) => void;
  revision: number;
  count: number;
  show: () => void;
  setHost: (host: HTMLElement | null) => void;
} | null>(null);

export function useAssetUploads() {
  const value = useContext(UploadContext);
  if (!value) throw new Error('Asset uploads require UploadProvider');
  return value;
}

export function UploadProvider({ children }: { children:ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false), [collapsed, setCollapsed] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null), [recoveryError, setRecoveryError] = useState('');
  const active = useRef<{ id:string; controller:AbortController } | null>(null);
  const mounted = useRef(true);
  function update(id: string, change: Partial<UploadItem>) { if (mounted.current) setItems(current => current.map(item => item.id === id ? { ...item, ...change } : item)); }
  async function recover() {
    setRecoveryError('');
    try {
      const result = await assetApi<{ items:Pending[] }>('/uploads');
      if (!mounted.current) return;
      setItems(current => [...current, ...result.items.filter(item => !current.some(existing => existing.uploadId === item.id)).map(item => ({ ...item, byteSize:Number(item.byteSize), uploadId:item.id, folderId:null, status:'paused' as const, progress:0 }))]);
      if (result.items.length) setOpen(true);
    } catch { if (mounted.current) { setRecoveryError('Could not load unfinished uploads.'); setOpen(true); } }
  }
  useEffect(() => {
    mounted.current = true;
    void recover();
    return () => { mounted.current = false; active.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    if (active.current) return;
    const next = items.find(item => item.status === 'queued' && item.file);
    if (!next) return;
    const controller = new AbortController();
    active.current = { id:next.id, controller };
    update(next.id, { status:'uploading', error:undefined });
    void uploadFile(next, controller.signal, uploadId => update(next.id, { uploadId }), progress => update(next.id, { progress }))
      .then(() => {
        update(next.id, { status:'done', progress:100, file:undefined });
        if (mounted.current) setRevision(value => value + 1);
      })
      .catch(cause => update(next.id, { status:controller.signal.aborted ? 'paused' : 'error', error:controller.signal.aborted ? undefined : cause instanceof Error ? cause.message : 'Upload failed' }))
      .finally(() => { active.current = null; if (mounted.current) setItems(current => [...current]); });
  }, [items]);
  const busy = items.some(item => item.status === 'queued' || item.status === 'uploading');
  useEffect(() => {
    if (!busy) return;
    const warn = (event:BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  function show() { setOpen(true); setCollapsed(false); }
  function enqueue(files:File[], folderId:string | null) {
    const additions = files.map(file => {
      const error = !file.size || file.size > 1024 ** 3 ? 'Choose a file between 1 byte and 1 GiB.' : undefined;
      return { id:crypto.randomUUID(), file, filename:file.name, byteSize:file.size, lastModified:file.lastModified, mimeType:file.type || mimeByExtension[file.name.split('.').pop()?.toLowerCase() ?? ''] || '', folderId, progress:0, status:error ? 'error' as const : 'queued' as const, error };
    });
    setItems(current => [...current, ...additions]);
    show();
  }
  function pause(item:UploadItem) {
    if (active.current?.id === item.id) active.current.controller.abort();
    else update(item.id, { status:'paused' });
  }
  function resume(item:UploadItem, file = item.file) {
    if (!file) return;
    if (file.name !== item.filename || file.size !== item.byteSize || (item.lastModified !== null && file.lastModified !== item.lastModified)) {
      update(item.id, { error:'Select the original file to resume this upload.' }); return;
    }
    update(item.id, { file, status:'queued', error:undefined });
  }
  async function discard(item:UploadItem) {
    try {
      if (item.uploadId && item.status !== 'done') await assetApi(`/uploads/${item.uploadId}`, { method:'DELETE' });
      setItems(current => current.filter(entry => entry.id !== item.id));
    } catch (cause) { update(item.id, { error:cause instanceof Error ? cause.message : 'Could not discard upload' }); }
  }
  const completed = items.filter(item => item.status === 'done').length;
  const panel = <section className="upload-mini" aria-label="Upload manager">
    <header><UploadCloud aria-hidden="true" /><div><strong>{busy ? 'Uploading files' : 'Uploads'}</strong><span aria-live="polite">{completed} of {items.length} complete</span></div><button type="button" className="button button--ghost icon-button" aria-label={collapsed ? 'Expand uploads' : 'Minimize uploads'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronUp /> : <ChevronDown />}</button>{!busy && <button type="button" className="button button--ghost icon-button" aria-label="Close uploads" onClick={() => setOpen(false)}><X /></button>}</header>
    {!collapsed && <><div className="upload-mini-items">
      {recoveryError && <p className="asset-error" role="alert">{recoveryError} <button type="button" onClick={() => void recover()}>Retry</button></p>}
      {items.map(item => <div className={`upload-mini-item upload-mini-item--${item.status}`} key={item.id}>
        <span className="upload-file-icon">{item.status === 'done' ? <Check /> : item.status === 'error' ? <AlertCircle /> : <FileText />}</span>
        <div className="upload-file-info"><strong title={item.filename}>{item.filename}</strong><span>{formatBytes(item.byteSize)} · {item.status === 'done' ? 'Complete' : item.status === 'uploading' ? item.progress === 95 ? 'Verifying…' : `${item.progress}%` : item.status === 'queued' ? 'Queued' : item.status === 'paused' ? 'Paused' : 'Upload failed'}</span>
          {item.status === 'uploading' && <progress max={100} value={item.progress} aria-label={`Upload progress for ${item.filename}`} />}
          {item.error && <p role="alert">{item.error}</p>}
          {(item.status === 'paused' || item.status === 'error') && !item.file && <label className="upload-resume-file">Choose original file<input type="file" aria-label={`Resume ${item.filename} with original file`} className="asset-file-input" onChange={event => { resume(item, event.target.files?.[0]); event.target.value = ''; }} /></label>}
        </div>
        <div className="upload-file-actions">{item.status === 'uploading' || item.status === 'queued' ? <button type="button" aria-label={`Pause ${item.filename}`} onClick={() => pause(item)}><Pause /></button> : <>{item.file && item.byteSize > 0 && item.byteSize <= 1024 ** 3 && item.status !== 'done' && <button type="button" aria-label={`Retry ${item.filename}`} onClick={() => resume(item)}><RotateCcw /></button>}<button type="button" aria-label={`${item.status === 'done' ? 'Dismiss' : 'Discard'} ${item.filename}`} onClick={() => void discard(item)}><X /></button></>}</div>
      </div>)}
    </div><footer><span>{busy ? 'You can keep working while files upload.' : 'Drop more files into your asset library.'}</span>{completed > 0 && <button type="button" onClick={() => setItems(current => current.filter(item => item.status !== 'done'))}>Clear completed</button>}</footer></>}
  </section>;
  return <UploadContext.Provider value={{ enqueue, revision, count:items.length, show, setHost }}>{children}{open && (items.length > 0 || recoveryError) && typeof document !== 'undefined' && createPortal(panel, host ?? document.body)}</UploadContext.Provider>;
}
