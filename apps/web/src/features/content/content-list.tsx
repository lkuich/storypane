"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pin, Plus, ArrowUpRight, Folder, FolderPlus, FolderInput, ChevronRight, Settings2 } from "lucide-react";
import { PublicationStatus } from "../../components/publication-status";
import { EditorAvatars } from "../../components/editor-avatars";
import { usePageEditors } from "../editor/use-page-editors";
import { PageId } from "../../components/page-id";
import { ContentFilterBar } from "./content-filter-bar";
import { defaultFilters, filterStories, readContentFilters, writeContentFilters, type ContentFilters } from "./content-filters";
import { folderPath, type BlockDefinition, type ContentFolder, type SpaceLocale, type Story, type StorySummary } from "@storypane/core";
import { FolderDialog } from "./folder-dialog";
import { StoryLocationDialog } from "./story-location-dialog";
import { OptionInput } from "../editor/option-input";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Modal,
} from "@storypane/ui";
import {
  api,
  dateLabel,
  errorMessage,
  jsonRequest,
  slugify,
} from "../editor/api";

export function ContentList({
  canCreate,
  onOpen,
  onBlocks,
}: {
  canCreate: boolean;
  onOpen: (story: Story,locale?:string) => void;
  onBlocks: () => void;
}) {
  const editors = usePageEditors();
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [definitions, setDefinitions] = useState<BlockDefinition[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [locales, setLocales] = useState<SpaceLocale[]>([]);
  const [folderId, setFolderId] = useState<string | null>(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('folder'));
  const [editingFolder, setEditingFolder] = useState<ContentFolder | null | undefined>(undefined);
  const [locationStory, setLocationStory] = useState<StorySummary | null>(null);
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [filters, setFilters] = useState(() => readContentFilters(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [definitionId, setDefinitionId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [content, schemas, availableFolders, availableLocales] = await Promise.all([
        api<StorySummary[]>("/stories"),
        api<BlockDefinition[]>("/definitions?deployed=true"),
        api<ContentFolder[]>("/folders"),
        api<SpaceLocale[]>("/locales"),
      ]);
      setStories(content);
      setDefinitions(schemas);
      setFolders(availableFolders);
      setLocales(availableLocales);
      const currentFolder = new URLSearchParams(window.location.search).get('folder');
      if (currentFolder && !availableFolders.some(item => item.id === currentFolder)) {
        setFolderId(null);
        const url = new URL(window.location.href); url.searchParams.delete('folder'); window.history.replaceState(window.history.state, '', url);
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const currentFolder = folders.find(item => item.id === folderId);
  const destination = folders.find(item => item.id === createFolderId);
  const contentTypes = definitions.filter(definition => definition.kind !== "nestable" && (!destination?.allowedDefinitionIds.length || destination.allowedDefinitionIds.includes(definition.id)));
  const scopedFolders = currentFolder ? folders.filter(item => item.id === folderId || folderPath(folders,item.id).startsWith(folderPath(folders,folderId)+'/')) : folders;
  const scopedStories = currentFolder ? stories.filter(story => scopedFolders.some(item => item.id === story.folderId)) : stories;
  const filtered = filterStories(scopedStories, filters);
  const trail: ContentFolder[] = [];
  for (let item = currentFolder; item; item = folders.find(parent => parent.id === item?.parentId)) trail.unshift(item);
  const children = folders.filter(item => item.parentId === (currentFolder?.id ?? null) && `${item.name} ${folderPath(folders,item.id)}`.toLowerCase().includes(filters.query.trim().toLowerCase()));
  const hasFilters = !!(filters.query.trim() || filters.status || filters.modified || filters.modifiedBy || filters.contentType);
  function changeFilters(next: ContentFilters) {
    setFilters(next);
    const url = new URL(window.location.href);
    writeContentFilters(url.searchParams, next);
    window.history.replaceState(window.history.state, "", url);
  }
  function openFolder(id: string | null) {
    setFolderId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('folder',id); else url.searchParams.delete('folder');
    window.history.replaceState(window.history.state,'',url);
  }
  async function togglePin(story: StorySummary, button: HTMLButtonElement) {
    if (pinningId) return;
    setPinningId(story.id);
    setError(null);
    try {
      const { pinned } = await api<{ pinned: boolean }>(`/stories/${story.id}/pin`, { method: story.pinned ? "DELETE" : "PUT" });
      const keepFocus = document.activeElement === button;
      setStories(current => current.map(item => item.id === story.id ? { ...item, pinned } : item));
      if (keepFocus) requestAnimationFrame(() => {
        if (button.isConnected && document.activeElement === document.body) button.focus({ preventScroll: true });
      });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPinningId(null);
    }
  }
  function openCreate() {
    if (!canCreate) return;
    setName("");
    setSlug("");
    setCreateFolderId(currentFolder?.id ?? null);
    setDefinitionId(currentFolder?.defaultDefinitionId ?? definitions.find(item => item.kind !== 'nestable' && (!currentFolder?.allowedDefinitionIds.length || currentFolder.allowedDefinitionIds.includes(item.id)))?.id ?? '');
    setCreateError(null);
    setCreating(true);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      const story = await api<Story>(
        "/stories",
        jsonRequest("POST", { name, slug, definitionId, folderId: createFolderId }),
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
        <div className="button-group"><Button onClick={() => setEditingFolder(null)} disabled={loading || !canCreate}><FolderPlus aria-hidden="true" /> New folder</Button><Button variant="primary" onClick={openCreate} disabled={loading || !canCreate}>
          <Plus /> New story
        </Button></div>
      </div>
      <ErrorNotice message={error} retry={() => void load()} />
      <nav className="content-folder-breadcrumbs" aria-label="Content folders"><button onClick={() => openFolder(null)} aria-current={!currentFolder ? 'page' : undefined}>All content</button>{trail.map(item => <span key={item.id}><ChevronRight aria-hidden="true" /><button onClick={() => openFolder(item.id)} aria-current={item.id === folderId ? 'page' : undefined}>{item.name}</button></span>)}{currentFolder && canCreate && <Button variant="ghost" className="button--small" onClick={() => setEditingFolder(currentFolder)}><Settings2 aria-hidden="true" /> Folder settings</Button>}</nav>
      <ContentFilterBar filters={filters} onChange={changeFilters} stories={scopedStories} count={filtered.length} loading={loading} />
      {!!children.length && <section className="content-folders" aria-label="Folders">{children.map(item => <div className="content-folder-card" key={item.id}><button className="content-folder-open" onClick={() => openFolder(item.id)}><Folder aria-hidden="true" /><span><strong>{item.name}</strong><small>/{folderPath(folders,item.id)}/</small></span><ChevronRight aria-hidden="true" /></button>{canCreate && <Button variant="ghost" className="icon-button" aria-label={`Edit folder ${item.name}`} onClick={() => setEditingFolder(item)}><Settings2 aria-hidden="true" /></Button>}</div>)}</section>}
      <div className="panel">
        {loading ? (
          <Loading label="Loading your stories…" />
        ) : filtered.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
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
                        <div className="entity-name">
                          <button type="button" className="entity-icon story-pin" aria-label={`Pin ${story.name} for yourself`} aria-pressed={story.pinned} aria-busy={pinningId === story.id} aria-disabled={pinningId !== null} title={story.pinned ? "Unpin from your list" : "Pin to the top of your list"} onClick={event => void togglePin(story, event.currentTarget)}>
                            <Pin aria-hidden="true" />
                          </button>
                          <div>
                            <div className="content-story-title">
                            <button
                              className="entity-title"
                              onClick={() => onOpen(story)}
                            >
                              {story.name}
                            </button>
                            {story.pinned && <span className="story-pinned-label">Pinned for you</span>}
                            </div>
                            <div className="content-editors"><EditorAvatars editors={editors[story.id] ?? []} /><span className="entity-subtitle">{story.contentType?.name ?? "Story"}{editors[story.id]?.length ? " · Editing now" : ""}</span></div>
                          </div>
                        </div>
                      </td>
                      <td className="publication-cell"><PublicationStatus status={story.publicationStatus} /><div className="entity-subtitle">{story.publicationStatus === 'draft' ? 'Not published' : story.publicationStatus === 'changed' ? `${story.pendingLocaleCount} of ${story.localeCount} locales pending` : 'All locales published'}</div>
                        {!!story.pendingLocales?.length && <div className="pending-locale-links" aria-label={`Unpublished locales for ${story.name}`}>{story.pendingLocales.map(locale=><button key={locale.id} type="button" onClick={()=>onOpen(story,locale.slug)} aria-label={`Open ${story.name} in ${locale.name} to review unpublished changes`}>{locale.name}</button>)}</div>}
                      </td>
                      <td className="mono table-mobile-hide">/{story.slug}</td>
                      <td><PageId id={story.id} name={story.name} showLabel={false} /></td>
                      <td>
                        <span className="small muted">
                          {dateLabel(story.updatedAt)}
                        </span>
                        <div className="entity-subtitle">{story.modifiedBy?.name ?? "Unknown editor"}</div>
                      </td>
                      <td>
                        <div className="content-row-actions">
                        {canCreate && <Button variant="ghost" className="icon-button" aria-label={`Edit location of ${story.name}`} title="Folder and translated slugs" onClick={() => setLocationStory(story)}><FolderInput aria-hidden="true" /></Button>}
                        <Button
                          variant="ghost"
                          className="icon-button"
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
              {filtered.length} {filtered.length === 1 ? "story" : "stories"}
              {hasFilters ? " matching your filters" : currentFolder ? " in this folder and its subfolders" : " in this space"}
            </div>
          </>
        ) : (
          <EmptyState
            title={hasFilters ? "No matching stories" : currentFolder ? "This folder has no pages yet" : "Start with a story"}
            action={
              hasFilters ? <Button onClick={() => changeFilters({ ...defaultFilters, sort: filters.sort })}>Clear search and filters</Button> : (
                <Button onClick={openCreate} disabled={!canCreate}>
                  <Plus /> Create your first story
                </Button>
              )
            }
          >
            {hasFilters
              ? "Try another search or remove a filter to see more stories."
              : "Create a page, add your blocks, and bring your content together."}
          </EmptyState>
        )}
      </div>
      {editingFolder !== undefined && <FolderDialog key={editingFolder?.id ?? 'new'} folder={editingFolder} parentId={currentFolder?.id ?? null} folders={folders} locales={locales} definitions={definitions} onClose={() => setEditingFolder(undefined)} onSaved={() => load(true)} />}
      {locationStory && <StoryLocationDialog key={locationStory.id} story={locationStory} folders={folders} onClose={() => setLocationStory(null)} onSaved={() => load(true)} />}
      <Modal
        open={creating}
        onClose={() => !busy && setCreating(false)}
        title="Create a story"
        description="Choose a content type to give your story its structure."
      >
        {contentTypes.length ? (
          <form onSubmit={create}>
            <ErrorNotice message={createError} />
            <Field label="Folder" htmlFor="story-folder"><OptionInput id="story-folder" label="Story folder" source={{type:'inline',items:[{value:'root',label:'Root'},...folders.map(item => ({value:item.id,label:folderPath(folders,item.id)}))]}} value={createFolderId ?? 'root'} disabled={busy} onChange={value => {
              const id = typeof value === 'string' && value !== 'root' ? value : null;
              setCreateFolderId(id);
              const target = folders.find(item => item.id === id);
              setDefinitionId(target?.defaultDefinitionId ?? definitions.find(item => item.kind !== 'nestable' && (!target?.allowedDefinitionIds.length || target.allowedDefinitionIds.includes(item.id)))?.id ?? '');
            }} /></Field>
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
              description={`Draft path: /${[folderPath(folders,createFolderId),slug || '…'].filter(Boolean).join('/')}`}
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
                {busy ? "Creating…" : "Create story"}
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
            A content type defines the fields and blocks that a story can
            contain.
          </EmptyState>
        )}
      </Modal>
    </>
  );
}
