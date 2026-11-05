'use client';

import { writeClipboardText } from '../../lib/clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { managementScopes, type ManagementScope, type ManagementToken } from '@storypane/core';
import { Button, ErrorNotice, Loading } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';

const labels: Record<ManagementScope, string> = {
  read: 'Read drafts and configuration',
  'content:edit': 'Edit content',
  'content:publish': 'Publish content',
  'assets:write': 'Manage assets',
  'schemas:write': 'Stage schema changes',
  'datasources:write': 'Manage datasources',
  'settings:write': 'Change space settings',
  admin: 'Administer members, webhooks, and migration deployment',
};

export function ManagementSettings({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [tokens, setTokens] = useState<ManagementToken[] | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ManagementScope[]>(['read']);
  const [issued, setIssued] = useState<(ManagementToken & { token: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setError('');
      setTokens(
        (await api<ManagementToken[]>('/management-tokens')).filter((token) => token.scopes),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);

  async function action(work: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel management-settings">
      <header className="panel-heading">
        <h2>
          <KeyRound aria-hidden="true" />
          Management API
        </h2>
      </header>
      <div className="panel-body">
        <p>
          Connect server code and CI with <code>@storypane/sdk/management</code> or the Storypane
          CLI. Tokens belong to this space and use your current role’s access.
        </p>
        <ErrorNotice message={error} retry={!tokens ? load : undefined} />
        {!tokens && !error && <Loading />}
        {issued && (
          <div className="notice" role="status">
            <label className="field">
              Save this token now. It will only be shown once.
              <input
                className="mono"
                readOnly
                value={issued.token}
                aria-label="New management token"
              />
            </label>
            <div className="management-token-actions">
              <Button
                onClick={() =>
                  void action(async () => {
                    await writeClipboardText(issued.token);
                    setCopied(true);
                  })
                }
                disabled={busy}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy token'}
              </Button>
              <Button onClick={() => setIssued(null)} disabled={busy}>
                Done
              </Button>
            </div>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              const token = await api<ManagementToken & { token: string }>(
                '/management-tokens',
                jsonRequest('POST', { name, scopes }),
              );
              setIssued(token);
              setCopied(false);
              setTokens((current) => [
                ...(current ?? []),
                {
                  id: token.id,
                  name: token.name,
                  capability: token.capability,
                  scopes: token.scopes,
                  createdAt: token.createdAt,
                },
              ]);
              setName('');
              setScopes(['read']);
            });
          }}
        >
          <fieldset className="space-settings-fields" disabled={busy || !!issued || !tokens}>
            <label className="field">
              Token name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Content import CI"
              />
            </label>
            <fieldset className="management-scopes">
              <legend>Permissions</legend>
              {managementScopes.map((scope) => (
                <label key={scope} className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    disabled={scope === 'read'}
                    onChange={(event) =>
                      setScopes(
                        event.target.checked
                          ? [...scopes, scope]
                          : scopes.filter((value) => value !== scope),
                      )
                    }
                  />
                  {labels[scope]}
                </label>
              ))}
            </fieldset>
            <p className="field-hint">
              Grant only the actions this integration needs. Admin permission does not include the
              other write permissions. Keep tokens in server environment variables.
            </p>
            <div>
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Create token
              </Button>
            </div>
          </fieldset>
        </form>
        {tokens?.length === 0 && <p className="field-hint">No management tokens yet.</p>}
        {tokens && tokens.length > 0 && (
          <ul className="management-token-list">
            {tokens.map((token) => (
              <li key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <p className="field-hint">
                    {token.scopes?.map((scope) => labels[scope]).join(' · ')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Revoke “${token.name}”? Integrations using it will lose access immediately.`,
                      )
                    ) {
                      return;
                    }
                    void action(async () => {
                      await api(`/management-tokens/${token.id}`, jsonRequest('DELETE', {}));
                      setTokens((current) => current?.filter((item) => item.id !== token.id) ?? []);
                      if (issued?.id === token.id) {
                        setIssued(null);
                      }
                    });
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
