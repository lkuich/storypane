'use client';

import { useEffect, useState } from 'react';
import { Button, ErrorNotice, Loading } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';

export function PublicMediaSettings({
  canManage,
  onDirty,
  onBusy,
}: {
  canManage: boolean;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<{ enabled: boolean }>('/public-media')
      .then((value) => {
        if (active) {
          setSaved(value.enabled);
          setEnabled(value.enabled);
        }
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    onDirty(saved !== null && saved !== enabled);
    return () => onDirty(false);
  }, [saved, enabled, onDirty]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  return (
    <section
      className="settings-subsection public-media-settings"
      aria-labelledby="public-media-heading"
    >
      <h3 id="public-media-heading">Public media delivery</h3>
      <p className="field-hint">
        Allow websites to use media URLs without a token. Only assets referenced by published
        content become public. Draft-only assets stay private.
      </p>
      <ErrorNotice
        message={error}
        retry={
          saved === null
            ? () => {
                setError('');
                setAttempt((value) => value + 1);
              }
            : undefined
        }
      />
      {saved === null ? (
        !error && <Loading />
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setNotice('');
            try {
              const value = await api<{ enabled: boolean }>(
                '/public-media',
                jsonRequest('PUT', { enabled }),
              );
              setSaved(value.enabled);
              setNotice('Public media settings saved');
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canManage || busy}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setNotice('');
              }}
            />
            Enable public URLs for published media
          </label>
          <p className="field-hint">
            Disabling stops future requests. Media already downloaded or exported by a website
            cannot be recalled.
          </p>
          {!canManage && (
            <p className="field-hint">Only administrators can change public media access.</p>
          )}
          <div className="space-settings-actions">
            <span role="status">{notice}</span>
            {canManage && (
              <Button type="submit" disabled={busy || saved === enabled}>
                Save media settings
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
