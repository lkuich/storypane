"use client";
import { createBlockClipboard, isBlockAllowed, parseBlockClipboard, serializeBlockClipboard } from "@storypane/core";
import { setStoryLocation, spaceUrl } from "../../lib/space-url";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  ClipboardPaste,
  Copy,
  FileJson,
  FileText,
  Globe2,
  GripVertical,
  Layers,
  LockKeyhole,
  Monitor,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  BlockDefinition,
  BlockDraft,
  DeliverySettings,
  Datasource,
  Checkpoint,
  CheckpointDetail,
  FieldDefinition,
  FieldIssue,
  LocaleSnapshot,
  Story,
  StoryLocale,
  SpaceLocale,
} from "@storypane/core";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Modal,
} from "@storypane/ui";
import { can } from "@storypane/core";
import { PublicationStatus } from "../../components/publication-status";
import { BlockEditorAvatar, EditorAvatars } from "../../components/editor-avatars";
import { usePageEditors } from "./use-page-editors";
import { PageId } from "../../components/page-id";
import type { CMSSession } from "../../components/cms-app";
import { api, ApiError, dateLabel, errorMessage, jsonRequest } from "./api";
import { FieldInput } from "./field-input";
import type { NavigationGuard, RegisterGuard } from "./navigation";
import { useStoryEditor } from "./use-story-editor";
import { PreviewPanel } from "./preview-panel";
import { BlockNavigation, blockSummary, blockTitle, definitionFor } from "./block-navigation";
import { SchemaDrawer } from "../schema/schema-drawer";
import { PendingSchemaMigration } from "../schema/pending-schema-migration";

function outline(
  snapshot: LocaleSnapshot,
): Array<{ block: BlockDraft; depth: number }> {
  const result: Array<{ block: BlockDraft; depth: number }> = [];
  const seen = new Set<string>();
  function visit(id: string, depth: number) {
    const block = snapshot.blocks.find((block) => block.id === id);
    if (!block || seen.has(id)) return;
    seen.add(id);
    result.push({ block, depth });
    snapshot.blocks
      .filter((child) => child.parentId === id)
      .sort(
        (a, b) =>
          (a.parentField ?? "").localeCompare(b.parentField ?? "") ||
          a.position - b.position,
      )
      .forEach((child) => visit(child.id, depth + 1));
  }
  visit(snapshot.locale.rootBlockId, 0);
  return result;
}

export function StoryWorkspace({
  story,
  session,
  onBack,
  registerGuard,
}: {
  story: Story;
  session: CMSSession;
  onBack: () => void;
  registerGuard: RegisterGuard;
}) {
  const [locales, setLocales] = useState<StoryLocale[]>([]);
  const [configuredLocales, setConfiguredLocales] = useState<SpaceLocale[]>([]);
  const [definitions, setDefinitions] = useState<BlockDefinition[]>([]);
  const [initialSnapshot, setInitialSnapshot] = useState<LocaleSnapshot | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewSettings, setPreviewSettings] = useState<DeliverySettings | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const switching = useRef(false);
  const focusLocale = useRef<string | null>(null);
  const localeId = initialSnapshot?.locale.id;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const guard = useRef<NavigationGuard | null>(null);
  const register = useCallback<RegisterGuard>(
    (next) => {
      guard.current = next;
      registerGuard(next ? () => !switching.current && next() : null);
    },
    [registerGuard],
  );
  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const [available, blocks, configured] = await Promise.all([
        api<StoryLocale[]>(`/stories/${story.id}/locales`),
        api<BlockDefinition[]>("/definitions?deployed=true"),
        api<SpaceLocale[]>("/locales"),
      ]);
      const slug = new URLSearchParams(window.location.search).get('locale') ?? '';
      const target = configured.find(locale => locale.slug === slug);
      if (!target) throw new Error(`Locale “${slug || 'Default'}” is not configured in this space.`);
      const locale = available.find(locale => locale.spaceLocaleId === target.id)
        ?? await api<StoryLocale>(`/stories/${story.id}/locales`, jsonRequest('POST', { spaceLocaleId: target.id }));
      const snapshot = await api<LocaleSnapshot>(`/stories/${story.id}/locales/${locale.id}`);
      if (stopped) return;
      setLocales(available.some(item => item.id === locale.id) ? available : [...available, locale]);
      setConfiguredLocales(configured);
      setDefinitions(blocks);
      setInitialSnapshot(snapshot);
      setStoryLocation(story.id, locale.slug, new URLSearchParams(window.location.search).get('block'));
    })().catch(cause => { if (!stopped) setError(errorMessage(cause)); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [story.id, loadAttempt]);
  useEffect(() => {
    if (!focusLocale.current) return;
    document.getElementById(`locale-tab-${focusLocale.current}`)?.focus();
    focusLocale.current = null;
  }, [localeId]);
  async function switchLocale(spaceLocaleId: string) {
    const existing = locales.find(locale => locale.spaceLocaleId === spaceLocaleId);
    if (switching.current || existing?.id === localeId) return;
    switching.current = true;
    setBusy(true); setError(null);
    try {
      if (guard.current && !(await guard.current())) return;
      const locale = existing ?? await api<StoryLocale>(`/stories/${story.id}/locales`,jsonRequest("POST",{ spaceLocaleId }));
      if (!existing) setLocales(current => [...current,locale]);
      const snapshot = await api<LocaleSnapshot>(`/stories/${story.id}/locales/${locale.id}`);
      focusLocale.current = spaceLocaleId;
      setInitialSnapshot(snapshot);
      setStoryLocation(story.id, locale.slug);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { switching.current = false; setBusy(false); }
  }
  async function back() {
    if (!switching.current && (!guard.current || (await guard.current()))) onBack();
  }
  async function manageLocales() {
    if (!switching.current && (!guard.current || (await guard.current()))) window.location.assign(spaceUrl('/?view=settings'));
  }
  return (
    <>
      <div className="breadcrumb">
        <button onClick={() => void back()}>Content</button>
        <ChevronRight size={12} />
        <span>{story.name}</span>
      </div>
      <ErrorNotice message={error} retry={initialSnapshot ? undefined : () => setLoadAttempt(value => value + 1)} />
      {loading ? (
        <Loading label="Opening story…" />
      ) : initialSnapshot ? (
        <div aria-busy={busy} inert={busy}>
        <LocaleEditor
          key={localeId}
          story={story}
          initialSnapshot={initialSnapshot}
          previewOpen={previewOpen}
          onPreview={() => setPreviewOpen(value => !value)}
          previewSettings={previewSettings}
          onPreviewSettings={setPreviewSettings}
          previewId={previewId}
          onPreviewId={setPreviewId}
          locales={locales}
          configuredLocales={configuredLocales}
          switchingLocale={busy}
          definitions={definitions}
          onDefinitions={setDefinitions}
          session={session}
          registerGuard={register}
          onLocale={(id) => void switchLocale(id)}
          onManageLocales={() => void manageLocales()}
        />
        </div>
      ) : (
        <EmptyState title="No locale is available" />
      )}
      <span className="sr-only" role="status">{busy ? "Opening locale…" : ""}</span>
    </>
  );
}

function LocaleEditor({
  story,
  initialSnapshot,
  previewOpen,
  onPreview,
  previewSettings,
  onPreviewSettings,
  previewId,
  onPreviewId,
  locales,
  configuredLocales,
  switchingLocale,
  definitions,
  onDefinitions,
  session,
  registerGuard,
  onLocale,
  onManageLocales,
}: {
  story: Story;
  initialSnapshot: LocaleSnapshot;
  previewOpen: boolean;
  onPreview: () => void;
  previewSettings: DeliverySettings | null;
  onPreviewSettings: (settings: DeliverySettings) => void;
  previewId: string | null;
  onPreviewId: (id: string) => void;
  locales: StoryLocale[];
  configuredLocales: SpaceLocale[];
  switchingLocale: boolean;
  definitions: BlockDefinition[];
  onDefinitions: (definitions: BlockDefinition[]) => void;
  session: CMSSession;
  registerGuard: RegisterGuard;
  onLocale: (id: string) => void;
  onManageLocales: () => void;
}) {
  const editor = useStoryEditor({
    storyId: story.id,
    initialSnapshot,
    userId: session.user.id,
    sessionId: session.sessionId,
    spaceId: session.space.id,
    editable: can(session.space,"content:edit"),
  });
  useEffect(() => {
    let stopped=false;
    void api<BlockDefinition[]>("/definitions?deployed=true").then(value=>{if(!stopped)onDefinitions(value)}).catch(()=>undefined);
    return ()=>{stopped=true};
  },[editor.snapshot?.migrationVersion,onDefinitions]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [schema, setSchema] = useState<{
    definition: BlockDefinition;
    definitions: BlockDefinition[];
    datasources: Datasource[];
  } | null>(null);
  const schemaGuard = useRef<NavigationGuard | null>(null);
  const registerSchemaGuard = useCallback<RegisterGuard>(next => { schemaGuard.current = next; }, []);
  const [busy, setBusy] = useState(false);
  const [addTo, setAddTo] = useState<{
    parentId: string;
    field: Extract<FieldDefinition, { type: "blocks" }>;
  } | null>(null);
  const [addDefinition, setAddDefinition] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Checkpoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [review, setReview] = useState<CheckpointDetail | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [published, setPublished] = useState<string | null>(null);
  const [importTo, setImportTo] = useState<{
    parentId: string;
    field: Extract<FieldDefinition, { type: "blocks" }>;
  } | null>(null);
  const [source, setSource] = useState<LocaleSnapshot | null>(null);
  const [importIds, setImportIds] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const dragSource = useRef<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: "before" | "after" } | null>(null);
  const [clipboardNotice,setClipboardNotice] = useState('');
  const [copyFallback,setCopyFallback] = useState<string|null>(null);
  const [pasteTo,setPasteTo] = useState<{parentId:string;field:Extract<FieldDefinition,{type:'blocks'}>}|null>(null);
  const [pasteText,setPasteText] = useState(''),[pasteError,setPasteError] = useState('');
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  useEffect(() => {
    registerGuard(async () => {
      if (schemaGuard.current && !(await schemaGuard.current())) return false;
      return editor.leave();
    });
    return () => registerGuard(null);
  }, [registerGuard, editor.leave]);
  useEffect(() => {
    const command = editor.completedCommand;
    if (command?.type === "insertBlock") setAddTo(null);
    if (command?.type === "importBlocks") setImportTo(null);
    if (command?.type === "pasteBlock") setPasteTo(null);
    if (command?.type === "restoreBlock" || command?.type === "restorePage")
      setHistoryOpen(false);
    if (command?.type === "publishCheckpoint") setReview(null);
  }, [editor.completedCommand]);
  const snapshot = editor.snapshot;
  const pageEditors = usePageEditors(true, snapshot.leases.map(lease => `${lease.blockId}:${lease.userId}`).sort().join("|"));
  const currentEditors = pageEditors[snapshot.story.id] ?? [];
  const block = editor.selected;
  const definition = snapshot && block ? definitionFor(snapshot, block) : null;
  const pending =
    Object.keys(editor.buffers).length + Number(editor.unconfirmedCommand);
  const currentBuffer = editor.selectedId
    ? editor.buffers[editor.selectedId]
    : undefined;
  const blockError = editor.selectedId
    ? editor.blockErrors[editor.selectedId]
    : undefined;
  const fields = currentBuffer?.fields ?? block?.fields ?? {};
  const state = blockError
    ? "error"
    : editor.connection === "disconnected"
      ? "error"
      : editor.connection === "connecting" ? "connecting"
      : pending || editor.saving
        ? "pending"
        : "saved";
  const label = switchingLocale ? "Opening locale…" : blockError
    ? "Changes need attention"
    : editor.connection === "connecting"
      ? "Connecting…"
      : editor.connection === "disconnected"
        ? "Offline · edits preserved"
        : editor.unconfirmedCommand
          ? "Confirming last change…"
          : editor.saving
            ? "Saving…"
            : pending
              ? "Unsaved changes"
              : "All changes saved";
  const publicationStatus = !snapshot.locale.publishedVersionId ? 'draft'
    : pending > 0 ? 'changed' : snapshot.publicationStatus ?? 'changed';
  const ownsLease = editor.canEdit;
  const disabled = !can(session.space,"content:edit") || !ownsLease || busy;
  const defaultLocale = locales.find((locale) => locale.slug === "");

  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    editor.setError(null);
    try {
      await work();
    } catch (error) {
      editor.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function copyBlock(blockId:string) {
    const text=serializeBlockClipboard(createBlockClipboard(snapshot,session.space.id,blockId,editor.buffers));
    try { await navigator.clipboard.writeText(text);setClipboardNotice('Block copied, including nested blocks. Paste it into a block list in this space.'); }
    catch { setCopyFallback(text); }
  }
  async function pasteBlock(text:string,parentId:string,field:Extract<FieldDefinition,{type:'blocks'}>) {
    const clipboard=parseBlockClipboard(text);
    if(clipboard.spaceId!==session.space.id)throw new Error('Blocks can only be pasted within the space they were copied from.');
    if(clipboard.migrationVersion!==(snapshot.migrationVersion ?? 0))throw new Error('The schema changed since this block was copied. Copy it again before pasting.');
    const definition=definitions.find(item=>item.id===clipboard.blocks[0]!.definitionId);
    if(!definition || !isBlockAllowed(field,definition))throw new Error(`${field.label} does not allow this block type.`);
    const result=await editor.runCommand({type:'pasteBlock',payload:{parentId,parentField:field.name,clipboard}},[parentId]);
    setPasteTo(null);
    setClipboardNotice('Block pasted as an independent copy.');
    const pasted=result.snapshot.blocks.find(item=>item.parentId===parentId && item.parentField===field.name && result.changedBlockIds.includes(item.id));
    if(pasted)await editor.select(pasted.id);
  }
  async function readAndPaste(parentId:string,field:Extract<FieldDefinition,{type:'blocks'}>) {
    let text:string;
    try { text=await navigator.clipboard.readText(); }
    catch { setPasteTo({parentId,field});setPasteText('');setPasteError('');return; }
    await pasteBlock(text,parentId,field);
  }
  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await api<Checkpoint[]>(`${editor.base}/checkpoints`));
    } catch (error) {
      setHistoryError(errorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }
  async function openSchema() {
    if (!definition || !can(session.space,"schemas:write")) return;
    await action(async () => {
      const [latest, datasources] = await Promise.all([
        api<BlockDefinition[]>("/definitions"),
        api<Datasource[]>("/datasources"),
      ]);
      const current = latest.find(item => item.id === definition.id);
      if (!current) throw new Error("This block schema is no longer available.");
      setSchema({ definition: current, definitions: latest, datasources });
    });
  }
  async function openReview(checkpointId?: string) {
    setBusy(true);
    setReviewError(null);
    setIssues([]);
    setPublished(null);
    try {
      if (!checkpointId) {
        if (!(await editor.flush()))
          throw new Error(
            "Resolve your unsaved changes before reviewing a checkpoint.",
          );
        const current = await editor.sync();
        checkpointId = current.checkpointId ?? undefined;
      }
      if (!checkpointId)
        throw new Error("There is no saved checkpoint to review yet.");
      setReview(
        await api<CheckpointDetail>(
          `${editor.base}/checkpoints/${checkpointId}`,
        ),
      );
      setHistoryOpen(false);
    } catch (error) {
      editor.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!review) return;
    setBusy(true);
    setReviewError(null);
    setIssues([]);
    try {
      await editor.runCommand({
        type: "publishCheckpoint",
        payload: { checkpointId: review.id },
      });
      setPublished(`Revision ${review.revision} published`);
      setReview(null);
    } catch (error) {
      setReviewError(errorMessage(error));
      if (error instanceof ApiError) setIssues(error.details ?? []);
    } finally {
      setBusy(false);
    }
  }
  async function restore(checkpoint: Checkpoint, scope: "block" | "page") {
    if (!snapshot) return;
    if (
      !window.confirm(
        scope === "page"
          ? "Restore this locale to the selected checkpoint? Your current draft remains in history."
          : "Restore this block and its nested blocks? Other parts of the page stay unchanged.",
      )
    )
      return;
    setBusy(true);
    setHistoryError(null);
    try {
      if (!(await editor.flush()))
        throw new Error(
          "Resolve your pending changes before restoring content.",
        );
      const current = await editor.sync();
      if (scope === "block") {
        if (!editor.selectedId) return;
        await editor.runCommand(
          {
            type: "restoreBlock",
            payload: {
              blockId: editor.selectedId,
              checkpointId: checkpoint.id,
            },
          },
          [editor.selectedId],
        );
      } else
        await editor.runCommand(
          { type: "restorePage", payload: { checkpointId: checkpoint.id } },
          [current.locale.rootBlockId],
          { $locale: current.revision },
        );
      setHistoryOpen(false);
      setIssues([]);
    } catch (error) {
      setHistoryError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function startImport(
    parentId: string,
    field: Extract<FieldDefinition, { type: "blocks" }>,
  ) {
    if (!defaultLocale) return;
    setImportTo({ parentId, field });
    setImportIds([]);
    setSource(null);
    setImportError(null);
    try {
      setSource(
        await api<LocaleSnapshot>(
          `/stories/${story.id}/locales/${defaultLocale.id}`,
        ),
      );
    } catch (error) {
      setImportError(errorMessage(error));
    }
  }
  async function importSelected() {
    if (!source || !importTo) return;
    setBusy(true);
    setImportError(null);
    try {
      await editor.runCommand(
        {
          type: "importBlocks",
          payload: {
            sourceLocaleId: source.locale.id,
            blockIds: importIds,
            parentId: importTo.parentId,
            parentField: importTo.field.name,
          },
        },
        [importTo.parentId],
      );
      setImportTo(null);
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function copyRecovery() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(currentBuffer?.fields ?? {}, null, 2),
      );
    } catch {
      editor.setError(
        "Could not copy to your clipboard. Select and copy the recovery text below.",
      );
    }
  }

  if (!snapshot)
    return (
      <>
        <ErrorNotice message={editor.error} retry={() => void editor.retry()} />
        <Loading label="Connecting to your story…" />
      </>
    );
  const tree = outline(snapshot);
  const selectedLease = snapshot.leases.find(
    (lease) =>
      lease.blockId === block?.id && lease.sessionId !== session.sessionId && Date.parse(lease.expiresAt) > Date.now(),
  );
  const selectedEditor = currentEditors.find(editor => editor.userId === selectedLease?.userId);
  const availableDefinitions = definitions.filter(
    (item) =>
      addTo ? isBlockAllowed(addTo.field, item) : item.kind !== "content-type",
  );
  const matchingDefinitions = availableDefinitions.filter(item =>
    `${item.displayName} ${item.name} ${(item.tags ?? []).join(" ")}`.toLowerCase().includes(blockSearch.trim().toLowerCase()),
  );
  const structureDisabled = !can(session.space,"content:edit") || busy || editor.connection !== "connected" || editor.unconfirmedCommand;
  const root = snapshot.blocks.find((item) => item.id === snapshot.locale.rootBlockId)!;
  const rootFields = definitionFor(snapshot, root)?.fields.filter((field) => field.type === "blocks") ?? [];
  function isLocked(...ids: string[]) {
    return snapshot!.leases.some((lease) => ids.includes(lease.blockId) && lease.sessionId !== session.sessionId && Date.parse(lease.expiresAt) > Date.now());
  }
  function siblingsOf(item: BlockDraft) {
    return snapshot!.blocks.filter((sibling) => sibling.parentId === item.parentId && sibling.parentField === item.parentField).sort((a, b) => a.position - b.position);
  }
  function canMove(item: BlockDraft) {
    return !structureDisabled && !!item.parentId && !!item.parentField && !isLocked(item.id, item.parentId);
  }
  function moveBlock(item: BlockDraft, position: number) {
    const siblings = siblingsOf(item);
    if (!canMove(item) || position < 0 || position >= siblings.length || siblings[position]?.id === item.id) return;
    void action(async () => {
      await editor.runCommand({ type: "moveBlock", payload: { blockId: item.id, parentId: item.parentId!, parentField: item.parentField!, position } }, [item.id, item.parentId!]);
      setReorderAnnouncement(`${blockTitle(snapshot!, item)} moved to position ${position + 1} of ${siblings.length}.`);
    });
  }
  function clearDrag() {
    dragSource.current = null;
    setDraggedId(null);
    setDropTarget(null);
  }
  function dropPlacement(item: BlockDraft, event: DragEvent<HTMLDivElement>) {
    const source = snapshot!.blocks.find((item) => item.id === dragSource.current);
    if (!source || source.id === item.id || !canMove(source) || source.parentId !== item.parentId || source.parentField !== item.parentField) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return { source, edge: event.clientY < bounds.top + bounds.height / 2 ? "before" as const : "after" as const };
  }
  function sortableProps(item: BlockDraft) {
    return {
      "data-dragging": draggedId === item.id || undefined,
      "data-drop-position": dropTarget?.id === item.id ? dropTarget.edge : undefined,
      onDragOver(event: DragEvent<HTMLDivElement>) {
        const placement = dropPlacement(item, event);
        if (!placement) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget({ id: item.id, edge: placement.edge });
      },
      onDragLeave(event: DragEvent<HTMLDivElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
      },
      onDrop(event: DragEvent<HTMLDivElement>) {
        const placement = dropPlacement(item, event);
        clearDrag();
        if (!placement) return;
        event.preventDefault();
        const siblings = siblingsOf(item);
        const from = siblings.findIndex((sibling) => sibling.id === placement.source.id);
        const to = siblings.findIndex((sibling) => sibling.id === item.id);
        moveBlock(placement.source, to + Number(placement.edge === "after") - Number(from < to));
      },
    };
  }
  function dragHandle(item: BlockDraft) {
    return <button
      type="button"
      className="block-drag-handle"
      aria-label={`Reorder ${blockTitle(snapshot!, item)}`}
      aria-describedby={outlineOpen ? "outline-reorder-help" : "block-reorder-help"}
      title="Drag to reorder, or use the up and down arrow keys"
      draggable={canMove(item)}
      disabled={!canMove(item)}
      onDragStart={(event) => {
        if (!canMove(item)) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        dragSource.current = item.id;
        setDraggedId(item.id);
      }}
      onDragEnd={clearDrag}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        moveBlock(item, siblingsOf(item).findIndex((sibling) => sibling.id === item.id) + (event.key === "ArrowUp" ? -1 : 1));
      }}
    ><GripVertical aria-hidden="true" /></button>;
  }
  return (
    <>
      <p id="block-reorder-help" className="sr-only">Drag to reorder blocks in the same section, or focus a handle and press the up or down arrow key.</p>
      <p className="sr-only" role="status">{reorderAnnouncement}</p>
      <div className="story-heading">
        <div>
          <div className="story-title-status"><h1>{snapshot.story.name}</h1><PublicationStatus status={publicationStatus} localeName={snapshot.locale.name} /></div>
          <div className="entity-subtitle mono">
            /{snapshot.locale.slug ? `${snapshot.locale.slug}/` : ""}
            {snapshot.locale.urlSlug}
          </div>
          <PageId id={snapshot.story.id} name={snapshot.story.name} />
        </div>
        <div className="button-group">
          <EditorAvatars editors={currentEditors} currentUserId={session.user.id} />
          <span
            className="save-status"
            data-state={state}
            role="status"
            aria-live="polite"
          >
            <span className="status-dot" />
            {label}
          </span>
          <Button onClick={() => void openHistory()} disabled={busy}>
            <Clock3 /> History
          </Button>
          {!snapshot.story.formOnly && <Button aria-pressed={previewOpen} onClick={onPreview}><Monitor />{previewOpen ? 'Hide preview' : 'Preview'}</Button>}
          <Button
            variant="primary"
            onClick={() => void openReview()}
            disabled={!can(session.space,"content:publish") || busy || editor.connection !== "connected"}
          >
            <Upload /> Review & publish
          </Button>
        </div>
      </div>
      <div className={`publication-note${publicationStatus === 'published' ? ' publication-note--live' : ''}`} role="status">
        {publicationStatus === 'draft' ? <><FileText aria-hidden="true" /><span><strong>{snapshot.locale.name} is a draft.</strong> This locale is not live until you publish it.</span></>
          : publicationStatus === 'changed' ? <><Clock3 aria-hidden="true" /><span><strong>Changes awaiting publish.</strong> The previously published version of {snapshot.locale.name} is still live.</span></>
          : <><Check aria-hidden="true" /><span>{snapshot.locale.name} is published. No pending changes.</span></>}
      </div>
      <div className="locale-bar">
        <div className="locale-tabs" role="tablist" aria-label="Story locale">
          {configuredLocales.map((locale) => (
            <button
              role="tab"
              aria-label={locale.slug ? `${locale.name} ${locale.slug}` : 'Default'}
              aria-selected={locale.id === snapshot.locale.spaceLocaleId}
              disabled={switchingLocale || (!can(session.space,"content:edit") && !locales.some(item=>item.spaceLocaleId === locale.id))}
              aria-controls="locale-editor"
              id={`locale-tab-${locale.id}`}
              key={locale.id}
              onClick={() => onLocale(locale.id)}
            >
              {locale.slug === "" ? "Default" : locale.name}
              {locale.slug !== "" && (
                <span
                  className="mono"
                  style={{ marginLeft: 7, color: "var(--muted)", fontSize: 10 }}
                >
                  {locale.slug}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="button-group">
          <Button variant="ghost" onClick={onManageLocales} disabled={switchingLocale}>
            <Globe2 /> Manage locales
          </Button>
          {snapshot.locale.publishedVersionId && (
            <a
              className="button button--ghost"
              target="_blank"
              rel="noreferrer"
              href={spaceUrl(`/api/cms${editor.base}/published`)}
            >
              <FileJson size={15} /> Published JSON
            </a>
          )}
        </div>
      </div>
      <ErrorNotice message={editor.error} retry={() => void editor.retry()} />
      {editor.unconfirmedCommand && (
        <div className="notice notice--warning" role="status">
          <span>
            Your last change has not been confirmed yet. Editing will resume
            once it is safely recovered.
          </span>
          <Button
            onClick={() => void editor.retry()}
            disabled={!can(session.space,"content:edit") || busy || editor.connection !== "connected"}
          >
            Retry change
          </Button>
        </div>
      )}
      {published && (
        <div className="notice" role="status">
          <span>
            <Check size={14} style={{ display: "inline", marginRight: 7 }} />
            {published}. Later edits remain drafts.
          </span>
        </div>
      )}
      {clipboardNotice && <div className="notice" role="status"><span>{clipboardNotice}</span><Button variant="ghost" aria-label="Dismiss clipboard message" onClick={()=>setClipboardNotice('')}>×</Button></div>}
      {editor.connection === "disconnected" && (
        <div className="notice notice--warning" role="status">
          Editing is paused while the connection is unavailable. Your unsaved input is kept on this device.
        </div>
      )}
      <div className={previewOpen && !snapshot.story.formOnly ? 'visual-workspace' : undefined}>
      {previewOpen && !snapshot.story.formOnly && <PreviewPanel settings={previewSettings} onSettings={onPreviewSettings} previewId={previewId} onPreviewId={onPreviewId} snapshot={snapshot} spaceId={session.space.id} selectedId={editor.selectedId} onSelect={editor.select} />}
      <div
        className="editor-layout"
        id="locale-editor"
        role="tabpanel"
        aria-labelledby={`locale-tab-${snapshot.locale.spaceLocaleId}`}
      >
        <section className="panel editor-panel" aria-label="Block editor">
          <BlockNavigation snapshot={snapshot} selectedId={editor.selectedId} editors={currentEditors} currentUserId={session.user.id} onSelect={editor.select} onOutline={() => setOutlineOpen(true)} />
          {block && definition ? (
            <>
              <div className="editor-panel-heading">
                <div>
                  <h2>{definition.displayName}</h2>
                  <p>
                    <span className="mono">{definition.name}</span> · schema v
                    {definition.version}
                    <PendingSchemaMigration definitionId={definition.id} schemaOpen={!!schema} />
                  </p>
                </div>
                <div className="button-group">
                  {definition.kind!=='content-type' && <Button variant="ghost" disabled={busy} onClick={()=>void action(()=>copyBlock(block.id))}><Copy aria-hidden="true" />Copy block</Button>}
                  {can(session.space,"schemas:write") && <Button id="edit-block-schema" variant="ghost" onClick={() => void openSchema()} disabled={busy} title={`Edit ${definition.displayName} schema`}>
                    <Settings2 aria-hidden="true" /> Edit schema
                  </Button>}
                  {ownsLease ? (
                    <EditorAvatars editors={[{
                      userId:session.user.id,
                      name:session.user.name,
                      avatarUrl:currentEditors.find(item=>item.userId===session.user.id)?.avatarUrl ?? null,
                      locales:[snapshot.locale.name],
                    }]} currentUserId={session.user.id} />
                  ) : editor.connection === "connecting" ? (
                    <span className="pill">Connecting…</span>
                  ) : (
                    <Button
                      onClick={() =>
                        void action(async () => {
                          await editor.acquire(block.id);
                          await editor.sync();
                        })
                      }
                      disabled={!can(session.space,"content:edit") || busy || editor.connection !== "connected"}
                    >
                      <LockKeyhole /> {can(session.space,"content:edit") ? "Start editing" : "Read only"}
                    </Button>
                  )}
                </div>
              </div>
              {selectedLease && (
                <div className="locked-banner">
                  <LockKeyhole />
                  <BlockEditorAvatar blockId={block.id} snapshot={snapshot} editors={currentEditors} currentUserId={session.user.id} />
                  <span>{selectedEditor?.name ?? "Another editor"} is working on this block. Other blocks are available.</span>
                </div>
              )}
              {blockError && (
                <div className="panel-body" style={{ paddingBottom: 0 }}>
                  <ErrorNotice
                    message={blockError.message}
                    retry={() => void editor.retry()}
                  />
                  {blockError.code === "stale_revision" && currentBuffer && (
                    <>
                      <p className="small muted">
                        Copy your unsaved content before using the saved
                        version. It will not be overwritten automatically.
                      </p>
                      <div className="button-group">
                        <Button onClick={() => void copyRecovery()}>
                          <Copy /> Copy my changes
                        </Button>
                        <Button
                          onClick={() => {
                            if (
                              window.confirm(
                                "Discard your local unsaved changes and use the saved block?",
                              )
                            )
                              void editor.discard(block.id);
                          }}
                        >
                          Use saved version
                        </Button>
                      </div>
                      <details style={{ marginTop: 12 }}>
                        <summary className="small">
                          View my unsaved content
                        </summary>
                        <pre>
                          {JSON.stringify(currentBuffer.fields, null, 2)}
                        </pre>
                      </details>
                    </>
                  )}
                </div>
              )}
              <div className="editor-fields">
                {definition.fields.map((field) =>
                  field.type === "blocks" ? (
                    <div className="field" key={field.name}>
                      <div className="field-label">
                        {field.label}
                        {field.required ? " *" : ""}
                      </div>
                      {field.description && (
                        <p className="field-hint">{field.description}</p>
                      )}
                      <div className="block-list">
                        {snapshot.blocks
                          .filter(
                            (item) =>
                              item.parentId === block.id &&
                              item.parentField === field.name,
                          )
                          .sort((a, b) => a.position - b.position)
                          .map((child) => (
                            <div className="block-list-item" key={child.id} {...sortableProps(child)}>
                              {dragHandle(child)}
                              <button
                                className="entity-title"
                                onClick={() => void editor.select(child.id)}
                              >
                                {blockTitle(snapshot, child)}
                              </button>
                              <span className="small muted">
                                {blockSummary(child)}
                              </span>
                              <div className="button-group">
                                <BlockEditorAvatar blockId={child.id} snapshot={snapshot} editors={currentEditors} currentUserId={session.user.id} />
                                <Button variant="ghost" className="icon-button" disabled={busy} aria-label={`Copy ${blockTitle(snapshot,child)}`} title="Copy block and nested content" onClick={()=>void action(()=>copyBlock(child.id))}><Copy aria-hidden="true" /></Button>
                                <Button
                                  variant="ghost"
                                  className="icon-button"
                                  disabled={disabled}
                                  aria-label={`Remove ${blockTitle(snapshot, child)}`}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove ${blockTitle(snapshot, child)} and its nested blocks? You can restore the page from history.`,
                                      )
                                    )
                                      void action(() =>
                                        editor.runCommand(
                                          {
                                            type: "deleteBlock",
                                            payload: { blockId: child.id },
                                          },
                                          [child.id, block.id],
                                        ),
                                      );
                                  }}
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            </div>
                          ))}
                        {!snapshot.blocks.some(
                          (item) =>
                            item.parentId === block.id &&
                            item.parentField === field.name,
                        ) && (
                          <div className="empty-block-list">
                            Add a block to start composing this section.
                          </div>
                        )}
                        <div className="block-list-add">
                          <div className="button-group">
                            <Button
                              variant="ghost"
                              disabled={
                                disabled ||
                                (field.maxItems !== undefined &&
                                  snapshot.blocks.filter(
                                    (item) =>
                                      item.parentId === block.id &&
                                      item.parentField === field.name,
                                  ).length >= field.maxItems)
                              }
                              onClick={() => {
                                setAddTo({ parentId: block.id, field });
                                setAddDefinition(""); setBlockSearch("");
                              }}
                            >
                              <Plus /> Add block
                            </Button>
                            <Button variant="ghost" disabled={disabled || (field.maxItems!==undefined && snapshot.blocks.filter(item=>item.parentId===block.id && item.parentField===field.name).length>=field.maxItems)} onClick={()=>void action(()=>readAndPaste(block.id,field))}><ClipboardPaste aria-hidden="true" />Paste block</Button>
                            {snapshot.locale.slug !== "" && (
                              <Button
                                variant="ghost"
                                disabled={disabled}
                                onClick={() =>
                                  void startImport(block.id, field)
                                }
                              >
                                <Copy /> Import from Default
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <FieldInput
                      key={`${block.id}:${field.name}`}
                      field={field}
                      value={fields[field.name]}
                      disabled={
                        disabled || blockError?.code === "stale_revision"
                      }
                      onChange={(value) =>
                        editor.edit(block, field.name, value)
                      }
                      error={
                        blockError?.details?.find(
                          (issue) =>
                            issue.path === field.name ||
                            issue.path === `${block.id}.${field.name}`,
                        )?.message
                      }
                    />
                  ),
                )}
                {!definition.fields.length && (
                  <EmptyState title="This block has no fields yet">
                    Add fields in the block library to create a new schema
                    version.
                  </EmptyState>
                )}
              </div>
              <div className="editor-footer">
                <span>Block revision {block.revision}</span>
                <span>Changes save automatically</span>
              </div>
            </>
          ) : currentBuffer ? (
            <div className="panel-body">
              <ErrorNotice message="This block was removed while your edits were unsaved. Your content is preserved here." />
              <pre>{JSON.stringify(currentBuffer.fields, null, 2)}</pre>
              <div className="button-group">
                <Button onClick={() => void copyRecovery()}>
                  <Copy /> Copy my changes
                </Button>
                <Button
                  onClick={() => {
                    if (window.confirm("Discard this recovery copy?"))
                      void editor.discard(editor.selectedId!);
                  }}
                >
                  Discard recovery copy
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState title="Select a block">
              Choose a block from the outline to edit its content.
            </EmptyState>
          )}
        </section>
      </div>
      </div>
      {schema && <SchemaDrawer
        initialDefinition={schema.definition}
        definitions={schema.definitions}
        datasources={schema.datasources}
        canManage={can(session.space,"schemas:write")}
        registerGuard={registerSchemaGuard}
        onClose={() => {
          setSchema(null);
          requestAnimationFrame(() => document.getElementById("edit-block-schema")?.focus());
        }}
        onSave={async () => {
          const latest = await api<BlockDefinition[]>("/definitions");
          onDefinitions(await api<BlockDefinition[]>("/definitions?deployed=true"));
          setSchema(current => current ? { ...current, definitions: latest } : null);
        }}
        description="Editing the shared active migration. Page content changes when an admin deploys it."
      />}
      <Modal open={outlineOpen} onClose={() => setOutlineOpen(false)} title="Story outline" description="Jump to a block, or drag siblings to reorder." className="outline-drawer">
        <p id="outline-reorder-help" className="sr-only">Drag to reorder blocks in the same section, or focus a handle and press the up or down arrow key.</p>
        <p className="sr-only" role="status">{reorderAnnouncement}</p>
        <aside className="tree-panel" aria-label="Block outline">
          <div className="tree-header">
            <span>Story outline</span>
            <span>{snapshot.blocks.length} blocks</span>
          </div>
          <div className="block-tree">
            {tree.map(({ block: item, depth }) => (
              <div className="tree-row" key={item.id} {...sortableProps(item)}>
              <button
                className="tree-item"
                aria-current={item.id === editor.selectedId}
                style={{ paddingLeft: 10 + depth * 16 }}
                onClick={() => { setOutlineOpen(false); void editor.select(item.id); }}
              >
                <Layers />
                <span className="tree-name">{blockTitle(snapshot, item)}</span>
                <BlockEditorAvatar blockId={item.id} snapshot={snapshot} editors={currentEditors} currentUserId={session.user.id} />
                {snapshot.leases.some(
                  (lease) =>
                    lease.blockId === item.id &&
                    lease.sessionId !== session.sessionId && Date.parse(lease.expiresAt) > Date.now(),
                ) && (
                  <LockKeyhole
                    className="tree-lock"
                    aria-label="Being edited"
                  />
                )}
                {editor.buffers[item.id] && (
                  <span className="status-dot" title="Unsaved changes" />
                )}
              </button>
              {item.parentId && dragHandle(item)}
              </div>
            ))}
          </div>
          {rootFields.length > 0 && <div className="tree-actions">
            {rootFields.map((field) => <Button
              key={field.name}
              disabled={structureDisabled || isLocked(root.id) || (field.maxItems !== undefined && snapshot.blocks.filter((item) => item.parentId === root.id && item.parentField === field.name).length >= field.maxItems)}
              onClick={() => { setOutlineOpen(false); setAddTo({ parentId: root.id, field }); setAddDefinition(""); setBlockSearch(""); }}
            ><Plus />{rootFields.length === 1 ? "Add block" : `Add to ${field.label}`}</Button>)}
          </div>}
          <div className="tree-footer">
            Revision {snapshot.revision} · {snapshot.locale.name}
          </div>
        </aside>
      </Modal>
      <Modal open={copyFallback!==null} title="Copy block" description="Clipboard access is unavailable. Copy the selected content, then paste it into a block list." onClose={()=>setCopyFallback(null)}>
        <label className="field">Block to copy<textarea rows={6} readOnly autoFocus value={copyFallback ?? ''} onFocus={event=>event.currentTarget.select()} /></label>
        <Button onClick={()=>setCopyFallback(null)}>Done</Button>
      </Modal>
      <Modal open={!!pasteTo} title={pasteTo?`Paste block into ${pasteTo.field.label}`:'Paste block'} description="Clipboard access is unavailable. Paste your copied block below." onClose={()=>{if(!busy)setPasteTo(null)}}>
        <form onSubmit={event=>{
          event.preventDefault();if(!pasteTo)return;
          setBusy(true);setPasteError('');
          void pasteBlock(pasteText,pasteTo.parentId,pasteTo.field).catch(cause=>setPasteError(errorMessage(cause))).finally(()=>setBusy(false));
        }}>
          <ErrorNotice message={pasteError} />
          <label className="field">Copied block<textarea autoFocus rows={6} value={pasteText} disabled={busy} onChange={event=>setPasteText(event.target.value)} /></label>
          <div className="button-group"><Button disabled={busy} onClick={()=>setPasteTo(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !pasteText.trim()}>{busy?'Pasting…':'Paste block'}</Button></div>
        </form>
      </Modal>
      <Modal
        open={!!addTo}
        closeOnBackdrop
        className="schema-drawer block-picker-drawer"
        onClose={() => !busy && setAddTo(null)}
        title="Add a block"
        description={addTo ? `Choose a block to add to ${addTo.field.label}.` : undefined}
      >
        <div className="block-picker-search">
          <label className="search-input"><Search aria-hidden="true" /><input
            type="search" aria-label="Search blocks" placeholder="Search blocks…" autoFocus
            value={blockSearch} onChange={event => setBlockSearch(event.target.value)}
          /></label>
        </div>
        <div className="schema-drawer-body block-picker-body" aria-busy={busy}>
          <ErrorNotice message={editor.error} />
          {!availableDefinitions.length ? <EmptyState title="No blocks available"><p>Create a nestable or universal block that matches this field’s restrictions.</p></EmptyState>
            : !matchingDefinitions.length
              ? <EmptyState title="No matching blocks"><p>Try another name or tag.</p></EmptyState>
              : <div className="block-picker-list" aria-label="Available blocks">{matchingDefinitions.map(item => <button
                type="button" key={item.id} className="block-picker-item" aria-label={`Add ${item.displayName}`}
                disabled={busy || !can(session.space,"content:edit")}
                onClick={() => { setAddDefinition(item.id); void action(async () => {
                  if (!addTo) return;
                  await editor.runCommand({ type:"insertBlock",payload:{ parentId:addTo.parentId,parentField:addTo.field.name,definitionId:item.id } },[addTo.parentId]);
                  setAddTo(null);
                }); }}
              >
                <span className="block-picker-icon"><Layers aria-hidden="true" /></span>
                <span className="block-picker-copy"><strong>{busy && addDefinition === item.id ? "Adding…" : item.displayName}</strong><span className="mono">{item.name}</span>{!!item.tags?.length && <span className="block-picker-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}</span>
                <Plus className="block-picker-add" aria-hidden="true" />
              </button>)}</div>}
        </div>
        <footer className="schema-drawer-footer"><span className="schema-status">Select a block to add it to this field.</span><Button disabled={busy} onClick={() => setAddTo(null)}>Cancel</Button></footer>
      </Modal>
      <Modal
        open={historyOpen}
        onClose={() => !busy && setHistoryOpen(false)}
        title="Story history"
        description={`Saved checkpoints for ${snapshot.locale.name}. Restores create new history.`}
        wide
      >
        <ErrorNotice message={historyError} />
        {historyLoading ? (
          <Loading />
        ) : (
          <div className="history-list">
            {history.map((item) => (
              <div className="history-item" key={item.id}>
                <div>
                  <strong>Revision {item.revision}</strong>
                  <span className="pill" style={{ marginLeft: 8 }}>
                    {item.reason.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </span>
                  <p>
                    {dateLabel(item.createdAt)} ·{" "}
                    {item.actorId === session.user.id
                      ? "You"
                      : "Another editor"}
                  </p>
                </div>
                <div className="button-group">
                  <Button
                    className="button--small"
                    disabled={busy}
                    onClick={() => void openReview(item.id)}
                  >
                    Review
                  </Button>
                  {block && block.parentId && (
                    <Button
                      className="button--small"
                      disabled={!can(session.space,"content:edit") || busy}
                      onClick={() => void restore(item, "block")}
                    >
                      <RotateCcw /> This block
                    </Button>
                  )}
                  <Button
                    className="button--small"
                    disabled={!can(session.space,"content:edit") || busy}
                    onClick={() => void restore(item, "page")}
                  >
                    <RotateCcw /> Page
                  </Button>
                </div>
              </div>
            ))}
            {!history.length && <EmptyState title="No saved checkpoints yet" />}
          </div>
        )}
      </Modal>
      <Modal
        open={!!review}
        onClose={() => !busy && setReview(null)}
        title="Review before publishing"
        description={
          review
            ? `This publishes revision ${review.revision}, saved ${dateLabel(review.createdAt)}. Later edits stay in the draft.`
            : undefined
        }
        wide
      >
        {review && (
          <>
            <div className="review-label">
              <LockKeyhole size={14} />
              This checkpoint is fixed while you review it.
            </div>
            <div className="content-path-preview"><span>URL to publish · {review.snapshot.locale.name}</span><code>/{[review.snapshot.locale.slug,review.snapshot.locale.urlSlug].filter(Boolean).join('/')}</code></div>
            <ul className="review-tree">
              {outline(review.snapshot).map(({ block, depth }) => (
                <li style={{ paddingLeft: depth * 18 }} key={block.id}>
                  {blockTitle(review.snapshot, block)}{" "}
                  <span className="small muted">
                    · revision {block.revision}
                  </span>
                </li>
              ))}
            </ul>
            <details open>
              <summary className="small">Review saved content</summary>
              <pre className="read-only-json">
                {JSON.stringify(review.content, null, 2)}
              </pre>
            </details>
            <ErrorNotice message={reviewError} />
            {!!issues.length && (
              <ul className="field-error-list">
                {issues.map((issue, index) => (
                  <li key={index}>
                    {issue.path}: {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions">
              <Button disabled={busy} onClick={() => setReview(null)}>
                Keep editing
              </Button>
              <Button
                variant="primary"
                disabled={!can(session.space,"content:publish") || busy || editor.connection !== "connected"}
                onClick={() => void publish()}
              >
                <Upload />
                {busy ? "Publishing…" : `Publish revision ${review.revision}`}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!importTo}
        onClose={() => !busy && setImportTo(null)}
        title="Import from Default"
        description="Selected blocks and their nested content become independent copies in this locale."
        wide
      >
        <ErrorNotice message={importError} />
        {!source && !importError ? (
          <Loading />
        ) : (
          source && (
            <div className="import-list">
              {outline(source)
                .filter(({ block }) => !!block.parentId)
                .map(({ block, depth }) => {
                  const definition = definitionFor(source, block);
                  const allowed = !!importTo && !!definition && isBlockAllowed(importTo.field, definition);
                  return (
                    <label
                      key={block.id}
                      style={{ paddingLeft: 16 + (depth - 1) * 18 }}
                    >
                      <input
                        type="checkbox"
                        checked={importIds.includes(block.id)}
                        disabled={!allowed}
                        onChange={(event) =>
                          setImportIds(
                            event.target.checked
                              ? [...importIds, block.id]
                              : importIds.filter((id) => id !== block.id),
                          )
                        }
                      />
                      <span>
                        <strong>{blockTitle(source, block)}</strong>
                        <small>
                          {typeof block.fields.title === "string"
                            ? block.fields.title
                            : allowed
                              ? "Includes nested blocks"
                              : "Not allowed in this field"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              {source.blocks.length <= 1 && (
                <EmptyState title="Default has no nested blocks yet" />
              )}
            </div>
          )
        )}
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => setImportTo(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!importIds.length || busy}
            onClick={() => void importSelected()}
          >
            <Copy />
            {busy ? "Importing…" : `Import ${importIds.length} selected`}
          </Button>
        </div>
      </Modal>
    </>
  );
}
