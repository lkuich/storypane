'use client';
import { useState } from 'react';
import { ArrowRight, Check, LockKeyhole, UserPlus } from 'lucide-react';
import { Button, ErrorNotice } from '@storypane/ui';
import { authRequest } from './account-control';
import './invitation.css';
export function LocalSignIn({ passwordReset = false }: { passwordReset?: boolean }) {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const token = params.get('token');
  const [reset, setReset] = useState(Boolean(token)),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="panel login-card"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError('');
        try {
          if (reset) {
            await authRequest(
              token ? 'reset-password' : 'request-password-reset',
              token
                ? { token, newPassword: data.get('password') }
                : { email: data.get('email'), redirectTo: `${window.location.origin}/` },
            );
            setMessage(
              token
                ? 'Password updated. Sign in to continue.'
                : 'If this account exists, a reset link has been sent.',
            );
            if (token) window.location.assign('/');
          } else {
            await authRequest('sign-in/email', {
              email: data.get('email'),
              password: data.get('password'),
            });
            window.location.reload();
          }
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <header className="login-heading">
        <span className="login-icon" aria-hidden="true">
          <LockKeyhole />
        </span>
        <h2>{reset ? 'Reset your password' : 'Sign in'}</h2>
        <p>
          {reset
            ? 'Let’s get you back to your workspace.'
            : 'Welcome back. Your next story starts here.'}
        </p>
      </header>
      {!token && (
        <label className="field">
          Email
          <input
            name="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="username"
            required
          />
        </label>
      )}
      {(!reset || token) && (
        <label className="field">
          Password
          <input
            name="password"
            type="password"
            placeholder={reset ? 'At least 12 characters' : 'Enter your password'}
            autoComplete={reset ? 'new-password' : 'current-password'}
            minLength={reset ? 12 : undefined}
            maxLength={128}
            required
          />
        </label>
      )}
      <ErrorNotice message={error} />
      <p className="login-message" role="status">
        {message}
      </p>
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? 'Please wait…' : reset ? 'Reset password' : 'Sign in'}
        <ArrowRight aria-hidden="true" />
      </Button>
      {passwordReset && !token && (
        <Button variant="ghost" onClick={() => setReset(!reset)}>
          {reset ? 'Back to sign in' : 'Forgot password?'}
        </Button>
      )}
      {!reset && (
        <p className="muted login-note">
          Accounts are invitation only. Contact your administrator for access.
        </p>
      )}
    </form>
  );
}
export function InvitationForm({
  user,
  local,
  signIn,
}: {
  user?: { name: string; email: string };
  local: boolean;
  signIn: React.ReactNode;
}) {
  const params = new URLSearchParams(window.location.search);
  const signedIn = Boolean(user);
  const [existing, setExisting] = useState(!local),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <section className="panel invitation-card" aria-labelledby="invitation-heading">
      <header className="invitation-heading">
        <span className="invitation-icon" aria-hidden="true">
          <UserPlus />
        </span>
        <span className="eyebrow">You’re invited</span>
        <h2 id="invitation-heading">Accept invitation</h2>
        <p>
          {signedIn
            ? 'Your team has a place for you. Accept your invitation to join their workspace.'
            : existing
              ? 'Sign in with the email address that received this invitation.'
              : 'Create your account to join the workspace you’ve been invited to.'}
        </p>
      </header>
      {message && (
        <p className="notice invitation-success" role="status">
          <Check aria-hidden="true" />
          {message}
        </p>
      )}
      {existing && !signedIn ? (
        <div className="invitation-sign-in">
          {signIn}
          {local && !message && (
            <Button variant="ghost" onClick={() => setExisting(false)}>
              Create an invited account instead
            </Button>
          )}
        </div>
      ) : (
        <form
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setBusy(true);
            setError('');
            try {
              const result = await authRequest('accept-invitation', {
                spaceId: params.get('space'),
                token: params.get('invite'),
                ...(!signedIn ? { name: data.get('name'), password: data.get('password') } : {}),
              });
              if (signedIn) window.location.assign(`/?space=${params.get('space')}`);
              else {
                setMessage(`Account created for ${result.email}. Sign in to continue.`);
                history.replaceState(null, '', '/');
                setExisting(true);
              }
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {user ? (
            <div className="invitation-account">
              <span className="avatar" aria-hidden="true">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <span>Joining as</span>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
            </div>
          ) : (
            <fieldset disabled={busy} className="invitation-fields">
              <label className="field">
                Name
                <input name="name" autoComplete="name" maxLength={120} required />
              </label>
              <label className="field">
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  aria-describedby="invitation-password-hint"
                  required
                />
              </label>
              <p className="field-hint" id="invitation-password-hint">
                Use at least 12 characters.
              </p>
            </fieldset>
          )}
          <ErrorNotice message={error} />
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Joining workspace…' : 'Accept invitation'}
            <ArrowRight aria-hidden="true" />
          </Button>
          {user ? (
            <>
              <p className="invitation-account-note">
                Use the account that received this invitation.
              </p>
              <a className="invitation-back" href="/">
                Back to workspaces
              </a>
            </>
          ) : (
            <div className="invitation-existing">
              <span>Already have an account?</span>
              <Button variant="ghost" onClick={() => setExisting(true)}>
                Sign in instead
              </Button>
            </div>
          )}
        </form>
      )}
      <footer className="invitation-note">
        <LockKeyhole aria-hidden="true" />
        <span>Invitations are personal and can only be used once.</span>
      </footer>
    </section>
  );
}
