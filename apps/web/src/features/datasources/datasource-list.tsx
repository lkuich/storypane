"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Database, Plus, Search, Trash2 } from "lucide-react";
import {
  datasourceInputSchema,
  type Datasource,
  type OptionItem,
} from "@storypane/core";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Modal,
} from "@storypane/ui";
import { api, errorMessage, jsonRequest, slugify } from "../editor/api";

export function DatasourceList({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Datasource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Datasource | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [entries, setEntries] = useState<OptionItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api<Datasource[]>("/datasources"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  function edit(source: Datasource | null) {
    setEditing(source);
    setName(source?.name ?? "");
    setSlug(source?.slug ?? "");
    setEntries(
      source?.items.map((item) => ({ ...item })) ?? [{ label: "", value: "" }],
    );
    setFormError(null);
    setOpen(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = datasourceInputSchema.safeParse({
      name,
      slug,
      items: entries,
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues.map((issue) => issue.message).join(". "),
      );
      return;
    }
    setBusy(true);
    try {
      await api(
        editing ? `/datasources/${editing.id}` : "/datasources",
        jsonRequest(editing ? "PUT" : "POST", parsed.data),
      );
      setOpen(false);
      await load();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const filtered = items.filter((item) =>
    `${item.name} ${item.slug}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          
          <h1>Datasources</h1>
          <p>Manage reusable choices in one place.</p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => edit(null)}>
            <Plus /> New datasource
          </Button>
        )}
      </div>
      <ErrorNotice message={error} retry={() => void load()} />
      <div className="toolbar">
        <div className="search-input">
          <Search />
          <input
            type="search"
            aria-label="Search datasources"
            placeholder="Search datasources…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="small muted">{items.length} datasources</span>
      </div>
      <div className="panel">
        {loading ? (
          <Loading />
        ) : filtered.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Datasource</th>
                <th>Entries</th>
                <th>Slug</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="entity-name">
                      <span className="entity-icon">
                        <Database />
                      </span>
                      <button
                        className="entity-title"
                        onClick={() => edit(item)}
                      >
                        {item.name}
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className="pill">{item.items.length} choices</span>
                  </td>
                  <td className="mono">{item.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title={
              search ? "No matching datasources" : "One list. Many places."
            }
            action={
              canManage &&
              !search && (
                <Button onClick={() => edit(null)}>
                  <Plus /> Create a datasource
                </Button>
              )
            }
          >
            Keep categories, colors, and other shared choices consistent across
            your stories.
          </EmptyState>
        )}
      </div>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={editing ? editing.name : "New datasource"}
        description="Each choice has a label for editors and a stable value stored in content."
      >
        <form onSubmit={save}>
          <ErrorNotice message={formError} />
          <fieldset
            disabled={!canManage || busy}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <Field label="Name" htmlFor="datasource-name">
              <input
                id="datasource-name"
                required
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  if (slug === slugify(name)) setSlug(slugify(value));
                  setName(value);
                }}
              />
            </Field>
            <Field label="Slug" htmlFor="datasource-slug">
              <input
                id="datasource-slug"
                required
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </Field>
            <div className="field-label" style={{ marginBottom: 8 }}>
              Choices
            </div>
            {entries.map((entry, index) => (
              <div className="key-value-grid" key={index}>
                <input
                  aria-label={`Choice ${index + 1} label`}
                  placeholder="Label"
                  required
                  value={entry.label}
                  onChange={(event) =>
                    setEntries(
                      entries.map((item, i) =>
                        i === index
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Choice ${index + 1} value`}
                  placeholder="Value"
                  required
                  value={entry.value}
                  onChange={(event) =>
                    setEntries(
                      entries.map((item, i) =>
                        i === index
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  className="icon-button"
                  aria-label={`Remove choice ${index + 1}`}
                  onClick={() =>
                    setEntries(entries.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              onClick={() => setEntries([...entries, { label: "", value: "" }])}
            >
              <Plus /> Add choice
            </Button>
          </fieldset>
          <div className="dialog-actions">
            <Button onClick={() => setOpen(false)} disabled={busy}>
              {canManage ? "Cancel" : "Close"}
            </Button>
            {canManage && (
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save datasource"}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}
