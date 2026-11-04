"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Box,
  Layers,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  definitionInputSchema,
  type BlockDefinition,
  type Datasource,
  type DefinitionInput,
  type FieldDefinition,
} from "@blok/core";
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
  fieldName,
  jsonRequest,
} from "../editor/api";
import type { RegisterGuard } from "../editor/navigation";
import { FIELD_TYPES, FieldSettings, newField } from "./field-settings";

const kindLabels = {
  nestable: "Nestable",
  "content-type": "Content type",
  universal: "Universal",
};
const emptyDefinition: DefinitionInput = {
  name: "",
  displayName: "",
  kind: "nestable",
  fields: [],
};

export function SchemaLibrary({
  canManage,
  registerGuard,
}: {
  canManage: boolean;
  registerGuard: RegisterGuard;
}) {
  const [definitions, setDefinitions] = useState<BlockDefinition[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<DefinitionInput | null>(null);
  const [original, setOriginal] = useState<BlockDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedField, setSelectedField] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<FieldDefinition["type"]>("text");
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [blocks, sources] = await Promise.all([
        api<BlockDefinition[]>("/definitions"),
        api<Datasource[]>("/datasources"),
      ]);
      setDefinitions(blocks);
      setDatasources(sources);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    registerGuard(
      () => !dirty || window.confirm("Discard your unsaved schema changes?"),
    );
    return () => registerGuard(null);
  }, [dirty, registerGuard]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function open(definition: BlockDefinition | null) {
    setOriginal(definition);
    setDraft(
      definition
        ? structuredClone({
            name: definition.name,
            displayName: definition.displayName,
            kind: definition.kind,
            fields: definition.fields,
          })
        : structuredClone(emptyDefinition),
    );
    setDirty(false);
    setSaved(false);
    setSelectedField(0);
    setError(null);
  }
  function change(next: DefinitionInput) {
    setDraft(next);
    setDirty(true);
    setSaved(false);
  }
  async function save() {
    if (!draft) return;
    const parsed = definitionInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(". "),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<BlockDefinition>(
        original ? `/definitions/${original.id}/versions` : "/definitions",
        jsonRequest("POST", parsed.data),
      );
      setOriginal(result);
      setDirty(false);
      setSaved(true);
      setDefinitions(await api<BlockDefinition[]>("/definitions"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function addField(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const field = newField(newType, newName, newLabel);
    change({ ...draft, fields: [...draft.fields, field] });
    setSelectedField(draft.fields.length);
    setAddingField(false);
  }
  function reorder(delta: number) {
    if (!draft) return;
    const fields = [...draft.fields];
    const destination = selectedField + delta;
    if (destination < 0 || destination >= fields.length) return;
    [fields[selectedField], fields[destination]] = [
      fields[destination]!,
      fields[selectedField]!,
    ];
    change({ ...draft, fields });
    setSelectedField(destination);
  }
  const filtered = definitions.filter((item) =>
    `${item.name} ${item.displayName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const field = draft?.fields[selectedField];
  return (
    <>
      {draft ? (
        <>
          <Button
            variant="ghost"
            className="back-button"
            onClick={() => {
              if (
                !dirty ||
                window.confirm("Discard your unsaved schema changes?")
              ) {
                setDraft(null);
                setDirty(false);
                setError(null);
              }
            }}
          >
            <ArrowLeft /> Block library
          </Button>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                Block definition
                {original ? ` · version ${original.version}` : ""}
              </div>
              <h1>{draft.displayName || "New block"}</h1>
              <p>Give your content a thoughtful structure.</p>
            </div>
            <div className="button-group">
              <span className="schema-status" role="status">
                {dirty ? "Unsaved changes" : saved ? "Version saved" : ""}
              </span>
              {canManage && (
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={busy || (!!original && !dirty)}
                >
                  {busy
                    ? "Saving…"
                    : original
                      ? "Save new version"
                      : "Create block"}
                </Button>
              )}
            </div>
          </div>
          <ErrorNotice message={error} />
          {original && (
            <div className="notice">
              Existing stories retain their schema version. Saving here creates
              a new version for newly added blocks.
            </div>
          )}
          <fieldset
            disabled={!canManage || busy}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <div className="panel" style={{ marginBottom: 22 }}>
              <div className="panel-body">
                <div className="field-row">
                  <Field label="Display name" htmlFor="definition-display">
                    <input
                      id="definition-display"
                      placeholder="e.g. Hero"
                      value={draft.displayName}
                      onChange={(event) => {
                        const value = event.target.value;
                        change({
                          ...draft,
                          displayName: value,
                          name:
                            !original &&
                            draft.name === fieldName(draft.displayName)
                              ? fieldName(value)
                              : draft.name,
                        });
                      }}
                    />
                  </Field>
                  <Field label="Technical name" htmlFor="definition-name">
                    <input
                      id="definition-name"
                      placeholder="hero"
                      value={draft.name}
                      disabled={!!original}
                      onChange={(event) =>
                        change({ ...draft, name: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="field-label" style={{ marginBottom: 10 }}>
                  Where can this block be used?
                </div>
                <div
                  className="radio-cards"
                  role="radiogroup"
                  aria-label="Block kind"
                >
                  {(["nestable", "content-type", "universal"] as const).map(
                    (kind) => (
                      <label className="radio-card" key={kind}>
                        <input
                          type="radio"
                          name="definition-kind"
                          checked={draft.kind === kind}
                          onChange={() => change({ ...draft, kind })}
                        />
                        <strong>{kindLabels[kind]}</strong>
                        <small>
                          {kind === "nestable"
                            ? "Compose sections inside a story."
                            : kind === "content-type"
                              ? "Define the root of a story."
                              : "Use as a story or a nested block."}
                        </small>
                      </label>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="schema-layout">
              <div className="panel">
                <div className="panel-heading">
                  <h3>Fields</h3>
                  <span className="pill">{draft.fields.length}</span>
                </div>
                <div className="schema-fields">
                  {draft.fields.map((item, index) => (
                    <button
                      type="button"
                      className="schema-field-row"
                      aria-current={selectedField === index}
                      key={index}
                      onClick={() => setSelectedField(index)}
                    >
                      <span className="field-type-icon">
                        {
                          FIELD_TYPES.find((type) => type.type === item.type)
                            ?.mark
                        }
                      </span>
                      <span>
                        <strong>{item.label || "Untitled field"}</strong>
                        <small>{item.name || "field_name"}</small>
                      </span>
                      <span className="field-position">{index + 1}</span>
                    </button>
                  ))}
                </div>
                <div className="schema-actions">
                  <Button
                    onClick={() => {
                      setNewLabel("");
                      setNewName("");
                      setNewType("text");
                      setAddingField(true);
                    }}
                  >
                    <Plus /> Add field
                  </Button>
                </div>
              </div>
              <div className="panel">
                {field ? (
                  <>
                    <div className="panel-heading">
                      <h2>{field.label || "Field settings"}</h2>
                      <div className="button-group">
                        <Button
                          variant="ghost"
                          className="icon-button"
                          aria-label="Move field up"
                          disabled={selectedField === 0}
                          onClick={() => reorder(-1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          className="icon-button"
                          aria-label="Move field down"
                          disabled={selectedField === draft.fields.length - 1}
                          onClick={() => reorder(1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          className="icon-button"
                          aria-label="Remove field"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove “${field.label}” from this schema version?`,
                              )
                            ) {
                              change({
                                ...draft,
                                fields: draft.fields.filter(
                                  (_, i) => i !== selectedField,
                                ),
                              });
                              setSelectedField(Math.max(0, selectedField - 1));
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <div className="panel-body">
                      <FieldSettings
                        field={field}
                        definitions={definitions}
                        datasources={datasources}
                        onChange={(next) =>
                          change({
                            ...draft,
                            fields: draft.fields.map((item, i) =>
                              i === selectedField ? next : item,
                            ),
                          })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <EmptyState title="Add your first field">
                    Fields turn your block into a useful piece of content.
                  </EmptyState>
                )}
              </div>
            </div>
          </fieldset>
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              
              <h1>Block library</h1>
              <p>The building blocks behind your stories.</p>
            </div>
            {canManage && (
              <Button variant="primary" onClick={() => open(null)}>
                <Plus /> New block
              </Button>
            )}
          </div>
          <ErrorNotice message={error} retry={() => void load()} />
          <div className="toolbar">
            <div className="search-input">
              <Search />
              <input
                type="search"
                aria-label="Search blocks"
                placeholder="Search your blocks…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <span className="small muted">
              {definitions.length} block types
            </span>
          </div>
          <div className="panel">
            {loading ? (
              <Loading />
            ) : filtered.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Block</th>
                    <th>Usage</th>
                    <th className="table-mobile-hide">Fields</th>
                    <th className="table-mobile-hide">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="entity-name">
                          <span className="entity-icon">
                            {item.kind === "nestable" ? <Layers /> : <Box />}
                          </span>
                          <div>
                            <button
                              className="entity-title"
                              onClick={() => open(item)}
                            >
                              {item.displayName}
                            </button>
                            <div className="entity-subtitle mono">
                              {item.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`pill ${item.kind === "content-type" ? "pill--green" : ""}`}
                        >
                          {kindLabels[item.kind]}
                        </span>
                      </td>
                      <td className="table-mobile-hide">
                        <span className="small muted">
                          {item.fields.length} fields · v{item.version}
                        </span>
                      </td>
                      <td className="table-mobile-hide">
                        <span className="small muted">
                          {dateLabel(item.createdAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title={
                  search
                    ? "No matching blocks"
                    : "Good content starts with a block"
                }
                action={
                  canManage &&
                  !search && (
                    <Button onClick={() => open(null)}>
                      <Plus /> Create your first block
                    </Button>
                  )
                }
              >
                Define a content type for your pages, then add nestable sections
                to compose them.
              </EmptyState>
            )}
          </div>
        </>
      )}
      <Modal
        open={addingField}
        onClose={() => setAddingField(false)}
        title="Add a field"
      >
        <form onSubmit={addField}>
          <Field label="Label" htmlFor="new-field-label">
            <input
              id="new-field-label"
              required
              autoFocus
              placeholder="e.g. Heading"
              value={newLabel}
              onChange={(event) => {
                const value = event.target.value;
                if (newName === fieldName(newLabel))
                  setNewName(fieldName(value));
                setNewLabel(value);
              }}
            />
          </Field>
          <Field label="Field name" htmlFor="new-field-name">
            <input
              id="new-field-name"
              required
              pattern="[a-z][a-z0-9_]*"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </Field>
          <Field label="Type" htmlFor="new-field-type">
            <select
              id="new-field-type"
              value={newType}
              onChange={(event) =>
                setNewType(event.target.value as FieldDefinition["type"])
              }
            >
              {FIELD_TYPES.map((type) => (
                <option value={type.type} key={type.type}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="dialog-actions">
            <Button onClick={() => setAddingField(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={draft?.fields.some((field) => field.name === newName)}
            >
              Add field
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
