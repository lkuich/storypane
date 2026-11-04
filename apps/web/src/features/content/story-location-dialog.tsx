'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  folderPath,
  type ContentFolder,
  type StorySummary,
  type StoryLocale,
} from '@storypane/core';
import { Button, ErrorNotice, Field, Loading, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';
import { OptionInput } from '../editor/option-input';

export function StoryLocationDialog({
  story,
  folders,
  onClose,
  onSaved,
}: {
  story: StorySummary;
  folders: ContentFolder[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [folderId, setFolderId] = useState(story.folderId ?? null),
    [slug, setSlug] = useState(story.slugSegment ?? story.slug);
  const [locales, setLocales] = useState<StoryLocale[]>([]),
    [translations, setTranslations] = useState<Record<string, string>>({}),
    [language, setLanguage] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError(null);
    void api<StoryLocale[]>(`/stories/${story.id}/locales`)
      .then((items) => {
        if (!stopped) {
          setLocales(items);
          setTranslations(
            Object.fromEntries(
              items
                .filter((item) => item.slug)
                .map((item) => [item.spaceLocaleId, item.slugSegment ?? item.urlSlug]),
            ),
          );
        }
      })
      .catch((cause) => {
        if (!stopped) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [story.id, attempt]);
  const available = folders.filter(
    (folder) =>
      !folder.allowedDefinitionIds.length ||
      (story.contentType && folder.allowedDefinitionIds.includes(story.contentType.id)),
  );
  const preview = [
    folderPath(folders, folderId, language || undefined),
    language ? translations[language] : slug,
  ]
    .filter(Boolean)
    .join('/');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(
        `/stories/${story.id}/location`,
        jsonRequest('PUT', { folderId, slug, localeSlugs: translations }),
      );
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      closeOnBackdrop
      title={`Page location · ${story.name}`}
      description="Move the page and translate its URL. Published URLs stay unchanged until you republish."
    >
      <ErrorNotice
        message={error}
        retry={!locales.length ? () => setAttempt((value) => value + 1) : undefined}
      />
      {loading ? (
        <Loading />
      ) : (
        !!locales.length && (
          <form onSubmit={submit}>
            <Field label="Folder" htmlFor="page-folder">
              <OptionInput
                id="page-folder"
                label="Page folder"
                source={{
                  type: 'inline',
                  items: [
                    { value: 'root', label: 'Root' },
                    ...available.map((folder) => ({
                      value: folder.id,
                      label: folderPath(folders, folder.id),
                    })),
                  ],
                }}
                value={folderId ?? 'root'}
                disabled={busy}
                onChange={(value) =>
                  setFolderId(typeof value === 'string' && value !== 'root' ? value : null)
                }
              />
            </Field>
            <Field label="Language" htmlFor="page-path-language">
              <select
                id="page-path-language"
                disabled={busy}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="">Default</option>
                {locales
                  .filter((item) => item.slug)
                  .map((item) => (
                    <option key={item.id} value={item.spaceLocaleId}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label="Page slug"
              htmlFor="page-slug"
              description="Relative to the folder. Its translated prefix is added automatically."
            >
              <input
                id="page-slug"
                disabled={busy}
                required
                maxLength={200}
                value={language ? (translations[language] ?? '') : slug}
                onChange={(event) =>
                  language
                    ? setTranslations((current) => ({ ...current, [language]: event.target.value }))
                    : setSlug(event.target.value)
                }
              />
            </Field>
            <p className="content-path-preview">
              <span>Draft path</span>
              <code>/{preview}</code>
            </p>
            <div className="dialog-actions">
              <Button disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save location'}
              </Button>
            </div>
          </form>
        )
      )}
    </Modal>
  );
}
