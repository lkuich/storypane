"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Plus, Search, ArrowUpRight } from "lucide-react";
import type { BlockDefinition, Story } from "@blok/core";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Modal,
} from "@blok/ui";
import {
  api,
  dateLabel,
  errorMessage,
  jsonRequest,
  slugify,
} from "../editor/api";

export function ContentList({
  onOpen,
  onBlocks,
}: {
  onOpen: (story: Story) => void;
  onBlocks: () => void;
}) {
  const [stories, setStories] = useState<Story[]>([]);
  const [definitions, setDefinitions] = useState<BlockDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [definitionId, setDefinitionId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [content, schemas] = await Promise.all([
        api<Story[]>("/stories"),
        api<BlockDefinition[]>("/definitions"),
      ]);
      setStories(content);
      setDefinitions(schemas);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const contentTypes = definitions.filter(
    (definition) => definition.kind !== "nestable",
  );
  const filtered = stories.filter((story) =>
    `${story.name} ${story.slug}`.toLowerCase().includes(search.toLowerCase()),
  );
  function openCreate() {
    setName("");
    setSlug("");
    setDefinitionId(contentTypes[0]?.id ?? "");
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
        jsonRequest("POST", { name, slug, definitionId }),
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
        <Button variant="primary" onClick={openCreate} disabled={loading}>
          <Plus /> New story
        </Button>
      </div>
      <ErrorNotice message={error} retry={() => void load()} />
      <div className="toolbar">
        <div className="search-input">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Search stories"
            placeholder="Search stories…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="small muted">
          {stories.length} {stories.length === 1 ? "story" : "stories"}
        </span>
      </div>
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
                    <th className="table-mobile-hide">Path</th>
                    <th>Last edited</th>
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
                          <span className="entity-icon">
                            <FileText />
                          </span>
                          <div>
                            <button
                              className="entity-title"
                              onClick={() => onOpen(story)}
                            >
                              {story.name}
                            </button>
                            <div className="entity-subtitle">Story</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono table-mobile-hide">/{story.slug}</td>
                      <td>
                        <span className="small muted">
                          {dateLabel(story.updatedAt)}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          className="icon-button"
                          aria-label={`Open ${story.name}`}
                          onClick={() => onOpen(story)}
                        >
                          <ArrowUpRight />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-count">
              {filtered.length} {filtered.length === 1 ? "story" : "stories"}
              {search ? " matching your search" : " in this space"}
            </div>
          </>
        ) : (
          <EmptyState
            title={search ? "No matching stories" : "Start with a story"}
            action={
              !search && (
                <Button onClick={openCreate}>
                  <Plus /> Create your first story
                </Button>
              )
            }
          >
            {search
              ? "Try a different name or path."
              : "Create a page, add your blocks, and bring your content together."}
          </EmptyState>
        )}
      </div>
      <Modal
        open={creating}
        onClose={() => !busy && setCreating(false)}
        title="Create a story"
        description="Choose a content type to give your story its structure."
      >
        {contentTypes.length ? (
          <form onSubmit={create}>
            <ErrorNotice message={createError} />
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
              description="A path for this story, separate from its locale."
            >
              <input
                id="story-slug"
                required
                pattern="[a-z0-9][a-z0-9\-/]*"
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
