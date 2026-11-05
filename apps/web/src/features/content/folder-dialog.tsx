'use client';

import { useState, type FormEvent } from 'react';
import { Globe2, Trash2 } from 'lucide-react';
import {
  folderPath,
  type BlockDefinition,
  type ContentFolder,
  type SpaceLocale,
} from '@storypane/core';
import { Button, ErrorNotice, Field, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest, slugify } from '../editor/api';
import { OptionInput } from '../editor/option-input';

export function FolderDialog({
  folder,
  parentId,
  folders,
  locales,
  definitions,
  onClose,
  onSaved,
}: {
  folder: ContentFolder | null;
  parentId: string | null;
  folders: ContentFolder[];
  locales: SpaceLocale[];
  definitions: BlockDefinition[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(folder?.name ?? ''),
    [slug, setSlug] = useState(folder?.slug ?? '');
  const [parent, setParent] = useState(folder ? folder.parentId : parentId);
  const [translations, setTranslations] = useState(folder?.localeSlugs ?? {});
  const [language, setLanguage] = useState('');
  const [restricted, setRestricted] = useState(!!folder?.allowedDefinitionIds.length);
  const [allowed, setAllowed] = useState(folder?.allowedDefinitionIds ?? []);
  const [defaultType, setDefaultType] = useState(folder?.defaultDefinitionId ?? '');
  const [formOnly, setFormOnly] = useState(folder?.formOnly ?? false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const contentTypes = definitions.filter((item) => item.kind !== 'nestable');
  const currentPath =
    folder && folders.some((item) => item.id === folder.id) ? folderPath(folders, folder.id) : null;
  const parents = folders.filter(
    (item) =>
      !currentPath ||
      (item.id !== folder?.id && !folderPath(folders, item.id).startsWith(currentPath + '/')),
  );
  const preview = [
    folderPath(folders, parent, language || undefined),
    (language ? translations[language] : slug) || slug,
  ]
    .filter(Boolean)
    .join('/');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (restricted && !allowed.length) {
      setError('Choose at least one allowed content type.');
      return;
    }
    setBusy(true);
    try {
      await api(
        folder ? `/folders/${folder.id}` : '/folders',
        jsonRequest(folder ? 'PUT' : 'POST', {
          name,
          slug,
          parentId: parent,
          localeSlugs: Object.fromEntries(
            Object.entries(translations).filter(([, value]) => value.trim()),
          ),
          allowedDefinitionIds: restricted ? allowed : [],
          defaultDefinitionId: defaultType || null,
          formOnly,
        }),
      );
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!folder || !window.confirm(`Delete the empty folder “${folder.name}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/folders/${folder.id}`, { method: 'DELETE' });
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
      title={folder ? 'Folder settings' : 'New folder'}
      description="Organize pages and define their URL prefix."
      className="content-folder-dialog"
    >
      <form onSubmit={submit}>
        <ErrorNotice message={error} />
        <fieldset disabled={busy} className="content-folder-fields">
          <Field label="Name" htmlFor="folder-name">
            <input
              id="folder-name"
              autoFocus
              required
              maxLength={200}
              placeholder="e.g. Courses"
              value={name}
              onChange={(event) => {
                if (slug === slugify(name)) setSlug(slugify(event.target.value));
                setName(event.target.value);
              }}
            />
          </Field>
          <div className="field">
            <div className="slug-language">
              <label htmlFor="folder-slug">Slug{!language && ' *'}</label>
              <label>
                <Globe2 aria-hidden="true" />
                <select
                  aria-label="Folder slug language"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  <option value="">Base path</option>
                  {locales
                    .filter((item) => item.slug)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <input
              id="folder-slug"
              required={!language}
              maxLength={200}
              placeholder={language ? slug : 'courses'}
              value={language ? (translations[language] ?? '') : slug}
              onChange={(event) =>
                language
                  ? setTranslations((current) => ({ ...current, [language]: event.target.value }))
                  : setSlug(event.target.value)
              }
            />
            <p className="field-hint">
              {language
                ? 'Leave blank to use the base slug.'
                : 'One URL segment. The parent folder adds its own prefix.'}
            </p>
          </div>
          <Field label="Parent folder" htmlFor="folder-parent">
            <OptionInput
              id="folder-parent"
              label="Parent folder"
              source={{
                type: 'inline',
                items: [
                  { value: 'root', label: 'Root' },
                  ...parents.map((item) => ({
                    value: item.id,
                    label: folderPath(folders, item.id),
                  })),
                ],
              }}
              value={parent ?? 'root'}
              disabled={busy}
              onChange={(value) =>
                setParent(typeof value === 'string' && value !== 'root' ? value : null)
              }
            />
          </Field>
          <p className="content-path-preview">
            <span>Folder path</span>
            <code>/{preview || '…'}/</code>
          </p>
          <fieldset className="folder-type-settings">
            <legend>Content types</legend>
            <div className="folder-radio-group">
              <label>
                <input
                  type="radio"
                  name="folder-restrictions"
                  checked={!restricted}
                  onChange={() => setRestricted(false)}
                />{' '}
                All content types
              </label>
              <label>
                <input
                  type="radio"
                  name="folder-restrictions"
                  checked={restricted}
                  onChange={() => {
                    setRestricted(true);
                    if (defaultType && !allowed.includes(defaultType)) setDefaultType('');
                  }}
                />{' '}
                Specific content types
              </label>
            </div>
            {restricted && (
              <OptionInput
                label="Allowed content types"
                source={{
                  type: 'inline',
                  items: contentTypes.map((item) => ({ value: item.id, label: item.displayName })),
                }}
                value={allowed}
                multiple
                disabled={busy}
                placeholder="Choose allowed content types…"
                onChange={(value) => {
                  const next = Array.isArray(value)
                    ? value.filter((item): item is string => typeof item === 'string')
                    : [];
                  setAllowed(next);
                  if (!next.includes(defaultType)) setDefaultType('');
                }}
              />
            )}
          </fieldset>
          <Field label="Default content type" htmlFor="folder-default">
            <OptionInput
              id="folder-default"
              label="Default content type"
              placeholder="No default"
              source={{
                type: 'inline',
                items: contentTypes
                  .filter((item) => !restricted || allowed.includes(item.id))
                  .map((item) => ({ value: item.id, label: item.displayName })),
              }}
              value={defaultType}
              disabled={busy}
              onChange={(value) => setDefaultType(typeof value === 'string' ? value : '')}
            />
          </Field>
          <label className="folder-checkbox">
            <input
              type="checkbox"
              checked={formOnly}
              onChange={(event) => setFormOnly(event.target.checked)}
            />{' '}
            Form only — disable visual preview for pages in this folder
          </label>
        </fieldset>
        <p className="field-hint">
          Moving a folder or changing its slugs updates draft URLs. Publish affected pages to update
          their public URLs.
        </p>
        <div className="dialog-actions">
          {folder && (
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 aria-hidden="true" /> Delete folder
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : folder ? 'Save folder' : 'Create folder'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
