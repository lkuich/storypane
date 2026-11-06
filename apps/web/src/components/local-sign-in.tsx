'use client';
import { useState } from 'react';
import { Button, ErrorNotice } from '@storypane/ui';
import { authRequest } from './account-control';
export function LocalSignIn({ passwordReset = false }: { passwordReset?: boolean }) {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const token = params.get('token');
  const [reset, setReset] = useState(Boolean(token)),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="panel"
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
      <h2>{reset ? 'Reset your password' : 'Sign in'}</h2>
      {!token && (
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
      )}
      {(!reset || token) && (
        <label className="field">
          Password
          <input
            name="password"
            type="password"
            autoComplete={reset ? 'new-password' : 'current-password'}
            minLength={reset ? 12 : undefined}
            maxLength={128}
            required
          />
        </label>
      )}
      <ErrorNotice message={error} />
      <p role="status">{message}</p>
      <Button variant="primary" type="submit" disabled={busy}>
        {reset ? 'Reset password' : 'Sign in'}
      </Button>
      {passwordReset && !token && (
        <Button onClick={() => setReset(!reset)}>
          {reset ? 'Back to sign in' : 'Forgot password?'}
        </Button>
      )}
      {!reset && (
        <p className="muted">
          Accounts are invitation only. Contact your administrator for access.
        </p>
      )}
    </form>
  );
}
export function InvitationForm({
  signedIn,
  local,
  signIn,
}: {
  signedIn: boolean;
  local: boolean;
  signIn: React.ReactNode;
}) {
  const params = new URLSearchParams(window.location.search);
  const [existing, setExisting] = useState(!local),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  if (existing && !signedIn)
    return (
      <>
        <p role="status">{message}</p>
        {signIn}
        {local && <Button onClick={() => setExisting(false)}>Create invited account</Button>}
      </>
    );
  return (
    <form
      className="panel"
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
      <h2>Accept invitation</h2>
      <p role="status">{message}</p>
      {!signedIn && (
        <>
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
              required
            />
          </label>
        </>
      )}
      <ErrorNotice message={error} />
      <Button type="submit" variant="primary" disabled={busy}>
        Accept invitation
      </Button>
      {!signedIn && (
        <Button onClick={() => setExisting(true)}>Sign in to an existing account</Button>
      )}
    </form>
  );
}
