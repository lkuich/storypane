'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, GitBranch, GripVertical, Trash2 } from 'lucide-react';
import {
  canonicalJson,
  definitionInputSchema,
  fieldDefinitionSchema,
  type BlockDefinition,
  type Datasource,
  type DefinitionInput,
  type SchemaMigration,
  definitionInput,
} from '@storypane/core';
import { Button, EmptyState, ErrorNotice, Field, Modal } from '@storypane/ui';
import { api, errorMessage, fieldName, jsonRequest } from '../editor/api';
import type { RegisterGuard } from '../editor/navigation';
import { FieldSettings, newField } from './field-settings';
import { ParentBlockPicker } from './parent-block-picker';
import { DefinitionReferences } from './definition-references';
import { FIELD_CHOICES, FieldTypePicker, choiceForField } from './field-type-picker';

const kindLabels = { nestable: 'Nestable', 'content-type': 'Content type', universal: 'Universal' };
const emptyDefinition: DefinitionInput = {
  name: '',
  displayName: '',
  kind: 'nestable',
  fields: [],
};

export function SchemaDrawer({
  initialDefinition,
  initialParentId,
  definitions,
  datasources,
  canManage,
  registerGuard,
  onClose,
  onSave,
  onDelete,
  description,
}: {
  initialDefinition: BlockDefinition | null;
  initialParentId?: string;
  definitions: BlockDefinition[];
  datasources: Datasource[];
  canManage: boolean;
  registerGuard: RegisterGuard;
  onClose: () => void;
  onSave: (definition: BlockDefinition) => Promise<void>;
  onDelete: () => void;
  description?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [tagText, setTagText] = useState(initialDefinition?.tags?.join(', ') ?? '');
  const [draft, setDraft] = useState<DefinitionInput>(() =>
    initialDefinition
      ? structuredClone(definitionInput(initialDefinition))
      : structuredClone(emptyDefinition),
  );
  const [parentId, setParentId] = useState<string | null>(
    initialDefinition?.parentDefinitionId ?? initialParentId ?? null,
  );
  const [original, setOriginal] = useState<BlockDefinition | null>(initialDefinition);
  const [dirty, setDirty] = useState(false);
  const [availableDefinitions, setAvailableDefinitions] = useState(definitions);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [migrationWorkspace, setMigrationWorkspace] = useState<{
    deployed: BlockDefinition[];
    activeVersion: number | null;
  } | null>(null);
  const [remote, setRemote] = useState<{
    definition: BlockDefinition | null;
    baseVersion: number;
  } | null>(null);

  const [selectedField, setSelectedField] = useState<number | null>(null);
  const [tab, setTab] = useState<'fields' | 'config' | 'references'>(
    initialDefinition ? 'fields' : 'config',
  );
  const [referenceCount, setReferenceCount] = useState<number | '…' | '—'>(
    initialDefinition ? '…' : 0,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState(FIELD_CHOICES.find((choice) => choice.id === 'text')!);
  const [announcement, setAnnouncement] = useState('');
  const dragSource = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; edge: 'before' | 'after' } | null>(
    null,
  );
  useEffect(() => {
    registerGuard(
      () => !busy && (!dirty || window.confirm('Discard your unsaved schema changes?')),
    );
    return () => registerGuard(null);
  }, [busy, dirty, registerGuard]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (selectedField !== null && tab === 'fields')
      document
        .getElementById(`schema-field-${selectedField}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [selectedField, tab]);
  function close() {
    if (busy || (dirty && !window.confirm('Discard your unsaved schema changes?'))) return;
    onClose();
  }
  const originalId = original?.id,
    originalVersionId = original?.versionId;
  useEffect(() => {
    let stopped = false;
    async function refresh() {
      if (document.hidden || busy) return;
      try {
        const [migrations, shared] = await Promise.all([
          api<SchemaMigration[]>('/migrations?workspace=true'),
          api<BlockDefinition[]>('/definitions'),
        ]);
        if (stopped) return;
        const deployedMigration = migrations.filter((item) => item.status === 'deployed').at(-1);
        const deployed = deployedMigration?.version ?? 0;
        setMigrationWorkspace({
          deployed: deployedMigration?.definitions ?? [],
          activeVersion: migrations.find((item) => item.status === 'active')?.version ?? null,
        });
        setAvailableDefinitions(shared);
        const latest = shared.find((item) => item.id === originalId) ?? null;
        if (originalId && !latest) {
          setRemote({ definition: null, baseVersion: deployed });
          return;
        }
        if (latest) {
          setParentId(latest.parentDefinitionId ?? null);
          setOriginal((current) =>
            current ? { ...current, parentDefinitionId: latest.parentDefinitionId } : current,
          );
        }
        if (baseVersion === null) setBaseVersion(deployed);
        const changed =
          (originalId && latest && latest.versionId !== originalVersionId) ||
          (baseVersion !== null && baseVersion !== deployed);
        if (!changed) return;
        if (dirty) setRemote({ definition: latest, baseVersion: deployed });
        else {
          setBaseVersion(deployed);
          if (latest) {
            setOriginal(latest);
            setDraft(definitionInput(latest));
            setTagText(latest.tags?.join(', ') ?? '');
          }
          setRemote(null);
        }
      } catch (cause) {
        if (!stopped) setError(errorMessage(cause));
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [originalId, originalVersionId, baseVersion, dirty, busy]);
  function change(next: DefinitionInput) {
    setDraft(next);
    setDirty(true);
    setSaved(false);
  }
  async function save() {
    if (!draft || !canManage || busy || baseVersion === null || remote || (original && !dirty))
      return;
    const parsed = definitionInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('. '),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<BlockDefinition>(
        original ? `/definitions/${original.id}/versions` : '/definitions',
        jsonRequest('POST', {
          schema: parsed.data,
          baseVersion,
          ...(original
            ? { expectedVersionId: original.versionId }
            : { parentDefinitionId: parentId }),
        }),
      );
      setOriginal(result);
      setDirty(false);
      await onSave(result);
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function changeParent(next: string | null) {
    if (!canManage || busy) return;
    if (!original) {
      setParentId(next);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<BlockDefinition>(
        `/definitions/${original.id}/parent`,
        jsonRequest('PUT', {
          parentDefinitionId: next,
          expectedParentDefinitionId: parentId,
        }),
      );
      setParentId(result.parentDefinitionId ?? null);
      // Keep the starting schema version and unsaved field edits when only organization changes.
      setOriginal((current) =>
        current ? { ...current, parentDefinitionId: result.parentDefinitionId } : current,
      );
      await onSave(result);
      setAnnouncement('Parent saved. No schema migration needed.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!original || !canManage || busy || baseVersion === null || remote || referenceCount !== 0)
      return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api(
        `/definitions/${original.id}`,
        jsonRequest('DELETE', { expectedVersionId: original.versionId, baseVersion }),
      );
      setDirty(false);
      onDelete();
    } catch (cause) {
      setDeleteError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  function addField(event: FormEvent) {
    event.preventDefault();
    if (
      !draft ||
      !canManage ||
      busy ||
      !newName ||
      draft.fields.length >= 200 ||
      draft.fields.some((field) => field.name === newName)
    )
      return;
    const field = newField(
      newType.type,
      newName,
      newName.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase()),
    );
    if (field.type === 'text') field.format = newType.format ?? 'singleline';
    field.id = crypto.randomUUID();
    const parsed = fieldDefinitionSchema.safeParse(field);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join('. '));
      return;
    }
    change({ ...draft, fields: [...draft.fields, parsed.data] });
    setSelectedField(draft.fields.length);
    setNewName('');
    setError(null);
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
    if (dragSource.current === null || dragSource.current === index || busy || !canManage)
      return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      index,
      edge:
        event.clientY < bounds.top + bounds.height / 2 ? ('before' as const) : ('after' as const),
    };
  }
  const duplicate = draft.fields.some((field) => field.name === newName);
  const deployedDefinition = migrationWorkspace?.deployed.find((item) => item.id === originalId);
  return (
    <>
      <Modal
        open
        closeOnBackdrop
        onClose={close}
        title={original ? `Edit '${original.name}'` : 'New block'}
        className="schema-drawer"
        description={description}
      >
        {draft && (
          <div
            className="schema-editor"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void save();
              }
            }}
          >
            {remote && (
              <div role="alert" className="error-notice">
                <p>
                  {remote.definition
                    ? 'The shared schema changed. Your unsaved edits are still here. Copy anything you need before reloading.'
                    : 'This block was deleted from the schema workspace. Close this editor to return.'}
                </p>
                {remote.definition && (
                  <Button
                    onClick={() => {
                      if (
                        window.confirm(
                          'Discard your unsaved schema edits and load the shared version?',
                        )
                      ) {
                        if (remote.definition) {
                          setOriginal(remote.definition);
                          setDraft(definitionInput(remote.definition));
                          setTagText(remote.definition.tags?.join(', ') ?? '');
                        }
                        setBaseVersion(remote.baseVersion);
                        setDirty(false);
                        setRemote(null);
                        setError(null);
                      }
                    }}
                  >
                    Reload shared schema
                  </Button>
                )}
              </div>
            )}
            <div className="schema-tabs" role="tablist" aria-label="Block definition">
              {(['fields', 'config', 'references'] as const).map((value) => (
                <button
                  type="button"
                  role="tab"
                  key={value}
                  id={`schema-tab-${value}`}
                  aria-controls={`schema-${value}`}
                  aria-selected={tab === value}
                  tabIndex={tab === value ? 0 : -1}
                  onClick={() => setTab(value)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const tabs = ['fields', 'config', 'references'] as const;
                    const next =
                      event.key === 'Home'
                        ? 'fields'
                        : event.key === 'End'
                          ? 'references'
                          : tabs[
                              (tabs.indexOf(value) +
                                (event.key === 'ArrowRight' ? 1 : -1) +
                                tabs.length) %
                                tabs.length
                            ];
                    setTab(next);
                    document.getElementById(`schema-tab-${next}`)?.focus();
                  }}
                >
                  {value === 'fields'
                    ? 'Fields'
                    : value === 'config'
                      ? 'Config'
                      : `References (${referenceCount})`}
                </button>
              ))}
              {original && <span className="schema-version">Version {original.version}</span>}
            </div>
            <div
              className="schema-drawer-body"
              id={`schema-${tab}`}
              role="tabpanel"
              aria-labelledby={`schema-tab-${tab}`}
            >
              <ErrorNotice message={error} />
              <div hidden={tab !== 'references'}>
                <DefinitionReferences
                  key={originalId ?? 'new'}
                  definitionId={originalId}
                  active={tab === 'references'}
                  onCount={setReferenceCount}
                />
              </div>
              {tab === 'references' ? null : tab === 'config' ? (
                <fieldset className="schema-config" disabled={!canManage || busy}>
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
                              !original && draft.name === fieldName(draft.displayName)
                                ? fieldName(value)
                                : draft.name,
                          });
                        }}
                      />
                    </Field>
                    <Field label="Technical name" htmlFor="definition-name">
                      <input
                        id="definition-name"
                        aria-describedby="definition-name-hint"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="hero"
                        value={draft.name}
                        disabled={!!original}
                        onChange={(event) => change({ ...draft, name: event.target.value })}
                      />
                      <p id="definition-name-hint" className="field-hint">
                        Lowercase letters, numbers and underscores only. Start with a letter, e.g.
                        hero_image.
                      </p>
                    </Field>
                  </div>
                  <ParentBlockPicker
                    definitions={availableDefinitions}
                    definitionId={original?.id}
                    value={parentId}
                    disabled={!canManage || busy}
                    onChange={(next) => void changeParent(next)}
                  />
                  <Field
                    label="Tags"
                    htmlFor="definition-tags"
                    description="Separate tags with commas, e.g. rootComponent, marketing."
                  >
                    <input
                      id="definition-tags"
                      placeholder="e.g. rootComponent, marketing"
                      value={tagText}
                      onChange={(event) => {
                        setTagText(event.target.value);
                        change({
                          ...draft,
                          tags: [
                            ...new Set(
                              event.target.value
                                .split(',')
                                .map((tag) => tag.trim())
                                .filter(Boolean),
                            ),
                          ],
                        });
                      }}
                    />
                  </Field>
                  <div className="field-label" style={{ marginBottom: 10 }}>
                    Where can this block be used?
                  </div>
                  <div className="radio-cards" role="radiogroup" aria-label="Block kind">
                    {(['nestable', 'content-type', 'universal'] as const).map((kind) => (
                      <label className="radio-card" data-kind={kind} key={kind}>
                        <input
                          type="radio"
                          name="definition-kind"
                          checked={draft.kind === kind}
                          onChange={() => change({ ...draft, kind })}
                        />
                        <strong>{kindLabels[kind]}</strong>
                        <small>
                          {kind === 'nestable'
                            ? 'Compose sections inside a story.'
                            : kind === 'content-type'
                              ? 'Define the root of a story.'
                              : 'Use as a story or a nested block.'}
                        </small>
                      </label>
                    ))}
                  </div>
                  {original && (
                    <p className="field-hint">
                      Schema changes are shared in the active migration. Existing pages and new
                      blocks use the deployed schema until an admin deploys it.
                    </p>
                  )}
                  {original && canManage && (
                    <section className="schema-delete">
                      <h3>Delete block</h3>
                      <p className="field-hint">
                        Remove this block from the library. Blocks used by stories or schema
                        settings must be unlinked first.
                      </p>
                      <Button
                        variant="danger"
                        disabled={busy || baseVersion === null || !!remote}
                        onClick={() => {
                          setDeleteError(null);
                          setConfirmDelete(true);
                        }}
                      >
                        <Trash2 /> Delete block
                      </Button>
                    </section>
                  )}
                </fieldset>
              ) : (
                <>
                  {canManage && (
                    <form className="schema-add-field" onSubmit={addField}>
                      <label htmlFor="schema-new-name">Name</label>
                      <fieldset className="schema-add-control" disabled={busy}>
                        <input
                          id="schema-new-name"
                          aria-describedby="schema-new-name-hint"
                          value={newName}
                          onChange={(event) => setNewName(event.target.value)}
                          required
                          maxLength={80}
                          pattern="[a-z][a-z0-9_]*"
                          placeholder="e.g. headline, body, featured_image"
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        <FieldTypePicker compact value={newType} onChange={setNewType} />
                        <Button
                          type="submit"
                          variant="primary"
                          disabled={
                            !/^[a-z][a-z0-9_]*$/.test(newName) ||
                            duplicate ||
                            draft.fields.length >= 200
                          }
                        >
                          Add
                        </Button>
                      </fieldset>
                      <p id="schema-new-name-hint" className="field-hint">
                        Lowercase letters, numbers and underscores only. Start with a letter, e.g.
                        hero_image.
                      </p>
                      {duplicate && (
                        <p className="field-error" role="alert">
                          A field with this name already exists.
                        </p>
                      )}
                      {draft.fields.length >= 200 && (
                        <p className="field-hint">A block can contain up to 200 fields.</p>
                      )}
                    </form>
                  )}
                  <div className="schema-fields-heading">
                    <h3>Fields</h3>
                    <span>
                      {draft.fields.length} {draft.fields.length === 1 ? 'field' : 'fields'}
                    </span>
                  </div>
                  <p id="schema-reorder-help" className="sr-only">
                    Drag a field to reorder it, or focus its handle and use the up and down arrow
                    keys.
                  </p>
                  <p className="sr-only" role="status">
                    {announcement}
                  </p>
                  <div className="schema-fields">
                    {draft.fields.map((item, index) => {
                      const choice = choiceForField(item);
                      const expanded = selectedField === index;
                      const savedField = original?.fields.find((field) =>
                        field.id ? field.id === item.id : field.name === item.name,
                      );
                      const deployedField = deployedDefinition?.fields.find((field) =>
                        field.id ? field.id === savedField?.id : field.name === savedField?.name,
                      );
                      const pendingMigration =
                        !!migrationWorkspace?.activeVersion &&
                        !!savedField &&
                        canonicalJson(savedField) !== canonicalJson(deployedField);
                      const migrationHint = `${savedField?.name}: ${deployedField ? 'changed' : 'added'} in migration ${migrationWorkspace?.activeVersion}, not deployed yet`;
                      return (
                        <div
                          className="schema-field-card"
                          key={index}
                          data-expanded={expanded || undefined}
                          data-pending-migration={pendingMigration || undefined}
                          data-drop-position={
                            dropTarget?.index === index ? dropTarget.edge : undefined
                          }
                          onDragOver={(event) => {
                            const next = placement(index, event);
                            if (next) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              setDropTarget(next);
                            }
                          }}
                          onDragLeave={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                              setDropTarget(null);
                          }}
                          onDrop={(event) => {
                            const next = placement(index, event),
                              from = dragSource.current;
                            dragSource.current = null;
                            setDropTarget(null);
                            if (next && from !== null) {
                              event.preventDefault();
                              moveField(
                                from,
                                index + Number(next.edge === 'after') - Number(from < index),
                              );
                            }
                          }}
                        >
                          <div className="schema-field-row">
                            {canManage && (
                              <button
                                type="button"
                                id={`schema-field-handle-${index}`}
                                className="block-drag-handle"
                                draggable={!busy}
                                disabled={busy}
                                aria-label={`Reorder ${item.name}`}
                                aria-describedby="schema-reorder-help"
                                onDragStart={(event) => {
                                  dragSource.current = index;
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', item.name);
                                }}
                                onDragEnd={() => {
                                  dragSource.current = null;
                                  setDropTarget(null);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    moveField(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                                  }
                                }}
                              >
                                <GripVertical aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="schema-field-toggle"
                              id={`schema-field-${index}`}
                              aria-label={`Edit ${item.name}`}
                              aria-describedby={
                                pendingMigration ? `schema-field-migration-${index}` : undefined
                              }
                              aria-expanded={expanded}
                              aria-controls={
                                expanded ? `schema-field-settings-${index}` : undefined
                              }
                              onClick={() => setSelectedField(expanded ? null : index)}
                            >
                              <span className="field-type-icon" data-tone={choice.tone}>
                                <choice.icon aria-hidden="true" />
                              </span>
                              <span>
                                <strong>{item.name || 'field_name'}</strong>
                                <small>{choice.label}</small>
                              </span>
                              {pendingMigration && (
                                <span
                                  id={`schema-field-migration-${index}`}
                                  className="pending-migration-mark"
                                  title={migrationHint}
                                >
                                  <GitBranch aria-hidden="true" />
                                  <span className="sr-only">{migrationHint}</span>
                                </span>
                              )}
                              <ChevronDown aria-hidden="true" />
                            </button>
                          </div>
                          {expanded && (
                            <fieldset
                              id={`schema-field-settings-${index}`}
                              className="schema-field-settings"
                              disabled={!canManage || busy}
                            >
                              {canManage && (
                                <div className="schema-field-actions">
                                  <span>Field settings</span>
                                  <div className="button-group">
                                    <Button
                                      variant="ghost"
                                      className="icon-button"
                                      aria-label="Move field up"
                                      disabled={index === 0}
                                      onClick={() => moveField(index, index - 1)}
                                    >
                                      <ArrowUp />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      className="icon-button"
                                      aria-label="Move field down"
                                      disabled={index === draft.fields.length - 1}
                                      onClick={() => moveField(index, index + 1)}
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
                                            `Remove “${item.label}” from this schema version?`,
                                          )
                                        ) {
                                          change({
                                            ...draft,
                                            fields: draft.fields.filter(
                                              (_, position) => position !== index,
                                            ),
                                          });
                                          setSelectedField(null);
                                        }
                                      }}
                                    >
                                      <Trash2 />
                                    </Button>
                                  </div>
                                </div>
                              )}
                              <FieldSettings
                                definitionId={original?.id}
                                field={item}
                                definitions={availableDefinitions}
                                datasources={datasources}
                                onChange={(next) =>
                                  change({
                                    ...draft,
                                    fields: draft.fields.map((value, position) =>
                                      position === index ? next : value,
                                    ),
                                  })
                                }
                              />
                            </fieldset>
                          )}
                        </div>
                      );
                    })}
                    {!draft.fields.length && (
                      <EmptyState title={canManage ? 'Add your first field' : 'No fields yet'}>
                        {canManage
                          ? 'Choose a name and field type to shape this block.'
                          : 'An administrator can add fields to this block.'}
                      </EmptyState>
                    )}
                  </div>
                </>
              )}
            </div>
            <footer className="schema-drawer-footer">
              <span className="schema-status" role="status">
                {dirty
                  ? 'Unsaved changes'
                  : saved
                    ? 'Saved to active migration'
                    : canManage
                      ? original
                        ? 'All changes saved'
                        : 'Not saved yet'
                      : 'Read only'}
              </span>
              {canManage && (
                <div className="button-group">
                  <span className="schema-shortcut" aria-hidden="true">
                    ⌘ / Ctrl S
                  </span>
                  <Button
                    variant="primary"
                    onClick={() => void save()}
                    disabled={busy || baseVersion === null || !!remote || (!!original && !dirty)}
                  >
                    {busy ? 'Saving…' : original ? 'Save to migration' : 'Create block'}
                  </Button>
                </div>
              )}
            </footer>
          </div>
        )}
      </Modal>
      <Modal
        open={confirmDelete}
        onClose={() => {
          if (!busy) setConfirmDelete(false);
        }}
        title={`Delete “${original?.displayName ?? 'block'}”?`}
      >
        <p>
          The deletion is saved to the active migration. Deploy it to remove this block from the
          available content types. Historical revisions are kept; its technical name remains
          reserved.
        </p>
        {availableDefinitions.some((item) => item.parentDefinitionId === originalId) && (
          <p>Nested block definitions will be kept and moved up one level.</p>
        )}
        {dirty && <p>Unsaved schema edits will be discarded.</p>}
        {referenceCount !== 0 && (
          <p>
            {referenceCount === '…'
              ? 'Checking story references…'
              : referenceCount === '—'
                ? 'Story references could not be checked. Open References and retry.'
                : 'This block cannot be deleted while stories still reference it. Check the References tab before continuing.'}
          </p>
        )}
        <ErrorNotice message={deleteError} />
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          {referenceCount !== 0 && (
            <Button
              disabled={busy}
              onClick={() => {
                setConfirmDelete(false);
                setTab('references');
                requestAnimationFrame(() =>
                  document.getElementById('schema-tab-references')?.focus(),
                );
              }}
            >
              View references
            </Button>
          )}
          <Button
            variant="danger"
            disabled={busy || baseVersion === null || !!remote || referenceCount !== 0}
            onClick={() => void remove()}
          >
            <Trash2 />
            {busy ? 'Deleting…' : 'Delete block'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
