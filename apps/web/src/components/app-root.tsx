'use client'

import { useEffect, useState } from 'react'
import { Boxes, ArrowRight, Layers3, Globe2, History } from 'lucide-react'
import { Button } from '@blok/ui'
import { CMSApp, type CMSSession } from './cms-app'
import { UploadProvider } from '../features/assets/upload'
import { SpacesScreen } from '../features/spaces/spaces-screen'
import { spaceUrl } from '../lib/space-url'
import { ThemePicker } from './theme-picker'

export function AppRoot() {
  const [session, setSession] = useState<(Omit<CMSSession, 'space'> & { space: CMSSession['space'] | null }) | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  async function loadSession() {
    setSessionError('')
    try {
      const response = await fetch(spaceUrl('/api/session'), { cache: 'no-store' })
      if (response.ok) setSession(await response.json())
      else if (response.status !== 401) { const data = await response.json() as { error?: { message?: string } }; setSessionError(data.error?.message ?? 'Unable to load your workspace.') }
    } catch { setSessionError('Cannot connect to the workspace. Please retry.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void loadSession() }, [])
  if (loading) return <main className="workspace-loading" aria-busy="true"><div className="loading-state"><span className="spinner" />Opening your workspace…</div></main>
  if (sessionError) return <main className="session-error"><h1>Unable to open this workspace</h1><p role="alert">{sessionError}</p><div className="button-group"><a href="/" className="button">All spaces</a><Button onClick={() => void loadSession()}>Try again</Button></div></main>
  if (session) return session.space ? <UploadProvider><CMSApp session={{ ...session, space:session.space }} /></UploadProvider> : <SpacesScreen user={session.user} />
  return <main className="login-shell">
    <div className="login-appearance"><ThemePicker /></div>
    <div className="login-intro">
      <div className="brand-lockup"><span className="brand-mark"><Boxes aria-hidden="true" /></span><span className="brand-name">blok<span className="brand-period">.</span></span></div>
      <div className="login-story"><span className="eyebrow">Your content, connected</span><h1>A space for<br /> every story.</h1><p>Build with blocks. Create in any language.<br />Bring your next idea to life, together.</p><div className="login-features"><span><Layers3 />Flexible blocks</span><span><Globe2 />Every locale</span><span><History />Every version</span></div></div>
      <span className="login-caption">The workspace behind what’s next.</span>
    </div>
    <div className="login-form-wrap"><form className="login-card" onSubmit={async event => {
      event.preventDefault(); setError(''); setSubmitting(true)
      try {
        const response = await fetch('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
        if (!response.ok) { const data = await response.json() as { message?: string }; throw new Error(data.message ?? 'Unable to sign in.') }
        setPassword(''); await loadSession()
      } catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.') }
      finally { setSubmitting(false) }
    }}>
      <div className="login-heading"><h2>Welcome back</h2><p>Sign in to your content workspace.</p></div>
      <label className="field">Email<input type="email" name="email" autoComplete="username" placeholder="you@company.com" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="field">Password<input type="password" name="password" autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}<ArrowRight aria-hidden="true" /></Button>
      <p className="login-note">Need access? Contact your workspace administrator.</p>
    </form></div>
  </main>
}
