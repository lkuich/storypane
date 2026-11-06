'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Button, Modal, ErrorNotice } from '@storypane/ui';
export const AccountContext = createContext<ReactNode>(null);
export function AccountControl() {
  const supplied = useContext(AccountContext);
  return supplied ?? <LocalAccountControl />;
}
export async function authRequest(path: string, body: unknown) {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as {
    error?: { message?: string };
    message?: string;
    email?: string;
  };
  if (!response.ok)
    throw new Error(result.error?.message ?? result.message ?? 'Unable to complete authentication');
  return result;
}
function LocalAccountControl() {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Account</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Your account">
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setBusy(true);
            setError('');
            try {
              await authRequest('change-password', {
                currentPassword: data.get('currentPassword'),
                newPassword: data.get('newPassword'),
                revokeOtherSessions: true,
              });
              setOpen(false);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <ErrorNotice message={error} />
          <div className="dialog-actions">
            <Button type="submit" disabled={busy}>
              Change password
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await authRequest('sign-out', {});
                  window.location.assign('/');
                } catch (cause) {
                  setError((cause as Error).message);
                  setBusy(false);
                }
              }}
            >
              Sign out
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
