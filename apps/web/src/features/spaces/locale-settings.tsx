'use client';
import { useEffect, useState } from 'react';
import { ExternalLink, Globe2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { SpaceLocale, SpaceLocaleDeletionReview } from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { ApiError, api, errorMessage, jsonRequest } from '../editor/api';
import { spaceUrl } from '../../lib/space-url';

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
  const [removing, setRemoving] = useState<SpaceLocale | null>(null),
    [review, setReview] = useState<SpaceLocaleDeletionReview | null>(null),
    [deleteContent, setDeleteContent] = useState(false),
    [deleteError, setDeleteError] = useState('');
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
  async function reviewDeletion(locale: SpaceLocale) {
    setRemoving(locale);
    setReview(null);
    setDeleteContent(false);
    setDeleteError('');
    setBusy(true);
    try {
      setReview(await api<SpaceLocaleDeletionReview>(`/locales/${locale.id}/deletion-review`));
    } catch (cause) {
      setDeleteError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
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
                              disabled={busy}
                              title={`Remove ${locale.name}`}
                              onClick={() => void reviewDeletion(locale)}
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
        Default always uses an empty slug and cannot be removed. Removing another locale lets you
        review and delete its story content too.
      </p>
      <Modal
        open={removing !== null}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? 'locale'}?`}
        description="The stories and their other locales will remain. Deleting this locale's content is permanent."
        className="locale-deletion"
      >
        <ErrorNotice
          message={deleteError}
          retry={!busy && removing ? () => reviewDeletion(removing) : undefined}
        />
        {!review && busy && <Loading label="Checking locale content…" />}
        {review && (
          <>
            {review.stories.length ? (
              <>
                <p>
                  {review.stories.length}{' '}
                  {review.stories.length === 1 ? 'story has' : 'stories have'} content in this
                  locale. Open a story to review it before deleting.
                </p>
                <ul className="locale-deletion-stories" aria-label="Affected stories">
                  {review.stories.map((story) => (
                    <li key={story.localeId}>
                      <div>
                        {story.deleted ? (
                          <strong>{story.name}</strong>
                        ) : (
                          <a
                            href={spaceUrl(
                              `/?story=${story.id}&locale=${encodeURIComponent(review.locale.slug)}`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {story.name}
                            <ExternalLink aria-label="Opens in a new tab" />
                          </a>
                        )}
                        <code>
                          /{review.locale.slug}/{story.urlSlug}
                        </code>
                      </div>
                      <span className="muted">
                        {story.deleted ? 'Deleted story' : story.published ? 'Published' : 'Draft'}
                        {story.scheduled ? ' · Scheduled' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {review.stories.some((story) => story.published || story.scheduled) && (
                  <p className="notice">
                    Published content in this locale will be removed from delivery and its schedules
                    cancelled. Links to these locale URLs may stop working. Rebuild your site after
                    deleting.
                  </p>
                )}
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={deleteContent}
                    disabled={busy}
                    onChange={(event) => setDeleteContent(event.target.checked)}
                  />
                  Delete this locale’s content and revision history from all {review.stories.length}{' '}
                  {review.stories.length === 1 ? 'story' : 'stories'}
                </label>
              </>
            ) : (
              <p>This locale has no story content and can be removed.</p>
            )}
          </>
        )}
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || !review || (!!review.stories.length && !deleteContent)}
            onClick={async () => {
              if (!review) return;
              setBusy(true);
              setDeleteError('');
              try {
                await api(
                  `/locales/${review.locale.id}`,
                  jsonRequest('DELETE', { deleteContent, reviewToken: review.token }),
                );
                setRemoving(null);
                await load();
              } catch (cause) {
                setDeleteError(errorMessage(cause));
                if (cause instanceof ApiError && cause.code === 'stale_revision') {
                  setReview(null);
                  setDeleteContent(false);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && review
              ? 'Removing…'
              : review?.stories.length
                ? 'Delete locale and content'
                : 'Remove locale'}
          </Button>
        </div>
      </Modal>
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
