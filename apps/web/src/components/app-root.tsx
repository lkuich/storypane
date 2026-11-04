'use client'

import { useEffect, useState } from 'react'
import { ClerkProvider, SignIn, SignUp, useAuth } from '@clerk/react'
import { Boxes, Layers3, Globe2, History } from 'lucide-react'
import { Button } from '@storypane/ui'
import { CMSApp, type CMSSession } from './cms-app'
import { UploadProvider } from '../features/assets/upload'
import { SpacesScreen } from '../features/spaces/spaces-screen'
import { spaceUrl } from '../lib/space-url'
import { ThemePicker } from './theme-picker'

export function AppRoot() {
  const [key,setKey] = useState('')
  const [error,setError] = useState('')
  useEffect(() => { void fetch('/api/auth/config').then(async response => {
    if (!response.ok) throw new Error('Unable to load authentication.')
    const config = await response.json() as { publishableKey?:string }
    if (!config.publishableKey) throw new Error('Clerk is not configured for this server.')
    setKey(config.publishableKey)
  }).catch(cause => setError(cause.message)) },[])
  if (error) return <main className="session-error"><p role="alert">{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></main>
  if (!key) return <main className="workspace-loading" aria-busy="true">Opening your workspace…</main>
  return <ClerkProvider publishableKey={key} afterSignOutUrl="/"><AuthenticatedApp /></ClerkProvider>
}

function AuthenticatedApp() {
  const { isLoaded,isSignedIn,getToken } = useAuth()
  const [session, setSession] = useState<(Omit<CMSSession, 'space'> & { space: CMSSession['space'] | null }) | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [loading, setLoading] = useState(true)
  async function loadSession() {
    setSessionError('')
    try {
      const token = await getToken()
      const response = await fetch(spaceUrl('/api/session'), { cache: 'no-store', headers: token ? { Authorization:`Bearer ${token}` } : {} })
      if (response.ok) setSession(await response.json())
      else if (response.status === 401) { setSession(null); setSessionError('Your session has expired. Sign in again to continue. Your unsent edits are preserved.') }
      else { const data = await response.json() as { error?: { message?: string } }; setSessionError(data.error?.message ?? 'Unable to load your workspace.') }
    } catch { setSessionError('Cannot connect to the workspace. Please retry.') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) { setSession(null); setSessionError(''); setLoading(false); return }
    void loadSession()
    const timer = setInterval(() => void loadSession(), 20_000)
    return () => clearInterval(timer)
  }, [isLoaded,isSignedIn])
  if (!isLoaded || (isSignedIn && loading)) return <main className="workspace-loading" aria-busy="true"><div className="loading-state"><span className="spinner" />Opening your workspace…</div></main>
  if (sessionError) return <main className="session-error"><h1>Unable to open this workspace</h1><p role="alert">{sessionError}</p><div className="button-group"><a href="/" className="button">All spaces</a><Button onClick={() => void loadSession()}>Try again</Button></div></main>
  if (session) return session.space ? <UploadProvider canUpload={session.space.permissions.includes('assets:write')}><CMSApp session={{ ...session, space:session.space }} /></UploadProvider> : <SpacesScreen />
  return <main className="login-shell">
    <div className="login-appearance"><ThemePicker /></div>
    <div className="login-intro">
      <div className="brand-lockup"><span className="brand-mark"><Boxes aria-hidden="true" /></span><span className="brand-name">storypane<span className="brand-period">.</span></span></div>
      <div className="login-story"><span className="eyebrow">Your content, connected</span><h1>A space for<br /> every story.</h1><p>Build with blocks. Create in any language.<br />Bring your next idea to life, together.</p><div className="login-features"><span><Layers3 />Flexible blocks</span><span><Globe2 />Every locale</span><span><History />Every version</span></div></div>
      <span className="login-caption">The workspace behind what’s next.</span>
    </div>
    <div className="login-form-wrap">{typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sign-up') ? <SignUp routing="hash" signInUrl="/" forceRedirectUrl="/" /> : <SignIn routing="hash" signUpUrl="/?sign-up=1" forceRedirectUrl="/" />}</div>
  </main>
}
