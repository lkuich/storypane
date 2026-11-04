'use client'

import { useEffect, useState } from 'react'
import { Building2, Check, Copy, ShieldCheck, Users } from 'lucide-react'
import type { Space, SpaceDetails } from '@storypane/core'
import { Button, ErrorNotice, Loading } from '@storypane/ui'
import { api, errorMessage, jsonRequest } from '../editor/api'
import type { RegisterGuard } from '../editor/navigation'
import './spaces.css'
import { DeliverySettings } from './delivery-settings'
import { LocaleSettings } from './locale-settings'

export function SpaceSettings({ onUpdate, registerGuard }: { onUpdate: (space: Space) => void; registerGuard: RegisterGuard }) {
  const [space, setSpace] = useState<SpaceDetails | null>(null), [loading, setLoading] = useState(true)
  const [name, setName] = useState(''), [description, setDescription] = useState('')
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [copied, setCopied] = useState(false)
  const dirty = !!space && (name !== space.name || description !== space.description)
  const [deliveryDirty,setDeliveryDirty] = useState(false), [deliveryBusy,setDeliveryBusy] = useState(false)
  const [localeDirty,setLocaleDirty] = useState(false), [localeBusy,setLocaleBusy] = useState(false)
  async function load() {
    setError(''); setLoading(true)
    try { const value = await api<SpaceDetails>('/space'); setSpace(value); setName(value.name); setDescription(value.description) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    registerGuard(() => !saving && !deliveryBusy && !localeBusy && (!(dirty || deliveryDirty || localeDirty) || window.confirm('Discard unsaved space settings?')))
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving || deliveryDirty || deliveryBusy || localeDirty || localeBusy) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => { registerGuard(null); window.removeEventListener('beforeunload', warn) }
  }, [dirty, saving, deliveryDirty, deliveryBusy, localeDirty, localeBusy, registerGuard])
  return <>
    <div className="page-heading"><div><div className="eyebrow">Make it yours</div><h1>Space settings</h1><p>Manage your workspace, locales, and application connections.</p></div></div>
    <ErrorNotice message={error} retry={!space ? load : undefined} />
    {loading ? <Loading label="Loading space settings…" /> : space && <div className="space-settings-layout">
      <div className="space-settings-main">
        <section className="panel"><header className="panel-heading"><h2><Building2 aria-hidden="true" />General</h2></header>
          <form className="panel-body" onSubmit={async event => {
            event.preventDefault(); setError(''); setSaving(true); setSaved(false)
            try { const updated = await api<Space>('/space', jsonRequest('PUT', { name, description })); setSpace({ ...space, ...updated }); setName(updated.name); setDescription(updated.description); onUpdate(updated); setSaved(true) }
            catch (cause) { setError(errorMessage(cause)) }
            finally { setSaving(false) }
          }}>
            {space.role !== 'admin' && <p className="notice">Only space administrators can change these settings.</p>}
            <fieldset disabled={space.role !== 'admin' || saving} className="space-settings-fields">
              <label className="field">Space name<input required maxLength={120} value={name} onChange={event => { setName(event.target.value); setSaved(false) }} /></label>
              <label className="field">Description<textarea maxLength={1000} value={description} onChange={event => { setDescription(event.target.value); setSaved(false) }} /><span className="field-hint">Shown on the Spaces screen to help your team find the right project.</span></label>
            </fieldset>
            {space.role === 'admin' && <div className="space-settings-actions"><span role="status">{saved && <><Check aria-hidden="true" />Changes saved</>}</span><Button variant="primary" type="submit" disabled={saving || !dirty || !name.trim()}>{saving ? 'Saving…' : 'Save changes'}</Button></div>}
          </form>
        </section>
        <LocaleSettings canManage={space.role === 'admin'} onDirty={setLocaleDirty} onBusy={setLocaleBusy} />
        <section className="panel"><header className="panel-heading"><h2><Users aria-hidden="true" />Members</h2><span className="pill">{space.memberCount}</span></header><div className="table-wrap"><table className="data-table" aria-label="Space members"><thead><tr><th>Member</th><th>Role</th></tr></thead><tbody>{space.members.map(member => <tr key={member.id}><td><div className="entity-name"><span className="avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><div className="entity-subtitle">{member.email}</div></div></div></td><td><span className="pill pill--outline">{member.role === 'admin' ? 'Admin' : 'Editor'}</span></td></tr>)}</tbody></table></div></section>
        <DeliverySettings canManage={space.role === 'admin'} onDirty={setDeliveryDirty} onBusy={setDeliveryBusy} />
      </div>
      <aside className="space-settings-aside">
        <section className="panel"><div className="panel-body"><span className="space-emblem"><Building2 aria-hidden="true" /></span><h2>{space.name}</h2><dl><div><dt>Created</dt><dd>{new Date(space.createdAt).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })}</dd></div><div><dt>Stories</dt><dd>{space.storyCount}</dd></div><div><dt>Your role</dt><dd>{space.role === 'admin' ? 'Administrator' : 'Editor'}</dd></div></dl><label className="field">Space ID<input readOnly value={space.id} className="mono" /></label><Button className="button--small" onClick={async () => { try { await navigator.clipboard.writeText(space.id); setCopied(true) } catch { setError('Select and copy the space ID above.') } }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copied' : 'Copy space ID'}</Button></div></section>
        <p className="space-access-note"><ShieldCheck aria-hidden="true" /><span>Content, blocks, datasources, and assets belong to this space. Only its members have access.</span></p>
      </aside>
    </div>}
  </>
}
