'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SpaceConnection } from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { Copy, Database, Eye, EyeOff } from 'lucide-react';
import { writeClipboardText } from '../../lib/clipboard';
import { errorMessage, jsonRequest, requestJson } from '../editor/api';

export function DatabaseSettings({
  spaceId,
  onBusy,
}: {
  spaceId: string;
  onBusy: (busy: boolean) => void;
}) {
  const [connection, setConnection] = useState<SpaceConnection | null>(null);
  const [error, setError] = useState('');
  const [revealedUrl, setRevealedUrl] = useState(''),
    [copyStatus, setCopyStatus] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [editing, setEditing] = useState(false),
    [saving, setSaving] = useState(false);
  const [connectionString, setConnectionString] = useState(''),
    [formError, setFormError] = useState('');
  const load = useCallback(async () => {
    setError('');
    setRevealedUrl('');
    setCopyStatus('');
    try {
      setConnection(await requestJson<SpaceConnection>(`/api/spaces/${spaceId}/connection`));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [spaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    onBusy(saving);
    return () => onBusy(false);
  }, [saving, onBusy]);
  async function accessFullUrl(action: 'reveal' | 'copy') {
    setFetchingUrl(true);
    setError('');
    setCopyStatus('');
    try {
      const result = await requestJson<SpaceConnection>(
        `/api/spaces/${spaceId}/connection`,
        jsonRequest('POST', {}),
      );
      if (!result.url) throw new Error('No database connection saved.');
      if (action === 'reveal') setRevealedUrl(result.url);
      else {
        try {
          await writeClipboardText(result.url);
          setCopyStatus('Full URL copied');
        } catch {
          setError('Could not copy. Reveal the URL to copy it manually.');
        }
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setFetchingUrl(false);
    }
  }
  function close() {
    if (!saving) {
      setEditing(false);
      setConnectionString('');
    }
  }
  return (
    <section className="panel database-settings">
      <header className="panel-heading">
        <h2>
          <Database aria-hidden="true" />
          Database connection
        </h2>
      </header>
      <div className="panel-body">
        <ErrorNotice message={error} retry={load} />
        {!connection && !error && <Loading label="Loading database connection…" />}
        {connection && (
          <>
            <p role="status">
              {connection.url ? 'Database configured.' : 'No database connection saved.'}{' '}
              {connection.status === 'ready'
                ? 'Ready.'
                : connection.status === 'failed'
                  ? 'Provisioning failed.'
                  : 'Provisioning in progress.'}
            </p>
            {connection.url && (
              <div className="database-connection-details">
                <label className="field">
                  Saved database URL
                  <input
                    className="mono"
                    readOnly
                    autoComplete="off"
                    spellCheck={false}
                    value={revealedUrl || connection.url}
                  />
                </label>
                <div className="button-group database-url-actions">
                  <Button
                    disabled={fetchingUrl}
                    onClick={() => {
                      if (revealedUrl) setRevealedUrl('');
                      else void accessFullUrl('reveal');
                    }}
                  >
                    {revealedUrl ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    {revealedUrl ? 'Hide password' : 'Reveal full URL'}
                  </Button>
                  <Button disabled={fetchingUrl} onClick={() => void accessFullUrl('copy')}>
                    <Copy aria-hidden="true" />
                    Copy full URL
                  </Button>
                  <span role="status">{copyStatus}</span>
                </div>
              </div>
            )}
            {connection.url && connection.status === 'ready' && (
              <div className="database-connection-update">
                <div>
                  <h3>Update connection</h3>
                  <p>Replace the saved credentials for this space’s database.</p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setConnectionString('');
                    setFormError('');
                    setEditing(true);
                  }}
                >
                  Update database connection
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Modal
        open={editing}
        onClose={close}
        title="Update database connection"
        description="Replace the saved connection with dedicated credentials for this space’s database."
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setFormError('');
            try {
              await requestJson(
                '/api/spaces',
                jsonRequest('PUT', { id: spaceId, connectionString }),
              );
              setEditing(false);
              setConnectionString('');
              await load();
            } catch (cause) {
              setFormError(errorMessage(cause));
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="field">
            Database connection URL
            <input
              type="password"
              autoComplete="off"
              required
              value={connectionString}
              onChange={(event) => setConnectionString(event.target.value)}
              placeholder="postgresql://role:password@host/database"
            />
          </label>
          <ErrorNotice message={formError} />
          <div className="dialog-actions">
            <Button disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving || !connectionString.trim()}>
              {saving ? 'Saving…' : 'Update connection'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
