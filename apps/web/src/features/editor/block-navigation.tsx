"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers, ListTree } from "lucide-react";
import { Button } from "@blok/ui";
import type { BlockDraft, LocaleSnapshot } from "@blok/core";

export function definitionFor(snapshot: LocaleSnapshot, block: BlockDraft) {
  return snapshot.definitions.find(definition => definition.versionId === block.schemaVersionId);
}
export function blockTitle(snapshot: LocaleSnapshot, block: BlockDraft) {
  return definitionFor(snapshot, block)?.displayName ?? "Block";
}
export function blockSummary(block: BlockDraft) {
  const text = block.fields.title ?? block.fields.name ?? Object.values(block.fields).find(value => typeof value === "string" && value.trim());
  return typeof text === "string" ? text.slice(0, 100) : "";
}

export function BlockNavigation({ snapshot, selectedId, onSelect, onOutline }: {
  snapshot: LocaleSnapshot;
  selectedId: string | null;
  onSelect: (id: string) => Promise<void>;
  onOutline: () => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { setMenu(null); }, [selectedId]);
  useEffect(() => {
    if (!menu) return;
    function outside(event: PointerEvent) {
      if (!nav.current?.contains(event.target as Node)) setMenu(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenu(null);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const path: BlockDraft[] = [];
  let block = snapshot.blocks.find(item => item.id === selectedId);
  const seen = new Set<string>();
  while (block && !seen.has(block.id)) {
    seen.add(block.id);
    path.unshift(block);
    block = snapshot.blocks.find(item => item.id === block!.parentId);
  }
  function select(id: string) {
    if (menu) trigger.current?.focus();
    setMenu(null);
    void onSelect(id);
  }

  return <div className="editor-navigation">
    <nav ref={nav} className="block-breadcrumbs" aria-label="Block path" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenu(null);
    }}>
      <ol>
        {path.map((item, index) => {
          const parent = path[index - 1];
          const field = parent && definitionFor(snapshot, parent)?.fields.find(field => field.name === item.parentField);
          const siblings = snapshot.blocks.filter(sibling => sibling.parentId === item.parentId && sibling.parentField === item.parentField).sort((a, b) => a.position - b.position);
          return <Fragment key={parent ? `${parent.id}:${item.parentField}` : item.id}>
            {parent && <li className="block-path-field">
              <ChevronRight aria-hidden="true" />
              <button className="block-path-menu-trigger" aria-label={`Browse ${field?.label ?? item.parentField} blocks in ${blockTitle(snapshot, parent)}`} aria-expanded={menu === item.id} aria-controls={menu === item.id ? `block-path-menu-${item.id}` : undefined} onClick={event => {
                trigger.current = event.currentTarget;
                setMenu(menu === item.id ? null : item.id);
              }}>{field?.label ?? item.parentField}<ChevronDown aria-hidden="true" /></button>
              {menu === item.id && <div id={`block-path-menu-${item.id}`} className="block-path-menu" role="group" aria-label={`${field?.label ?? item.parentField} blocks`}>
                <p>{field?.label ?? item.parentField}<span>{siblings.length} blocks</span></p>
                {siblings.map((sibling, position) => <button key={sibling.id} aria-current={sibling.id === selectedId ? "true" : undefined} onClick={() => select(sibling.id)}>
                  <span className="block-path-position">{position + 1}</span>
                  <span><strong>{blockTitle(snapshot, sibling)}</strong><small>{blockSummary(sibling) || `Block ${position + 1}`}</small></span>
                </button>)}
              </div>}
            </li>}
            <li>
              {index === 0 ? <Layers aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              <button className="block-path-link" aria-current={item.id === selectedId ? "location" : undefined} onClick={() => select(item.id)} title={blockSummary(item) || undefined}>{blockTitle(snapshot, item)}</button>
            </li>
          </Fragment>;
        })}
      </ol>
    </nav>
    <Button variant="ghost" className="button--small outline-toggle" onClick={onOutline}><ListTree /> Outline</Button>
  </div>;
}
