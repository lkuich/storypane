'use client'
import { useEffect, useState } from 'react'
import { Code2, KeyRound, Plus, Trash2 } from 'lucide-react'
import type { DeliverySettings as Settings, DeliveryToken } from '@blok/core'
import { Button, ErrorNotice, Loading } from '@blok/ui'
import { api, errorMessage, jsonRequest } from '../editor/api'

export function DeliverySettings({ canManage, onDirty, onBusy }: { canManage:boolean; onDirty:(value:boolean) => void; onBusy:(value:boolean) => void }) {
  const [settings,setSettings] = useState<Settings | null>(null), [previewUrl,setPreviewUrl] = useState(''), [parameter,setParameter] = useState('blok_preview');
  const [tokens,setTokens] = useState<DeliveryToken[]>([]), [tokenName,setTokenName] = useState(''), [scope,setScope] = useState<'published' | 'preview'>('published');
  const [revealed,setRevealed] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false), [saved,setSaved] = useState(false);
  const dirty = !!settings && (previewUrl !== settings.previewUrl || parameter !== settings.previewParameter);
  async function load() {
    setError('');
    try {
      const [value,keys] = await Promise.all([api<Settings>('/delivery-settings'), canManage ? api<DeliveryToken[]>('/delivery-tokens') : Promise.resolve([])]);
      setSettings(value); setPreviewUrl(value.previewUrl); setParameter(value.previewParameter); setTokens(keys);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  useEffect(() => { void load(); },[canManage]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); },[dirty,onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); },[busy,onBusy]);
  async function action(work:() => Promise<void>) { setError(''); setBusy(true); try { await work(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <section className="panel delivery-settings"><header className="panel-heading"><h2><Code2 aria-hidden="true" />API & preview</h2></header><div className="panel-body">
    <ErrorNotice message={error} retry={!settings ? load : undefined} />
    {!settings ? !error && <Loading /> : <>
      <form onSubmit={event => { event.preventDefault(); void action(async () => { const value = await api<Settings>('/delivery-settings',jsonRequest('PUT',{ previewUrl, previewParameter:parameter })); setSettings(value); setPreviewUrl(value.previewUrl); setParameter(value.previewParameter); setSaved(true); }); }}>
        <fieldset className="space-settings-fields" disabled={!canManage || busy}>
          <label className="field">Application preview URL<input aria-label="Application preview URL" value={previewUrl} onChange={event => { setPreviewUrl(event.target.value); setSaved(false); }} placeholder="https://your-app.com/{locale}/{slug}" maxLength={2048} /><span className="field-hint">Use {'{slug}'} and {'{locale}'} for the current page. Localhost HTTP is supported for development. Your app must allow this CMS to embed it.</span></label>
          <label className="field">Preview URL parameter<input aria-label="Preview URL parameter" value={parameter} onChange={event => { setParameter(event.target.value); setSaved(false); }} required pattern="[a-zA-Z][a-zA-Z0-9_-]{0,63}" /><span className="field-hint">The editor adds this parameter with a value of 1. Match it in your SDK preview configuration.</span></label>
        </fieldset>
        {canManage && <div className="space-settings-actions"><span role="status">{saved ? 'Preview settings saved' : ''}</span><Button type="submit" disabled={!dirty || busy}>Save preview settings</Button></div>}
      </form>
      {canManage && <><hr /><h3><KeyRound size={16} aria-hidden="true" /> Access tokens</h3><p className="small">Published tokens read published content. Preview tokens can create draft preview sessions and must stay on your app server.</p>
        {revealed && <label className="field">New token — copy it now<input aria-label="New token — copy it now" className="mono" readOnly value={revealed} onFocus={event => event.target.select()} /><span className="field-hint">The full token is shown only once.</span></label>}
        <form className="delivery-token-form" onSubmit={event => { event.preventDefault(); void action(async () => { const result = await api<DeliveryToken & { token:string }>('/delivery-tokens',jsonRequest('POST',{ name:tokenName, scope })); setTokens(current => [...current,result]); setRevealed(result.token); setTokenName(''); }); }}>
          <label className="field">Token name<input value={tokenName} onChange={event => setTokenName(event.target.value)} placeholder="Marketing website" required maxLength={80} disabled={busy} /></label>
          <label className="field">Access<select value={scope} onChange={event => setScope(event.target.value as typeof scope)} disabled={busy}><option value="published">Published content</option><option value="preview">Preview · server only</option></select></label>
          <Button type="submit" disabled={busy || !tokenName.trim()}><Plus />Create token</Button>
        </form>
        <ul className="delivery-token-list">{tokens.map(token => <li key={token.id}><div><strong>{token.name}</strong><span>{token.scope === 'preview' ? 'Preview · server only' : 'Published content'}</span></div><Button variant="ghost" className="icon-button" disabled={busy} aria-label={`Revoke ${token.name}`} onClick={() => { if (window.confirm(`Revoke “${token.name}”? Apps using it will lose access.`)) void action(async () => { await api(`/delivery-tokens/${token.id}`,{ method:'DELETE' }); setTokens(current => current.filter(item => item.id !== token.id)); setRevealed(''); }); }}><Trash2 /></Button></li>)}</ul>
      </>}
    </>}
  </div></section>
}
