"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Trash2 } from "lucide-react";
import { definitionInputSchema, fieldDefinitionSchema, type BlockDefinition, type Datasource, type DefinitionInput } from "@storypane/core";
import { Button, EmptyState, ErrorNotice, Field, Modal } from "@storypane/ui";
import { api, errorMessage, fieldName, jsonRequest } from "../editor/api";
import type { RegisterGuard } from "../editor/navigation";
import { FieldSettings, newField } from "./field-settings";
import { FIELD_CHOICES, FieldTypePicker, choiceForField } from "./field-type-picker";

const kindLabels = { nestable: "Nestable", "content-type": "Content type", universal: "Universal" };
const emptyDefinition: DefinitionInput = { name: "", displayName: "", kind: "nestable", fields: [] };

export function SchemaDrawer({ initialDefinition, definitions, datasources, canManage, registerGuard, onClose, onSave, description }: {
  initialDefinition: BlockDefinition | null;
  definitions: BlockDefinition[];
  datasources: Datasource[];
  canManage: boolean;
  registerGuard: RegisterGuard;
  onClose: () => void;
  onSave: (definition: BlockDefinition) => Promise<void>;
  description?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [tagText, setTagText] = useState(initialDefinition?.tags?.join(", ") ?? "");
  const [draft, setDraft] = useState<DefinitionInput>(() => initialDefinition ? structuredClone({ name: initialDefinition.name, displayName: initialDefinition.displayName, kind: initialDefinition.kind, tags: initialDefinition.tags, fields: initialDefinition.fields }) : structuredClone(emptyDefinition));
  const [original, setOriginal] = useState<BlockDefinition | null>(initialDefinition);
  const [dirty, setDirty] = useState(false);
  const [selectedField, setSelectedField] = useState<number | null>(null);
  const [tab, setTab] = useState<"fields" | "config">(initialDefinition ? "fields" : "config");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(FIELD_CHOICES.find(choice => choice.id === "text")!);
  const [announcement, setAnnouncement] = useState("");
  const dragSource = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; edge: "before" | "after" } | null>(null);
  useEffect(() => {
    registerGuard(() => !busy && (!dirty || window.confirm("Discard your unsaved schema changes?")));
    return () => registerGuard(null);
  }, [busy, dirty, registerGuard]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (selectedField !== null && tab === "fields") document.getElementById(`schema-field-${selectedField}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedField, tab]);
  function close() {
    if (busy || (dirty && !window.confirm("Discard your unsaved schema changes?"))) return;
    onClose();
  }
  function change(next: DefinitionInput) { setDraft(next); setDirty(true); setSaved(false); }
  async function save() {
    if (!draft || !canManage || busy || (original && !dirty)) return;
    const parsed = definitionInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(". "));
      return;
    }
    setBusy(true); setError(null);
    try {
      const result = await api<BlockDefinition>(original ? `/definitions/${original.id}/versions` : "/definitions", jsonRequest("POST", parsed.data));
      setOriginal(result); setDirty(false); setSaved(true);
      await onSave(result);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function addField(event: FormEvent) {
    event.preventDefault();
    if (!draft || !canManage || busy || !newName || draft.fields.length >= 200 || draft.fields.some(field => field.name === newName)) return;
    const field = newField(newType.type, newName, newName.replaceAll("_", " ").replace(/^./, character => character.toUpperCase()));
    if (field.type === "text") field.format = newType.format ?? "singleline";
    const parsed = fieldDefinitionSchema.safeParse(field);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(". ")); return; }
    change({ ...draft, fields: [...draft.fields, parsed.data] });
    setSelectedField(draft.fields.length); setNewName(""); setError(null);
  }
  function moveField(from: number, to: number) {
    if (!draft || !canManage || busy || to < 0 || to >= draft.fields.length || from === to) return;
    const fields = [...draft.fields];
    const [moved] = fields.splice(from, 1);
    fields.splice(to, 0, moved!);
    if (selectedField !== null) setSelectedField(fields.indexOf(draft.fields[selectedField]!));
    change({ ...draft, fields });
    setAnnouncement(`${moved!.label} moved to position ${to + 1} of ${fields.length}.`);
    requestAnimationFrame(() => document.getElementById(`schema-field-handle-${to}`)?.focus());
  }
  function placement(index: number, event: DragEvent<HTMLElement>) {
    if (dragSource.current === null || dragSource.current === index || busy || !canManage) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return { index, edge: event.clientY < bounds.top + bounds.height / 2 ? "before" as const : "after" as const };
  }
  const duplicate = draft.fields.some(field => field.name === newName);
  return (
      <Modal open closeOnBackdrop onClose={close} title={original ? `Edit '${original.name}'` : "New block"} className="schema-drawer" description={description}>
        {draft && <div className="schema-editor" onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
        }}>
          <div className="schema-tabs" role="tablist" aria-label="Block definition">
            {(["fields", "config"] as const).map(value => <button type="button" role="tab" key={value} id={`schema-tab-${value}`} aria-controls={`schema-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "fields" : event.key === "End" ? "config" : tab === "fields" ? "config" : "fields";
              setTab(next); document.getElementById(`schema-tab-${next}`)?.focus();
            }}>{value === "fields" ? "Fields" : "Config"}</button>)}
            {original && <span className="schema-version">Version {original.version}</span>}
          </div>
          <div className="schema-drawer-body" id={`schema-${tab}`} role="tabpanel" aria-labelledby={`schema-tab-${tab}`}>
            <ErrorNotice message={error} />
            {tab === "config" ? <fieldset className="schema-config" disabled={!canManage || busy}>
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
                <Field label="Tags" htmlFor="definition-tags" description="Separate tags with commas, e.g. rootComponent, marketing. Blocks fields can use these tags to restrict which blocks are allowed.">
                  <input id="definition-tags" placeholder="e.g. rootComponent, marketing" value={tagText} onChange={event => {
                    setTagText(event.target.value);
                    change({ ...draft, tags: [...new Set(event.target.value.split(",").map(tag => tag.trim()).filter(Boolean))] });
                  }} />
                </Field>
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
              {original && <p className="field-hint">Existing stories keep their schema version. Changes here apply to newly added blocks.</p>}
            </fieldset> : <>
              {canManage && <form className="schema-add-field" onSubmit={addField}>
                <label htmlFor="schema-new-name">Name</label>
                <fieldset className="schema-add-control" disabled={busy}>
                  <input id="schema-new-name" value={newName} onChange={event => setNewName(event.target.value)} required maxLength={80} pattern="[a-z][a-z0-9_]*" placeholder="e.g. headline, body, featured_image" autoComplete="off" />
                  <FieldTypePicker compact value={newType} onChange={setNewType} />
                  <Button type="submit" variant="primary" disabled={!/^[a-z][a-z0-9_]*$/.test(newName) || duplicate || draft.fields.length >= 200}>Add</Button>
                </fieldset>
                {duplicate && <p className="field-error" role="alert">A field with this name already exists.</p>}
                {draft.fields.length >= 200 && <p className="field-hint">A block can contain up to 200 fields.</p>}
              </form>}
              <div className="schema-fields-heading"><h3>Fields</h3><span>{draft.fields.length} {draft.fields.length === 1 ? "field" : "fields"}</span></div>
              <p id="schema-reorder-help" className="sr-only">Drag a field to reorder it, or focus its handle and use the up and down arrow keys.</p>
              <p className="sr-only" role="status">{announcement}</p>
              <div className="schema-fields">
                {draft.fields.map((item, index) => {
                  const choice = choiceForField(item);
                  const expanded = selectedField === index;
                  return <div className="schema-field-card" key={index} data-expanded={expanded || undefined} data-drop-position={dropTarget?.index === index ? dropTarget.edge : undefined} onDragOver={event => {
                    const next = placement(index, event);
                    if (next) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(next); }
                  }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }} onDrop={event => {
                    const next = placement(index, event), from = dragSource.current;
                    dragSource.current = null; setDropTarget(null);
                    if (next && from !== null) { event.preventDefault(); moveField(from, index + Number(next.edge === "after") - Number(from < index)); }
                  }}>
                    <div className="schema-field-row">
                      {canManage && <button type="button" id={`schema-field-handle-${index}`} className="block-drag-handle" draggable={!busy} disabled={busy} aria-label={`Reorder ${item.name}`} aria-describedby="schema-reorder-help" onDragStart={event => { dragSource.current = index; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.name); }} onDragEnd={() => { dragSource.current = null; setDropTarget(null); }} onKeyDown={event => {
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveField(index, index + (event.key === "ArrowUp" ? -1 : 1)); }
                      }}><GripVertical aria-hidden="true" /></button>}
                      <button type="button" className="schema-field-toggle" id={`schema-field-${index}`} aria-label={`Edit ${item.name}`} aria-expanded={expanded} aria-controls={expanded ? `schema-field-settings-${index}` : undefined} onClick={() => setSelectedField(expanded ? null : index)}>
                        <span className="field-type-icon" data-tone={choice.tone}><choice.icon aria-hidden="true" /></span>
                        <span><strong>{item.name || "field_name"}</strong><small>{choice.label}</small></span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                    </div>
                    {expanded && <fieldset id={`schema-field-settings-${index}`} className="schema-field-settings" disabled={!canManage || busy}>
                      {canManage && <div className="schema-field-actions"><span>Field settings</span><div className="button-group">
                        <Button variant="ghost" className="icon-button" aria-label="Move field up" disabled={index === 0} onClick={() => moveField(index, index - 1)}><ArrowUp /></Button>
                        <Button variant="ghost" className="icon-button" aria-label="Move field down" disabled={index === draft.fields.length - 1} onClick={() => moveField(index, index + 1)}><ArrowDown /></Button>
                        <Button variant="ghost" className="icon-button" aria-label="Remove field" onClick={() => {
                          if (window.confirm(`Remove “${item.label}” from this schema version?`)) {
                            change({ ...draft, fields: draft.fields.filter((_, position) => position !== index) }); setSelectedField(null);
                          }
                        }}><Trash2 /></Button>
                      </div></div>}
                      <FieldSettings field={item} definitions={definitions} datasources={datasources} onChange={next => change({ ...draft, fields: draft.fields.map((value, position) => position === index ? next : value) })} />
                    </fieldset>}
                  </div>;
                })}
                {!draft.fields.length && <EmptyState title={canManage ? "Add your first field" : "No fields yet"}>{canManage ? "Choose a name and field type to shape this block." : "An administrator can add fields to this block."}</EmptyState>}
              </div>
            </>}
          </div>
          <footer className="schema-drawer-footer">
            <span className="schema-status" role="status">{dirty ? "Unsaved changes" : saved ? "Version saved" : canManage ? original ? "All changes saved" : "Not saved yet" : "Read only"}</span>
            {canManage && <div className="button-group"><span className="schema-shortcut" aria-hidden="true">⌘ / Ctrl S</span><Button variant="primary" onClick={() => void save()} disabled={busy || (!!original && !dirty)}>{busy ? "Saving…" : original ? "Save new version" : "Create block"}</Button></div>}
          </footer>
        </div>}
      </Modal>
  );
}
