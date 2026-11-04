"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlignLeft, Boxes, Braces, CalendarDays, ChevronDown, Code, Hash, ImageIcon, Link, ListChecks, ListFilter, Search, ToggleLeft, Type, type LucideIcon } from "lucide-react";
import type { FieldDefinition } from "@storypane/core";

type FieldChoice = {
  id: string;
  type: FieldDefinition["type"];
  label: string;
  icon: LucideIcon;
  tone: string;
  format?: Extract<FieldDefinition, { type: "text" }>["format"];
};
export const FIELD_CHOICES: FieldChoice[] = [
  { type: "blocks", id: "blocks", label: "Blocks", icon: Boxes, tone: "slate" },
  { type: "text", id: "text", label: "Text", icon: Type, tone: "green", format: "singleline" },
  { type: "text", id: "textarea", label: "Textarea", icon: AlignLeft, tone: "blue", format: "textarea" },
  { type: "text", id: "richtext", label: "Richtext", icon: Braces, tone: "amber", format: "richtext" },
  { type: "text", id: "markdown", label: "Markdown", icon: Code, tone: "amber", format: "markdown" },
  { type: "number", id: "number", label: "Number", icon: Hash, tone: "rose" },
  { type: "datetime", id: "datetime", label: "Date / Time", icon: CalendarDays, tone: "violet" },
  { type: "boolean", id: "boolean", label: "Boolean", icon: ToggleLeft, tone: "violet" },
  { type: "option", id: "option", label: "Single Option", icon: ListFilter, tone: "blue" },
  { type: "options", id: "options", label: "Multi Options", icon: ListChecks, tone: "slate" },
  { type: "asset", id: "asset", label: "Asset", icon: ImageIcon, tone: "green" },
  { type: "link", id: "link", label: "Link", icon: Link, tone: "amber" },
];

export function choiceForField(field: FieldDefinition) {
  return FIELD_CHOICES.find(choice => choice.type === field.type && (field.type !== "text" || choice.format === field.format))!;
}

export function FieldTypePicker({ value, onChange, id, compact = false }: { value: FieldChoice; onChange: (choice: FieldChoice) => void; id?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const Icon = value.icon;
  const choices = FIELD_CHOICES.filter(choice => choice.label.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return <div ref={root} className={`field-type-picker${compact ? "" : " field-type-picker--full"}`} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (open && event.target === search.current && event.key === "Enter") {
      event.preventDefault();
      if (choices[0]) { onChange(choices[0]); close(); }
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <button ref={trigger} id={id} type="button" className="field-type-trigger" aria-label={compact ? `Choose field type: ${value.label}` : undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined} title={value.label} onClick={() => { setQuery(""); setOpen(current => !current); }}>
      <span className="field-type-icon" data-tone={value.tone}><Icon aria-hidden="true" /></span>{!compact && <span>{value.label}</span>}<ChevronDown aria-hidden="true" />
    </button>
    {open && <div id={menuId} role="dialog" aria-label="Choose field type" className="field-type-menu">
      <label htmlFor={`${menuId}-filter`}>Filter field types</label>
      <div className="search-input"><Search aria-hidden="true" /><input ref={search} id={`${menuId}-filter`} type="search" placeholder="Filter field types…" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="field-type-grid">
        {choices.map(choice => <button type="button" key={choice.id} aria-pressed={value.id === choice.id} onClick={() => { onChange(choice); close(); }}>
          <span className="field-type-icon" data-tone={choice.tone}><choice.icon aria-hidden="true" /></span><span>{choice.label}</span>
        </button>)}
      </div>
      {!choices.length && <p className="field-type-empty" role="status">No field types match “{query}”.</p>}
    </div>}
  </div>;
}
