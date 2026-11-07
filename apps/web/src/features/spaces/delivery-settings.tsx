'use client';
import { useCallback, useEffect, useState } from 'react';
import { Code2, KeyRound, Plus, Trash2 } from 'lucide-react';
import type {
  DeliverySettings as Settings,
  UserDeliverySettings,
  DeliveryToken,
} from '@storypane/core';
import { Button, ErrorNotice, Loading } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';
import { PublicMediaSettings } from './public-media-settings';

export function DeliverySettings({
  canManage,
  isAdmin,
  onDirty,
  onBusy,
}: {
  canManage: boolean;
  isAdmin: boolean;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
}) {
  const [settings, setSettings] = useState<UserDeliverySettings | null>(null),
    [previewUrls, setPreviewUrls] = useState<Settings['previewUrls']>([]),
    [defaultPreviewId, setDefaultPreviewId] = useState<string | null>(null),
    [personalDefaultPreviewId, setPersonalDefaultPreviewId] = useState<string | null>(null),
    [blockPreviews, setBlockPreviews] = useState(true),
    [parameter, setParameter] = useState('storypane_preview');
  const [tokens, setTokens] = useState<DeliveryToken[]>([]),
    [tokenName, setTokenName] = useState(''),
    [scope, setScope] = useState<'published' | 'preview'>('published');
  const [revealed, setRevealed] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const [mediaDirty, setMediaDirty] = useState(false),
    [mediaBusy, setMediaBusy] = useState(false);
  const sharedDirty =
    !!settings &&
    (JSON.stringify(previewUrls) !== JSON.stringify(settings.previewUrls) ||
      defaultPreviewId !== settings.defaultPreviewId ||
      parameter !== settings.previewParameter);
  const previewDirty =
    sharedDirty ||
    (!!settings &&
      (personalDefaultPreviewId !== settings.personalDefaultPreviewId ||
        blockPreviews !== settings.blockPreviews));
  const dirty = mediaDirty || previewDirty;
  function changeUrls(next: Settings['previewUrls']) {
    setPreviewUrls(next);
    setDefaultPreviewId((current) =>
      next.some((item) => item.id === current) ? current : (next[0]?.id ?? null),
    );
    setPersonalDefaultPreviewId((current) =>
      next.some((item) => item.id === current) ? current : null,
    );
    setSaved(false);
  }
  const load = useCallback(async () => {
    setError('');
    try {
      const [value, keys] = await Promise.all([
        api<UserDeliverySettings>('/delivery-settings'),
        canManage ? api<DeliveryToken[]>('/delivery-tokens') : Promise.resolve([]),
      ]);
      setSettings(value);
      setPreviewUrls(value.previewUrls);
      setDefaultPreviewId(value.defaultPreviewId);
      setPersonalDefaultPreviewId(value.personalDefaultPreviewId);
      setBlockPreviews(value.blockPreviews);
      setParameter(value.previewParameter);
      setTokens(keys);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [canManage]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(busy || mediaBusy);
    return () => onBusy(false);
  }, [busy, mediaBusy, onBusy]);
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
    <section className="panel delivery-settings">
      <header className="panel-heading">
        <h2>
          <Code2 aria-hidden="true" />
          API & preview
        </h2>
      </header>
      <div className="panel-body">
        <ErrorNotice message={error} retry={!settings ? load : undefined} />
        {!settings ? (
          !error && <Loading />
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  let value = settings;
                  if (sharedDirty) {
                    const shared = await api<Settings>(
                      '/delivery-settings',
                      jsonRequest('PUT', {
                        previewUrls,
                        defaultPreviewId,
                        previewParameter: parameter,
                      }),
                    );
                    value = {
                      ...shared,
                      blockPreviews: value.blockPreviews,
                      personalDefaultPreviewId: shared.previewUrls.some(
                        (item) => item.id === value.personalDefaultPreviewId,
                      )
                        ? value.personalDefaultPreviewId
                        : null,
                    };
                    setSettings(value);
                    setPreviewUrls(value.previewUrls);
                    setDefaultPreviewId(value.defaultPreviewId);
                    setParameter(value.previewParameter);
                  }
                  if (
                    personalDefaultPreviewId !== value.personalDefaultPreviewId ||
                    blockPreviews !== value.blockPreviews
                  ) {
                    const personal = await api<{
                      previewId: string | null;
                      blockPreviews: boolean;
                    }>(
                      '/delivery-settings/personal-default',
                      jsonRequest('PUT', { previewId: personalDefaultPreviewId, blockPreviews }),
                    );
                    setSettings({
                      ...value,
                      personalDefaultPreviewId: personal.previewId,
                      blockPreviews: personal.blockPreviews,
                    });
                  }
                  setSaved(true);
                });
              }}
            >
              <fieldset className="space-settings-fields" disabled={!canManage || busy}>
                <div className="preview-urls-heading">
                  <div>
                    <h3>Preview URLs</h3>
                    <p className="field-hint">
                      The space default applies to everyone without a personal default. You can
                      switch apps in the preview editor.
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      disabled={previewUrls.length >= 20}
                      onClick={() =>
                        changeUrls([...previewUrls, { id: crypto.randomUUID(), name: '', url: '' }])
                      }
                    >
                      <Plus />
                      Add preview URL
                    </Button>
                  )}
                </div>
                {!previewUrls.length && (
                  <p className="preview-urls-empty">No preview URLs configured yet.</p>
                )}
                <div className="preview-url-list">
                  {previewUrls.map((target, index) => (
                    <div
                      className="preview-url-card"
                      role="group"
                      aria-label={`Preview URL ${index + 1}`}
                      key={target.id}
                    >
                      <div className="preview-url-heading">
                        <label className="checkbox-field">
                          <input
                            type="radio"
                            name="default-preview"
                            aria-label={`Use preview ${index + 1} as space default`}
                            checked={defaultPreviewId === target.id}
                            onChange={() => {
                              setDefaultPreviewId(target.id);
                              setSaved(false);
                            }}
                          />
                          {defaultPreviewId === target.id
                            ? 'Space default'
                            : 'Set as space default'}
                        </label>
                        {canManage && (
                          <Button
                            variant="ghost"
                            className="icon-button"
                            aria-label={`Remove preview ${index + 1}`}
                            onClick={() =>
                              changeUrls(previewUrls.filter((item) => item.id !== target.id))
                            }
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                      <label className="field">
                        Preview name
                        <input
                          value={target.name}
                          onChange={(event) =>
                            changeUrls(
                              previewUrls.map((item) =>
                                item.id === target.id
                                  ? { ...item, name: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          placeholder="e.g. Production, Staging, Local"
                          required
                          maxLength={80}
                        />
                      </label>
                      <label className="field">
                        Application preview URL
                        <input
                          value={target.url}
                          onChange={(event) =>
                            changeUrls(
                              previewUrls.map((item) =>
                                item.id === target.id ? { ...item, url: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="https://your-app.com/{locale}/{slug}"
                          required
                          maxLength={2048}
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <p className="field-hint">
                  Use {'{slug}'} and {'{locale}'} for the current page. Localhost HTTP is supported
                  for development. Each app must allow this CMS to embed it.
                </p>
                <label className="field">
                  Preview URL parameter
                  <input
                    aria-label="Preview URL parameter"
                    value={parameter}
                    onChange={(event) => {
                      setParameter(event.target.value);
                      setSaved(false);
                    }}
                    required
                    pattern="[a-zA-Z][a-zA-Z0-9_-]{0,63}"
                  />
                  <span className="field-hint">
                    The editor adds this parameter with a value of 1. Match it in your SDK preview
                    configuration.
                  </span>
                </label>
              </fieldset>
              <label className="field">
                My default preview
                <select
                  aria-label="My default preview"
                  aria-describedby="personal-preview-hint"
                  value={personalDefaultPreviewId ?? ''}
                  disabled={busy || !previewUrls.length}
                  onChange={(event) => {
                    setPersonalDefaultPreviewId(event.target.value || null);
                    setSaved(false);
                  }}
                >
                  <option value="">Use space default</option>
                  {previewUrls.map((target, index) => (
                    <option key={target.id} value={target.id}>
                      {target.name || `Preview ${index + 1}`}
                    </option>
                  ))}
                </select>
                <span className="field-hint" id="personal-preview-hint">
                  Only affects you in this space, on every browser you sign in with.
                </span>
              </label>
              <label className="checkbox-field block-preview-setting">
                <input
                  type="checkbox"
                  checked={blockPreviews}
                  disabled={busy}
                  onChange={(event) => {
                    setBlockPreviews(event.target.checked);
                    setSaved(false);
                  }}
                  aria-label="Show block hover previews"
                  aria-describedby="block-previews-hint"
                />
                <span>
                  Show block hover previews
                  <small className="field-hint" id="block-previews-hint">
                    Load app previews when hovering over blocks, breadcrumbs, and the block picker.
                    Turn off for lighter editing. Only affects you in this space; the main preview
                    stays available.
                  </small>
                </span>
              </label>
              <div className="space-settings-actions">
                <span role="status">{saved ? 'Preview settings saved' : ''}</span>
                <Button type="submit" disabled={!previewDirty || busy}>
                  Save preview settings
                </Button>
              </div>
            </form>
            <PublicMediaSettings
              canManage={isAdmin}
              onDirty={setMediaDirty}
              onBusy={setMediaBusy}
            />
            {canManage && (
              <section className="settings-subsection" aria-labelledby="access-tokens-heading">
                <h3 id="access-tokens-heading">
                  <KeyRound size={16} aria-hidden="true" /> Access tokens
                </h3>
                <p className="small">
                  Published tokens read published content. Preview tokens can create draft preview
                  sessions and must stay on your app server.
                </p>
                {revealed && (
                  <label className="field">
                    New token — copy it now
                    <input
                      aria-label="New token — copy it now"
                      className="mono"
                      readOnly
                      value={revealed}
                      onFocus={(event) => event.target.select()}
                    />
                    <span className="field-hint">The full token is shown only once.</span>
                  </label>
                )}
                <form
                  className="delivery-token-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () => {
                      const result = await api<DeliveryToken & { token: string }>(
                        '/delivery-tokens',
                        jsonRequest('POST', { name: tokenName, scope }),
                      );
                      setTokens((current) => [...current, result]);
                      setRevealed(result.token);
                      setTokenName('');
                    });
                  }}
                >
                  <label className="field">
                    Token name
                    <input
                      value={tokenName}
                      onChange={(event) => setTokenName(event.target.value)}
                      placeholder="Marketing website"
                      required
                      maxLength={80}
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    Access
                    <select
                      value={scope}
                      onChange={(event) => setScope(event.target.value as typeof scope)}
                      disabled={busy}
                    >
                      <option value="published">Published content</option>
                      <option value="preview">Preview · server only</option>
                    </select>
                  </label>
                  <Button type="submit" disabled={busy || !tokenName.trim()}>
                    <Plus />
                    Create token
                  </Button>
                </form>
                <ul className="delivery-token-list">
                  {tokens.map((token) => (
                    <li key={token.id}>
                      <div>
                        <strong>{token.name}</strong>
                        <span>
                          {token.scope === 'preview'
                            ? 'Preview · server only'
                            : 'Published content'}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Revoke ${token.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke “${token.name}”? Apps using it will lose access.`,
                            )
                          )
                            void action(async () => {
                              await api(`/delivery-tokens/${token.id}`, { method: 'DELETE' });
                              setTokens((current) =>
                                current.filter((item) => item.id !== token.id),
                              );
                              setRevealed('');
                            });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
