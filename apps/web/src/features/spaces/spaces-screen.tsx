'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Boxes, Building2, FileText, LogOut, Plus, Search, Settings2, Users } from 'lucide-react'
import type { Space } from '@storypane/core'
import { Button, EmptyState, ErrorNotice, Loading, Modal } from '@storypane/ui'
import type { CMSSession } from '../../components/cms-app'
import { errorMessage, jsonRequest, requestJson } from '../editor/api'
import './spaces.css'
import { ThemePicker } from '../../components/theme-picker'

export function SpacesScreen({ user }: { user: CMSSession['user'] }) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [search, setSearch] = useState(''), [creating, setCreating] = useState(false)
  const [name, setName] = useState(''), [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false), [formError, setFormError] = useState('')
  async function load() {
    setLoading(true); setError('')
    try { setSpaces(await requestJson<Space[]>('/api/spaces')) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const filtered = spaces.filter(space => `${space.name} ${space.description}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="spaces-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="spaces-header">
      <a className="brand-lockup" href="/" aria-label="Storypane home"><span className="brand-mark"><Boxes aria-hidden="true" /></span><span className="brand-name">storypane<span className="brand-period">.</span></span></a>
      <span className="spaces-header-label"><Building2 aria-hidden="true" />Spaces</span>
      <div className="spaces-account"><ThemePicker /><span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.email}</span></div><Button variant="ghost" className="icon-button" aria-label="Sign out" onClick={async () => {
        try { await requestJson('/api/auth/sign-out', jsonRequest('POST', {})); window.location.reload() }
        catch (cause) { setError(errorMessage(cause)) }
      }}><LogOut aria-hidden="true" /></Button></div>
    </header>
    <main className="spaces-main" id="main-content">
      <div className="page-heading"><div><div className="eyebrow">Your workspace, organized</div><h1>Spaces</h1><p>A home for every project. Pick up where your team left off.</p></div><Button variant="primary" onClick={() => { setName(''); setDescription(''); setFormError(''); setCreating(true) }}><Plus aria-hidden="true" />Create space</Button></div>
      <div className="spaces-toolbar"><label className="search-input"><Search aria-hidden="true" /><input type="search" aria-label="Search spaces" placeholder="Search your spaces…" value={search} onChange={event => setSearch(event.target.value)} /></label><span>{spaces.length} {spaces.length === 1 ? 'space' : 'spaces'}</span></div>
      <ErrorNotice message={error} retry={load} />
      {loading ? <Loading label="Loading your spaces…" /> : !error && (filtered.length ? <div className="spaces-grid">{filtered.map(space => <article className="space-card" key={space.id} aria-label={space.name}>
        <div className="space-card-top"><span className="space-emblem"><Building2 aria-hidden="true" /></span><span className="pill pill--outline">{space.role === 'admin' ? 'Admin' : 'Editor'}</span></div>
        <h2><a href={`/?space=${space.id}`}>{space.name}</a></h2><p className="space-description">{space.description || 'Your stories, blocks, and assets in one place.'}</p>
        <div className="space-stats"><span><FileText aria-hidden="true" />{space.storyCount} {space.storyCount === 1 ? 'story' : 'stories'}</span><span><Users aria-hidden="true" />{space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}</span></div>
        <footer><a className="button button--ghost button--small" href={`/?space=${space.id}&view=settings`} aria-label={`Settings for ${space.name}`}><Settings2 aria-hidden="true" />Settings</a><a className="space-open" href={`/?space=${space.id}`} aria-label={`Open ${space.name}`}>Open space<ArrowRight aria-hidden="true" /></a></footer>
      </article>)}</div> : <div className="panel"><EmptyState title={spaces.length ? 'No matching spaces' : 'Create your first space'}>{spaces.length ? 'Try a different name or description.' : 'Bring a project’s content, blocks, and assets together in a dedicated workspace.'}</EmptyState></div>)}
    </main>
    <Modal open={creating} onClose={() => { if (!submitting) setCreating(false) }} title="Create a space" description="Give your next project a place to grow.">
      <form onSubmit={async event => {
        event.preventDefault(); setSubmitting(true); setFormError('')
        try {
          const space = await requestJson<Space>('/api/spaces', jsonRequest('POST', { name, description }))
          setSpaces(current => [...current, space]); setSearch(''); setCreating(false)
        } catch (cause) { setFormError(errorMessage(cause)) }
        finally { setSubmitting(false) }
      }}>
        <label className="field">Space name<input value={name} onChange={event => setName(event.target.value)} required maxLength={120} placeholder="e.g. Marketing website" autoFocus /></label>
        <label className="field">Description <span className="field-hint">Optional · Help your team recognize this space.</span><textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={1000} placeholder="What will you create here?" /></label>
        <p className="small muted">You’ll be the administrator of this space.</p><ErrorNotice message={formError} />
        <div className="dialog-actions"><Button disabled={submitting} onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" type="submit" disabled={submitting || !name.trim()}>{submitting ? 'Creating…' : 'Create space'}</Button></div>
      </form>
    </Modal>
  </div>
}
