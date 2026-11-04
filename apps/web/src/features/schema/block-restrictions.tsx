"use client";

import { useState } from "react";
import { Boxes, Search, Tags, X } from "lucide-react";
import { isBlockAllowed, type BlockDefinition, type FieldDefinition } from "@blok/core";
import { Field } from "@blok/ui";

export function BlockRestrictions({ field, definitions, onChange }: {
  field: Extract<FieldDefinition, { type: "blocks" }>;
  definitions: BlockDefinition[];
  onChange: (field: FieldDefinition) => void;
}) {
  const [query, setQuery] = useState("");
  const byTags = field.allowedTags !== undefined;
  const selected = (byTags ? field.allowedTags : field.allowedDefinitionIds) ?? [];
  const nestable = definitions.filter(item => item.kind !== "content-type");
  const choices = byTags
    ? [...new Set([...nestable.flatMap(item => item.tags ?? []), ...selected])].sort().map(tag => {
      const count = nestable.filter(item => item.tags?.includes(tag)).length;
      return { id: tag, label: tag, detail: `${count} ${count === 1 ? "block" : "blocks"}` };
    })
    : nestable.map(item => ({ id: item.id, label: item.displayName, detail: [item.name, ...(item.tags ?? [])].join(" · ") }));
  const filtered = choices.filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  const matches = byTags ? nestable.filter(item => isBlockAllowed(field, item)) : [];
  function select(values: string[]) {
    onChange({ ...field, ...(byTags ? { allowedTags: values } : { allowedDefinitionIds: values }) });
  }
  return <Field label="Allowed blocks" description={byTags
    ? "Allow blocks matching any selected tag. No tags selected allows any nestable or universal block."
    : "Leave all unchecked to allow any nestable or universal block."}>
    <div className="block-restrictions">
      <div className="restriction-mode" role="group" aria-label="Restrict allowed blocks by">
        {([false, true] as const).map(tags => <button key={String(tags)} type="button" aria-pressed={byTags === tags} onClick={() => {
          if (tags === byTags) return;
          setQuery("");
          onChange({ ...field, allowedDefinitionIds: undefined, allowedTags: tags ? [] : undefined });
        }}>{tags ? <Tags aria-hidden="true" /> : <Boxes aria-hidden="true" />}{tags ? "Tags" : "Blocks"}</button>)}
      </div>
      <div className="search-input"><Search aria-hidden="true" /><input type="search" aria-label={byTags ? "Search allowed tags" : "Search allowed blocks"} placeholder={byTags ? "Search tags…" : "Search blocks by name or tag…"} value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="restriction-selection"><span>{selected.length ? `${selected.length} selected` : "All nestable blocks"}</span>{selected.length > 0 && <button type="button" onClick={() => select([])}>Clear selection</button>}</div>
      {byTags && selected.length > 0 && <div className="restriction-tags">{selected.map(tag => <button type="button" key={tag} aria-label={`Remove tag ${tag}`} onClick={() => select(selected.filter(value => value !== tag))}><Tags aria-hidden="true" />{tag}<X aria-hidden="true" /></button>)}</div>}
      <div className="restriction-choices">
        {filtered.map(item => <label key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} onChange={event => select(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
          <span><strong>{item.label}</strong><small>{item.detail}</small></span>
        </label>)}
        {!filtered.length && <p role="status">{query ? "No matches. Try another search." : byTags ? "Add tags to blocks in their Config tab to use them here." : "No nestable blocks yet."}</p>}
      </div>
      {byTags && <div className="restriction-matches"><strong>{matches.length} matching {matches.length === 1 ? "block" : "blocks"}</strong><p>{matches.length ? matches.map(item => item.displayName).join(", ") : "No blocks currently match these tags."}</p></div>}
    </div>
  </Field>;
}
