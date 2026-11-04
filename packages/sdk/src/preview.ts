import { migrationWarning } from './migration-warning.js';
export { editable, isPreviewMode } from './types.js';
export type { PreviewMode, PreviewSession } from './types.js';
import { isPreviewMode, type StorypaneStory, type PreviewMode, type PreviewSession, type StoryReference } from './types.js';

export type PreviewStatus = 'disabled' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export interface PreviewOptions<T = StorypaneStory['content']> {
  cmsUrl:string; spaceId:string; migrationVersion?:number; story:StoryReference; mode?:PreviewMode;
  onChange:(story:StorypaneStory<T>) => void;
  onStatus?:(status:PreviewStatus, error?:Error) => void;
  /** For standalone preview, fetch a short-lived session from your authenticated app server. */
  getSession?:() => Promise<PreviewSession>;
}

/** Connects only in preview mode. Published pages never request drafts or open a socket. */
export function connectPreview<T>(options:PreviewOptions<T>): () => void {
  if (typeof window === 'undefined' || !isPreviewMode(options.mode)) { options.onStatus?.('disabled'); return () => {}; }
  const warnMigration=migrationWarning(options.migrationVersion);
  const cms = new URL(options.cmsUrl), editorOrigin = cms.origin;
  let stopped = false, socket:WebSocket | undefined, session:PreviewSession | undefined;
  let reconnect:ReturnType<typeof setTimeout> | undefined, renew:ReturnType<typeof setTimeout> | undefined;
  let ready:ReturnType<typeof setInterval> | undefined, retry = 0, revision = -1, selected = '';
  const embedded = window.parent !== window;
  const send = (message:unknown) => { if (embedded) window.parent.postMessage(message, editorOrigin); };
  function status(value:PreviewStatus, error?:Error) { options.onStatus?.(value,error); send({ type:'blok:status', status:value, message:error?.message }); }
  function matches(value:PreviewSession) {
    return value && typeof value.token === 'string' && /^bp_[\w-]{43}$/.test(value.token) && value.spaceId === options.spaceId &&
      value.locale === (options.story.locale ?? '') && (options.story.id ? value.storyId === options.story.id : value.slug === options.story.slug) && Date.parse(value.expiresAt) > Date.now();
  }
  function highlight() {
    for (const element of document.querySelectorAll<HTMLElement>('[data-blok-id]')) {
      if (element.dataset.blokId === selected) element.setAttribute('data-blok-selected','');
      else element.removeAttribute('data-blok-selected');
    }
  }
  function open(value:PreviewSession) {
    if (stopped || !matches(value)) return;
    session = value;
    if (ready) { clearInterval(ready); ready = undefined; }
    if (renew) clearTimeout(renew);
    if (reconnect) clearTimeout(reconnect);
    if (socket) { socket.onclose = null; socket.close(); }
    const url = new URL('/api/preview/live', cms); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    status('connecting');
    socket = new WebSocket(url, ['blok-preview', value.token]);
    socket.onopen = () => { retry = 0; status('connected'); };
    socket.onmessage = event => {
      if (stopped) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'content' && message.story?.id === value.storyId && message.story?.localeId === value.localeId && typeof message.story.revision === 'number' && message.story.revision >= revision) {
          warnMigration(message.story.migrationVersion);
          revision = message.story.revision; options.onChange(message.story); highlight();
        } else if (message.type === 'error') status('error', new Error(message.message ?? 'Preview is unavailable'));
      } catch { status('error', new Error('Invalid preview response')); }
    };
    socket.onclose = event => {
      if (stopped) return;
      status('reconnecting');
      reconnect = setTimeout(() => { if (event.code === 1008 || !session || Date.parse(session.expiresAt) <= Date.now()+30000) void authorize(); else open(session); }, Math.min(1000 * 2 ** retry++, 10000));
    };
    renew = setTimeout(() => void authorize(), Math.max(1000, Date.parse(value.expiresAt) - Date.now() - 30000));
  }
  async function authorize() {
    if (stopped) return;
    try {
      if (options.getSession) {
        const value = await options.getSession();
        if (!matches(value)) throw new Error('Preview session does not match this story, locale, or space');
        open(value);
      } else if (embedded) {
        send({ type:'blok:ready', spaceId:options.spaceId, ...options.story, locale:options.story.locale ?? '' });
        if (!ready) ready = setInterval(() => send({ type:'blok:ready', spaceId:options.spaceId, ...options.story, locale:options.story.locale ?? '' }), 3000);
      } else status('error', new Error('Standalone preview requires an authenticated getSession callback'));
    } catch (cause) { if (!stopped) status('error', cause instanceof Error ? cause : new Error('Preview authorization failed')); }
  }
  function message(event:MessageEvent) {
    if (!embedded || event.source !== window.parent || event.origin !== editorOrigin) return;
    if (event.data?.type === 'blok:init') open(event.data.session);
    if (event.data?.type === 'blok:select' && typeof event.data.blockId === 'string') { selected = event.data.blockId; highlight(); }
  }
  function click(event:MouseEvent | KeyboardEvent) {
    if (!session || Date.parse(session.expiresAt) <= Date.now() || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event instanceof KeyboardEvent && !['Enter',' '].includes(event.key)) return;
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-blok-id]') : null;
    if (!element) return;
    event.preventDefault(); event.stopPropagation(); selected = element.dataset.blokId!; highlight();
    send({ type:'blok:click', blockId:selected, field:element.dataset.blokField, storyId:session.storyId, localeId:session.localeId });
  }
  const style = document.createElement('style');
  style.textContent = '[data-blok-id]{cursor:pointer}[data-blok-id]:hover{outline:1px dashed #22c3ee;outline-offset:3px}[data-blok-selected]{outline:2px solid #22c3ee!important;outline-offset:3px}';
  document.head.appendChild(style);
  const observer = new MutationObserver(highlight);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  window.addEventListener('message',message);
  document.addEventListener('click',click,true); document.addEventListener('keydown',click,true);
  const heartbeat = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'heartbeat', revision })); },15000);
  status('waiting'); void authorize();
  return () => {
    stopped = true; if (socket) { socket.onclose = null; socket.close(); }
    clearInterval(heartbeat); if (ready) clearInterval(ready); if (renew) clearTimeout(renew); if (reconnect) clearTimeout(reconnect);
    observer.disconnect(); style.remove(); document.querySelectorAll('[data-blok-selected]').forEach(element => element.removeAttribute('data-blok-selected'));
    window.removeEventListener('message',message); document.removeEventListener('click',click,true); document.removeEventListener('keydown',click,true);
  };
}
