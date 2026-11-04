'use client';
import { useEffect, useState } from 'react';
import { Globe2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { SpaceLocale } from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';

export function LocaleSettings({
  canManage,
  onDirty,
  onBusy,
}: {
  canManage: boolean;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
}) {
  const [locales, setLocales] = useState<SpaceLocale[] | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SpaceLocale | 'new' | null>(null),
    [name, setName] = useState(''),
    [slug, setSlug] = useState(''),
    [formError, setFormError] = useState('');
  const dirty =
    editing !== null &&
    (editing === 'new' ? !!(name || slug) : name !== editing.name || slug !== editing.slug);
  async function load() {
    setError('');
    try {
      setLocales(await api<SpaceLocale[]>('/locales'));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  function edit(locale: SpaceLocale | 'new') {
    setEditing(locale);
    setName(locale === 'new' ? '' : locale.name);
    setSlug(locale === 'new' ? '' : locale.slug);
    setFormError('');
  }
  function close() {
    if (!busy && (!dirty || window.confirm('Discard unsaved locale settings?'))) setEditing(null);
  }
  return (
    <section className="panel locale-settings" aria-label="Space locales">
      <header className="panel-heading">
        <h2>
          <Globe2 aria-hidden="true" />
          Locales
        </h2>
        {canManage && (
          <Button className="button--small" onClick={() => edit('new')} disabled={busy || !locales}>
            <Plus />
            Add locale
          </Button>
        )}
      </header>
      <div className="locale-settings-intro">
        <p>
          Choose the locales available on every story. Each locale has its own content and URL
          prefix.
        </p>
        <ErrorNotice message={error} retry={load} />
      </div>
      {!locales ? (
        !error && <Loading label="Loading locales…" />
      ) : (
        <div className="table-wrap">
          <table className="data-table" aria-label="Configured locales">
            <thead>
              <tr>
                <th>Locale</th>
                <th>URL prefix</th>
                <th>Stories</th>
                {canManage && (
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {locales.map((locale) => (
                <tr key={locale.id}>
                  <td>
                    <strong>{locale.name}</strong>
                    {locale.slug === '' && (
                      <span className="locale-default-label">Default locale</span>
                    )}
                  </td>
                  <td>
                    <code>{locale.slug ? `/${locale.slug}` : '/'}</code>
                    {locale.slug === '' && <span className="locale-default-label">Empty slug</span>}
                  </td>
                  <td>{locale.storyCount}</td>
                  {canManage && (
                    <td>
                      <div className="locale-row-actions">
                        {locale.slug !== '' && (
                          <>
                            <Button
                              variant="ghost"
                              className="icon-button"
                              aria-label={`Edit ${locale.name}`}
                              onClick={() => edit(locale)}
                              disabled={busy}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              className="icon-button"
                              aria-label={`Remove ${locale.name}`}
                              disabled={busy || locale.storyCount > 0}
                              title={
                                locale.storyCount
                                  ? 'Locales with story content cannot be removed'
                                  : `Remove ${locale.name}`
                              }
                              onClick={async () => {
                                if (!window.confirm(`Remove “${locale.name}” from this space?`))
                                  return;
                                setBusy(true);
                                setError('');
                                try {
                                  await api(`/locales/${locale.id}`, { method: 'DELETE' });
                                  await load();
                                } catch (cause) {
                                  setError(errorMessage(cause));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="locale-settings-note">
        Default always uses an empty slug. Locales with story content can be renamed, but cannot be
        removed.
      </p>
      <Modal
        open={editing !== null}
        onClose={close}
        title={editing === 'new' ? 'Add a locale' : 'Edit locale'}
        description="This locale is available across the entire space. Story content stays independent."
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!editing) return;
            setBusy(true);
            setFormError('');
            try {
              await api(
                editing === 'new' ? '/locales' : `/locales/${editing.id}`,
                jsonRequest(editing === 'new' ? 'POST' : 'PUT', { name, slug }),
              );
              setEditing(null);
              await load();
            } catch (cause) {
              setFormError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorNotice message={formError} />
          <label className="field">
            Locale name
            <input
              aria-label="Locale name"
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              placeholder="French (Canada)"
            />
          </label>
          <label className="field">
            Locale slug
            <input
              aria-label="Locale slug"
              required
              maxLength={30}
              pattern="[a-zA-Z0-9][a-zA-Z0-9-]*"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={busy}
              placeholder="fr-CA"
            />
            <span className="field-hint">
              URL prefix, for example <code>/{slug || 'fr-CA'}/home</code>. Use letters, numbers,
              and hyphens.
            </span>
          </label>
          {editing && editing !== 'new' && (
            <p className="notice">
              Changing the slug updates this locale across all stories. Rebuild your site and update
              any links that use the old prefix.
            </p>
          )}
          <div className="dialog-actions">
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !dirty || !name.trim() || !slug.trim()}
            >
              {busy ? 'Saving…' : editing === 'new' ? 'Add locale' : 'Save locale'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
