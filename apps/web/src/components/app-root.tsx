'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LocalSignIn, InvitationForm } from './local-sign-in';
import type { AuthConfig } from '@storypane/db/authentication';
import { AccountContext, authRequest } from './account-control';
import { Button } from '@storypane/ui';
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
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/auth/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load authentication.');
        const value = (await response.json()) as NonNullable<typeof config>;
        if (value.provider === 'clerk' && !value.publishableKey)
          throw new Error('Clerk is not configured for this server.');
        if (value.provider === 'redirect' && !/^\/api\/auth\/[a-z0-9/-]+$/.test(value.signInPath))
          throw new Error('The sign-in path must be a local authentication route.');
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
  if (config.provider === 'redirect') {
    return (
      <AccountContext.Provider value={<ProviderAccount />}>
        <AuthenticatedApp
          isLoaded
          isSignedIn
          getToken={noToken}
          local={false}
          signIn={
            <div className="panel login-card">
              <header className="login-heading">
                <h2>Sign in</h2>
                <p>Welcome back. Continue to your workspace.</p>
              </header>
              <Button
                variant="primary"
                onClick={() => window.location.assign(config.signInPath + window.location.search)}
              >
                Continue with {config.name}
              </Button>
            </div>
          }
        />
      </AccountContext.Provider>
    );
  }
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

function ProviderAccount() {
  const [error, setError] = useState('');
  return (
    <div>
      <Button
        onClick={async () => {
          try {
            await authRequest('sign-out', {});
            window.location.assign('/');
          } catch {
            setError('Unable to sign out. Please retry.');
          }
        }}
      >
        Sign out
      </Button>
      {error && <span role="alert">{error}</span>}
    </div>
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
  if (session && !invitation)
    return session.space ? (
      <UploadProvider canUpload={session.space.permissions.includes('assets:write')}>
        <CMSApp session={{ ...session, space: session.space }} />
      </UploadProvider>
    ) : (
      <SpacesScreen installationAdmin={Boolean(session.installationAdmin)} />
    );
  return (
    <main className={`login-shell${invitation ? ' invitation-shell' : ''}`}>
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
          <span className="eyebrow">
            {invitation ? 'A place for your team' : 'Your content, connected'}
          </span>
          <h1>
            {invitation ? (
              <>
                Good stories
                <br /> start together.
              </>
            ) : (
              <>
                A space for
                <br /> <span>every story.</span>
              </>
            )}
          </h1>
          <p>
            {invitation ? (
              'Join your team’s workspace to shape ideas, review changes, and keep content moving.'
            ) : (
              <>
                Build with blocks. Create in any language.
                <br />
                Bring your next idea to life, together.
              </>
            )}
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
      <div className="login-form-wrap">
        {invitation ? (
          <InvitationForm user={session?.user} local={local} signIn={signIn} />
        ) : (
          signIn
        )}
      </div>
    </main>
  );
}
