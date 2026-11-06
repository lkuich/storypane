'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Pin,
  Plus,
  ArrowUpRight,
  Folder,
  FolderPlus,
  FolderInput,
  ChevronRight,
  Settings2,
  Upload,
  RotateCcw,
  Copy,
  Trash2,
  X,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { PublicationStatus } from '../../components/publication-status';
import { EditorAvatars } from '../../components/editor-avatars';
import { usePageEditors } from '../editor/use-page-editors';
import { CopyableValue } from '../../components/copyable-value';
import { storyPageUrl } from './story-page-url';
import { ContentFilterBar } from './content-filter-bar';
import {
  defaultFilters,
  filterStories,
  readContentFilters,
  writeContentFilters,
  type ContentFilters,
} from './content-filters';
import {
  folderPath,
  type BlockDefinition,
  type ContentFolder,
  type UserDeliverySettings,
  type SpaceLocale,
  type Story,
  type StorySummary,
} from '@storypane/core';
import { StoryActionsDialog, type StoryActionKind } from './story-actions-dialog';
import { FolderDialog } from './folder-dialog';
import { StoryLocationDialog } from './story-location-dialog';
import { OptionInput } from '../editor/option-input';
import { Button, EmptyState, ErrorNotice, Field, Loading, Modal } from '@storypane/ui';
import { api, dateLabel, errorMessage, jsonRequest, slugify } from '../editor/api';

export function ContentList({
  canCreate,
  canPublish,
  onOpen,
  onBlocks,
}: {
  canCreate: boolean;
  canPublish: boolean;
  onOpen: (story: Story, locale?: string) => void;
  onBlocks: () => void;
}) {
  const editors = usePageEditors();
  const [deleted, setDeleted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [action, setAction] = useState<StoryActionKind | null>(null);
  const [scheduleFilter, setScheduleFilter] = useState('');
  const actionStories = useRef<Story[]>([]);
  function openAction(next: StoryActionKind) {
    actionStories.current = stories.filter((story) => selectedIds.includes(story.id));
    setAction(next);
  }
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [definitions, setDefinitions] = useState<BlockDefinition[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [locales, setLocales] = useState<SpaceLocale[]>([]);
  const [deliverySettings, setDeliverySettings] = useState<UserDeliverySettings | null>(null);
  const [folderHistory, setFolderHistory] = useState(() => ({
    entries: [
      typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('folder'),
    ],
    index: 0,
  }));
  const folderId = folderHistory.entries[folderHistory.index];
  const [editingFolder, setEditingFolder] = useState<ContentFolder | null | undefined>(undefined);
  const [locationStory, setLocationStory] = useState<StorySummary | null>(null);
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [filters, setFilters] = useState(() =>
    readContentFilters(
      new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search),
    ),
  );
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const [content, schemas, availableFolders, availableLocales, settings] = await Promise.all([
          api<StorySummary[]>(`/stories${deleted ? '?deleted=true' : ''}`),
          api<BlockDefinition[]>('/definitions?deployed=true'),
          api<ContentFolder[]>('/folders'),
          api<SpaceLocale[]>('/locales'),
          api<UserDeliverySettings>('/delivery-settings'),
        ]);
        setStories(content);
        setDefinitions(schemas);
        setFolders(availableFolders);
        setLocales(availableLocales);
        setDeliverySettings(settings);
        const currentFolder = new URLSearchParams(window.location.search).get('folder');
        if (currentFolder && !availableFolders.some((item) => item.id === currentFolder)) {
          setFolderHistory({ entries: [null], index: 0 });
          setSelectedIds([]);
          const url = new URL(window.location.href);
          url.searchParams.delete('folder');
          window.history.replaceState(window.history.state, '', url);
        }
      } catch (error) {
        setError(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [deleted],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const currentFolder = folders.find((item) => item.id === folderId);
  const destination = folders.find((item) => item.id === createFolderId);
  const contentTypes = definitions.filter(
    (definition) =>
      definition.kind !== 'nestable' &&
      (!destination?.allowedDefinitionIds.length ||
        destination.allowedDefinitionIds.includes(definition.id)),
  );
  const searching = !!filters.query.trim();
  const scopedStories = searching
    ? stories
    : stories.filter((story) => (story.folderId ?? null) === (currentFolder?.id ?? null));
  const filtered = filterStories(scopedStories, filters).filter(
    (story) =>
      !scheduleFilter || story.schedules?.some((schedule) => schedule.status === scheduleFilter),
  );
  const trail: ContentFolder[] = [];
  for (
    let item = currentFolder;
    item;
    item = folders.find((parent) => parent.id === item?.parentId)
  )
    trail.unshift(item);
  const children = folders.filter(
    (item) =>
      item.parentId === (currentFolder?.id ?? null) &&
      `${item.name} ${folderPath(folders, item.id)}`
        .toLowerCase()
        .includes(filters.query.trim().toLowerCase()),
  );
  const hasFilters = !!(
    filters.query.trim() ||
    filters.status ||
    filters.modified ||
    filters.modifiedBy ||
    filters.contentType ||
    scheduleFilter
  );
  function changeFilters(next: ContentFilters) {
    if (!!next.query.trim() !== searching) setSelectedIds([]);
    setFilters(next);
    const url = new URL(window.location.href);
    writeContentFilters(url.searchParams, next);
    window.history.replaceState(window.history.state, '', url);
  }
  function openFolder(id: string | null, index?: number) {
    if (id === folderId) return;
    setSelectedIds([]);
    setFolderHistory((current) =>
      index === undefined
        ? {
            entries: [...current.entries.slice(0, current.index + 1), id],
            index: current.index + 1,
          }
        : { ...current, index },
    );
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('folder', id);
    else url.searchParams.delete('folder');
    window.history.replaceState(window.history.state, '', url);
  }
  async function togglePin(story: StorySummary, button: HTMLButtonElement) {
    if (pinningId) return;
    setPinningId(story.id);
    setError(null);
    try {
      const { pinned } = await api<{ pinned: boolean }>(`/stories/${story.id}/pin`, {
        method: story.pinned ? 'DELETE' : 'PUT',
      });
      const keepFocus = document.activeElement === button;
      setStories((current) =>
        current.map((item) => (item.id === story.id ? { ...item, pinned } : item)),
      );
      if (keepFocus)
        requestAnimationFrame(() => {
          if (button.isConnected && document.activeElement === document.body)
            button.focus({ preventScroll: true });
        });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPinningId(null);
    }
  }
  function openCreate() {
    if (!canCreate) return;
    setName('');
    setSlug('');
    setCreateFolderId(currentFolder?.id ?? null);
    setDefinitionId(
      currentFolder?.defaultDefinitionId ??
        definitions.find(
          (item) =>
            item.kind !== 'nestable' &&
            (!currentFolder?.allowedDefinitionIds.length ||
              currentFolder.allowedDefinitionIds.includes(item.id)),
        )?.id ??
        '',
    );
    setCreateError(null);
    setCreating(true);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      const story = await api<Story>(
        '/stories',
        jsonRequest('POST', { name, slug, definitionId, folderId: createFolderId }),
      );
      setCreating(false);
      onOpen(story);
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Content</h1>
          <p>Create, organize, and publish your stories.</p>
        </div>
        <div className="button-group">
          <Button onClick={() => setEditingFolder(null)} disabled={loading || !canCreate}>
            <FolderPlus aria-hidden="true" /> New folder
          </Button>
          <Button variant="primary" onClick={openCreate} disabled={loading || !canCreate}>
            <Plus /> New story
          </Button>
        </div>
      </div>
      <ErrorNotice message={error} retry={() => void load()} />
      <nav className="content-folder-breadcrumbs" aria-label="Content folders">
        <div className="content-folder-history" role="group" aria-label="Folder navigation">
          <Button
            className="button--small"
            disabled={loading || folderHistory.index === 0}
            onClick={() =>
              openFolder(folderHistory.entries[folderHistory.index - 1], folderHistory.index - 1)
            }
          >
            <ArrowLeft aria-hidden="true" /> Back
          </Button>
          <Button
            className="button--small"
            disabled={loading || folderHistory.index === folderHistory.entries.length - 1}
            onClick={() =>
              openFolder(folderHistory.entries[folderHistory.index + 1], folderHistory.index + 1)
            }
          >
            Forward <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        <button onClick={() => openFolder(null)} aria-current={!currentFolder ? 'page' : undefined}>
          Root
        </button>
        {trail.map((item) => (
          <span key={item.id}>
            <ChevronRight aria-hidden="true" />
            <button
              onClick={() => openFolder(item.id)}
              aria-current={item.id === folderId ? 'page' : undefined}
            >
              {item.name}
            </button>
          </span>
        ))}
        {currentFolder && canCreate && (
          <Button
            variant="ghost"
            className="button--small"
            onClick={() => setEditingFolder(currentFolder)}
          >
            <Settings2 aria-hidden="true" /> Folder settings
          </Button>
        )}
      </nav>
      <ContentFilterBar
        filters={filters}
        onChange={changeFilters}
        stories={scopedStories}
        count={filtered.length}
        loading={loading}
        deleted={deleted}
        onToggleDeleted={() => {
          setDeleted((value) => !value);
          setScheduleFilter('');
          setSelectedIds([]);
        }}
        scheduleFilter={scheduleFilter}
        onScheduleChange={setScheduleFilter}
      />
      {!!selectedIds.length && (
        <div className="content-bulk-actions" role="group" aria-label="Selected story actions">
          <span className="content-selection-count" title="Select up to 50 stories">
            {selectedIds.length} selected
          </span>
          {deleted ? (
            canCreate && (
              <Button onClick={() => openAction('restore')}>
                <RotateCcw aria-hidden="true" /> Restore
              </Button>
            )
          ) : (
            <>
              {canPublish && (
                <>
                  <Button onClick={() => openAction('publish')}>
                    <Upload aria-hidden="true" /> Publish
                  </Button>
                  <Button onClick={() => openAction('unpublish')}>
                    <RotateCcw aria-hidden="true" /> Unpublish
                  </Button>
                </>
              )}
              {canCreate && (
                <>
                  <Button onClick={() => openAction('duplicate')}>
                    <Copy aria-hidden="true" /> Duplicate
                  </Button>
                  <Button onClick={() => openAction('move')}>
                    <FolderInput aria-hidden="true" /> Move
                  </Button>
                  <Button variant="danger" onClick={() => openAction('delete')}>
                    <Trash2 aria-hidden="true" /> Delete
                  </Button>
                </>
              )}
            </>
          )}
          <Button onClick={() => setSelectedIds([])}>
            <X aria-hidden="true" /> Clear selection
          </Button>
        </div>
      )}
      {!!children.length && (
        <section className="content-folders" aria-label="Folders">
          {children.map((item) => (
            <div className="content-folder-card" key={item.id}>
              <button className="content-folder-open" onClick={() => openFolder(item.id)}>
                <Folder aria-hidden="true" />
                <span>
                  <strong>{item.name}</strong>
                  <small>/{folderPath(folders, item.id)}/</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
              {canCreate && (
                <Button
                  variant="ghost"
                  className="icon-button"
                  aria-label={`Edit folder ${item.name}`}
                  onClick={() => setEditingFolder(item)}
                >
                  <Settings2 aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      <div className="panel">
        {loading ? (
          <Loading label="Loading your stories…" />
        ) : filtered.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select up to 50 visible stories"
                        checked={
                          !!filtered.length &&
                          filtered.slice(0, 50).every((story) => selectedIds.includes(story.id))
                        }
                        onChange={(event) =>
                          setSelectedIds(
                            event.target.checked
                              ? filtered.slice(0, 50).map((story) => story.id)
                              : [],
                          )
                        }
                      />
                    </th>
                    <th>Story</th>
                    <th>Status</th>
                    <th className="table-mobile-hide">Path</th>
                    <th>Page ID</th>
                    <th>Last modified</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((story) => (
                    <tr key={story.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${story.name}`}
                          checked={selectedIds.includes(story.id)}
                          disabled={!selectedIds.includes(story.id) && selectedIds.length >= 50}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked
                                ? [...current, story.id]
                                : current.filter((id) => id !== story.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <div className="entity-name">
                          <button
                            type="button"
                            disabled={deleted}
                            className="entity-icon story-pin"
                            aria-label={`Pin ${story.name} for yourself`}
                            aria-pressed={story.pinned}
                            aria-busy={pinningId === story.id}
                            aria-disabled={pinningId !== null}
                            title={
                              story.pinned ? 'Unpin from your list' : 'Pin to the top of your list'
                            }
                            onClick={(event) => void togglePin(story, event.currentTarget)}
                          >
                            <Pin aria-hidden="true" />
                          </button>
                          <div>
                            <div className="content-story-title">
                              <button
                                disabled={deleted}
                                className="entity-title"
                                onClick={() => onOpen(story)}
                              >
                                {story.name}
                              </button>
                              {story.pinned && (
                                <span className="story-pinned-label">Pinned for you</span>
                              )}
                            </div>
                            <div className="content-editors">
                              <EditorAvatars editors={editors[story.id] ?? []} />
                              <span className="entity-subtitle">
                                {story.contentType?.name ?? 'Story'}
                                {editors[story.id]?.length ? ' · Editing now' : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="publication-cell">
                        <PublicationStatus status={story.publicationStatus} />
                        {story.schedules
                          ?.filter(
                            (schedule) =>
                              schedule.status === 'pending' || schedule.status === 'failed',
                          )
                          .slice(0, 3)
                          .map((schedule) => (
                            <div className="entity-subtitle" key={schedule.id}>
                              {schedule.releaseStatus === 'held'
                                ? 'Release needs attention'
                                : schedule.releaseName}{' '}
                              · revision {schedule.checkpointRevision} · {dateLabel(schedule.dueAt)}
                            </div>
                          ))}
                        <div className="entity-subtitle">
                          {story.publicationStatus === 'draft'
                            ? 'Not published'
                            : story.publicationStatus === 'changed'
                              ? `${story.pendingLocaleCount} of ${story.localeCount} locales pending`
                              : 'All locales published'}
                        </div>
                        {!!story.pendingLocales?.length && (
                          <div
                            className="pending-locale-links"
                            aria-label={`Unpublished locales for ${story.name}`}
                          >
                            {story.pendingLocales.map((locale) => (
                              <button
                                key={locale.id}
                                type="button"
                                onClick={() => onOpen(story, locale.slug)}
                                aria-label={`Open ${story.name} in ${locale.name} to review unpublished changes`}
                              >
                                {locale.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="table-mobile-hide">
                        <CopyableValue
                          key={story.path ?? story.slug}
                          label="Path"
                          value={story.path ?? `/${story.slug}`}
                          name={story.name}
                          showLabel={false}
                          href={
                            deleted
                              ? undefined
                              : storyPageUrl(deliverySettings, story.path ?? `/${story.slug}`)
                          }
                        />
                      </td>
                      <td>
                        <CopyableValue
                          value={story.id}
                          label="Page ID"
                          name={story.name}
                          showLabel={false}
                        />
                      </td>
                      <td>
                        <span className="small muted">{dateLabel(story.updatedAt)}</span>
                        <div className="entity-subtitle">
                          {story.modifiedBy?.name ?? 'Unknown editor'}
                        </div>
                      </td>
                      <td>
                        <div className="content-row-actions">
                          {canCreate && !deleted && (
                            <Button
                              variant="ghost"
                              className="icon-button"
                              aria-label={`Edit location of ${story.name}`}
                              title="Folder and translated slugs"
                              onClick={() => setLocationStory(story)}
                            >
                              <FolderInput aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            className="icon-button"
                            disabled={deleted}
                            aria-label={`Open ${story.name}`}
                            onClick={() => onOpen(story)}
                          >
                            <ArrowUpRight />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-count">
              {filtered.length} {filtered.length === 1 ? 'story' : 'stories'}
              {searching
                ? ' matching across all folders'
                : hasFilters
                  ? ' matching your filters in this folder'
                  : ' in this folder'}
            </div>
          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'No matching stories' : 'This folder has no stories yet'}
            action={
              hasFilters ? (
                <Button
                  onClick={() => {
                    changeFilters({ ...defaultFilters, sort: filters.sort });
                    setScheduleFilter('');
                  }}
                >
                  Clear search and filters
                </Button>
              ) : (
                <Button onClick={openCreate} disabled={!canCreate}>
                  <Plus /> Create story
                </Button>
              )
            }
          >
            {hasFilters
              ? 'Try another search or remove a filter to see more stories.'
              : 'Create a page, add your blocks, and bring your content together.'}
          </EmptyState>
        )}
      </div>
      {action && (
        <StoryActionsDialog
          stories={actionStories.current}
          action={action}
          onClose={() => setAction(null)}
          onComplete={(ids) => {
            setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
            void load(true);
          }}
        />
      )}
      {editingFolder !== undefined && (
        <FolderDialog
          key={editingFolder?.id ?? 'new'}
          folder={editingFolder}
          parentId={currentFolder?.id ?? null}
          folders={folders}
          locales={locales}
          definitions={definitions}
          onClose={() => setEditingFolder(undefined)}
          onSaved={() => load(true)}
        />
      )}
      {locationStory && (
        <StoryLocationDialog
          key={locationStory.id}
          story={locationStory}
          folders={folders}
          onClose={() => setLocationStory(null)}
          onSaved={() => load(true)}
        />
      )}
      <Modal
        open={creating}
        onClose={() => !busy && setCreating(false)}
        title="Create a story"
        description="Choose a content type to give your story its structure."
      >
        {contentTypes.length ? (
          <form onSubmit={create}>
            <ErrorNotice message={createError} />
            <Field label="Folder" htmlFor="story-folder">
              <OptionInput
                id="story-folder"
                label="Story folder"
                source={{
                  type: 'inline',
                  items: [
                    { value: 'root', label: 'Root' },
                    ...folders.map((item) => ({
                      value: item.id,
                      label: folderPath(folders, item.id),
                    })),
                  ],
                }}
                value={createFolderId ?? 'root'}
                disabled={busy}
                onChange={(value) => {
                  const id = typeof value === 'string' && value !== 'root' ? value : null;
                  setCreateFolderId(id);
                  const target = folders.find((item) => item.id === id);
                  setDefinitionId(
                    target?.defaultDefinitionId ??
                      definitions.find(
                        (item) =>
                          item.kind !== 'nestable' &&
                          (!target?.allowedDefinitionIds.length ||
                            target.allowedDefinitionIds.includes(item.id)),
                      )?.id ??
                      '',
                  );
                }}
              />
            </Field>
            <Field label="Name" htmlFor="story-name">
              <input
                id="story-name"
                autoFocus
                required
                maxLength={200}
                placeholder="e.g. Home"
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  if (slug === slugify(name)) setSlug(slugify(value));
                  setName(value);
                }}
              />
            </Field>
            <Field
              label="URL slug"
              htmlFor="story-slug"
              description={`Draft path: /${[folderPath(folders, createFolderId), slug || '…'].filter(Boolean).join('/')}`}
            >
              <input
                id="story-slug"
                required
                maxLength={200}
                placeholder="home"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </Field>
            <Field label="Content type" htmlFor="story-type">
              <select
                id="story-type"
                required
                value={definitionId}
                onChange={(event) => setDefinitionId(event.target.value)}
              >
                {contentTypes.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <div className="dialog-actions">
              <Button onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create story'}
              </Button>
            </div>
          </form>
        ) : (
          <EmptyState
            title="Create a content type first"
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setCreating(false);
                  onBlocks();
                }}
              >
                Open block library
              </Button>
            }
          >
            A content type defines the fields and blocks that a story can contain.
          </EmptyState>
        )}
      </Modal>
    </>
  );
}
