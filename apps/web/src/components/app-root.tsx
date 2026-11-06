'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LocalSignIn, InvitationForm } from './local-sign-in';
const ClerkApp = lazy(() => import('./clerk-app'));
const noToken = async () => null;
import { Boxes, Layers3, Globe2, History } from 'lucide-react';
import { CMSApp, type CMSSession } from './cms-app';
import { UploadProvider } from '../features/assets/upload';
import { SpacesScreen } from '../features/spaces/spaces-screen';
import { spaceUrl } from '../lib/space-url';
import { ThemePicker } from './theme-picker';
import { WorkspaceError } from './workspace-error';

function WorkspaceLoading() {
  return (
    <main className="workspace-loading" aria-busy="true">
      <div className="loading-state">
        <span className="spinner" />
        Opening your workspace…
      </div>
    </main>
  );
}

export function AppRoot() {
  const [config, setConfig] = useState<{
    provider: 'local' | 'clerk';
    publishableKey?: string;
    passwordReset?: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/auth/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load authentication.');
        const value = (await response.json()) as NonNullable<typeof config>;
        if (value.provider === 'clerk' && !value.publishableKey)
          throw new Error('Clerk is not configured for this server.');
        setConfig(value);
      })
      .catch((cause) => setError(cause.message));
  }, []);
  if (error)
    return (
      <WorkspaceError
        title="Unable to start Storypane"
        message={error}
        onRetry={() => window.location.reload()}
        showSpaces={false}
      />
    );
  if (!config) return <WorkspaceLoading />;
  return config.provider === 'clerk' ? (
    <Suspense fallback={<WorkspaceLoading />}>
      <ClerkApp publishableKey={config.publishableKey!} />
    </Suspense>
  ) : (
    <AuthenticatedApp
      isLoaded
      isSignedIn
      getToken={noToken}
      signIn={<LocalSignIn passwordReset={config.passwordReset} />}
      local
    />
  );
}

export function AuthenticatedApp({
  isLoaded,
  isSignedIn,
  getToken,
  signIn,
  local,
}: {
  isLoaded: boolean;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
  signIn: ReactNode;
  local: boolean;
}) {
  const invitation =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('invite');
  const [session, setSession] = useState<
    (Omit<CMSSession, 'space'> & { space: CMSSession['space'] | null }) | null
  >(null);
  const [sessionError, setSessionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const sessionRequest = useRef(false);
  const loadSession = useCallback(async () => {
    if (sessionRequest.current) return;
    sessionRequest.current = true;
    setRetrying(true);
    try {
      const token = await getToken();
      const response = await fetch(invitation ? '/api/session' : spaceUrl('/api/session'), {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.ok) {
        setSession(await response.json());
        setSessionError('');
      } else if (response.status === 401) {
        setSession(null);
        setSessionError('');
      } else {
        const data = (await response.json()) as { error?: { message?: string } };
        setSessionError(data.error?.message ?? 'Unable to load your workspace.');
      }
    } catch {
      setSessionError('Cannot connect to the workspace. Please retry.');
    } finally {
      sessionRequest.current = false;
      setRetrying(false);
      setLoading(false);
    }
  }, [getToken, invitation]);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setSession(null);
      setSessionError('');
      setLoading(false);
      return;
    }
    void loadSession();
    const timer = setInterval(() => void loadSession(), 20_000);
    return () => clearInterval(timer);
  }, [isLoaded, isSignedIn, loadSession]);
  if (!isLoaded || (isSignedIn && loading)) return <WorkspaceLoading />;
  if (sessionError)
    return (
      <WorkspaceError
        message={sessionError}
        onRetry={() => void loadSession()}
        retrying={retrying}
      />
    );
  if (
    local &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('token')
  )
    return <main className="login-form-wrap">{signIn}</main>;
  if (invitation)
    return (
      <main className="login-form-wrap">
        <InvitationForm signedIn={Boolean(session)} local={local} signIn={signIn} />
      </main>
    );
  if (session)
    return session.space ? (
      <UploadProvider canUpload={session.space.permissions.includes('assets:write')}>
        <CMSApp session={{ ...session, space: session.space }} />
      </UploadProvider>
    ) : (
      <SpacesScreen installationAdmin={Boolean(session.installationAdmin)} />
    );
  return (
    <main className="login-shell">
      <div className="login-appearance">
        <ThemePicker />
      </div>
      <div className="login-intro">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Boxes aria-hidden="true" />
          </span>
          <span className="brand-name">
            storypane<span className="brand-period">.</span>
          </span>
        </div>
        <div className="login-story">
          <span className="eyebrow">Your content, connected</span>
          <h1>
            A space for
            <br /> every story.
          </h1>
          <p>
            Build with blocks. Create in any language.
            <br />
            Bring your next idea to life, together.
          </p>
          <div className="login-features">
            <span>
              <Layers3 />
              Flexible blocks
            </span>
            <span>
              <Globe2 />
              Every locale
            </span>
            <span>
              <History />
              Every version
            </span>
          </div>
        </div>
        <span className="login-caption">The workspace behind what’s next.</span>
      </div>
      <div className="login-form-wrap">{signIn}</div>
    </main>
  );
}
