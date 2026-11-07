'use client';

import { useRef, useState } from 'react';
import { Boxes, GitBranch, Search, X } from 'lucide-react';
import type { BlockDefinition, FieldDefinition } from '@storypane/core';
import { Field } from '@storypane/ui';

export function BlockRestrictions({
  field,
  definitions,
  definitionId,
  onChange,
}: {
  field: Extract<FieldDefinition, { type: 'blocks' }>;
  definitions: BlockDefinition[];
  definitionId?: string;
  onChange: (field: FieldDefinition) => void;
}) {
  const [query, setQuery] = useState('');
  const [chosenTab, setChosenTab] = useState<'nested' | 'blocks' | null>(null);
  const [excludeNested, setExcludeNested] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const selected = field.allowedDefinitionIds ?? [];
  const eligible = definitions.filter((item) => item.kind !== 'content-type');
  const nested = eligible.filter(
    (item) => definitionId && item.parentDefinitionId === definitionId,
  );
  const tab = chosenTab ?? (nested.length ? 'nested' : 'blocks');
  const choices =
    tab === 'nested'
      ? nested
      : eligible.filter((item) => !excludeNested || !item.parentDefinitionId);
  const filtered = choices.filter((item) =>
    `${item.displayName} ${item.name} ${(item.tags ?? []).join(' ')}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  function select(values: string[]) {
    const { allowedTags: _tags, ...rest } = field;
    onChange({ ...rest, allowedDefinitionIds: values });
  }
  return (
    <Field
      label="Allowed blocks"
      description="Leave all unchecked to allow any nestable or universal block."
    >
      <div className="block-restrictions">
        <div className="restriction-mode" role="group" aria-label="Browse allowed blocks">
          {(['nested', 'blocks'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => {
                setChosenTab(value);
                setQuery('');
              }}
            >
              {value === 'nested' ? <GitBranch aria-hidden="true" /> : <Boxes aria-hidden="true" />}
              {value === 'nested' ? 'Nested' : 'Blocks'}
            </button>
          ))}
        </div>
        <div className="search-input">
          <Search aria-hidden="true" />
          <input
            ref={search}
            type="search"
            aria-label="Search allowed blocks"
            placeholder="Search blocks…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {tab === 'blocks' && (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={excludeNested}
              onChange={(event) => setExcludeNested(event.target.checked)}
            />
            Exclude nested blocks
          </label>
        )}
        <div className="restriction-selection">
          <span>
            {field.allowedTags?.length
              ? 'Legacy tag restriction'
              : selected.length
                ? `${selected.length} selected`
                : 'All nestable and universal blocks'}
          </span>
          {(selected.length > 0 || !!field.allowedTags?.length) && (
            <button type="button" onClick={() => select([])}>
              Clear selection
            </button>
          )}
        </div>
        {selected.length > 0 && (
          <div className="option-selections" role="group" aria-label="Selected allowed blocks">
            {selected.map((id) => {
              const definition = definitions.find((item) => item.id === id);
              const name = definition?.displayName ?? id;
              return (
                <button
                  key={id}
                  type="button"
                  title={definition ? `${name} (${definition.name})` : id}
                  aria-label={`Remove ${name} from allowed blocks`}
                  onClick={() => {
                    search.current?.focus();
                    select(selected.filter((value) => value !== id));
                  }}
                >
                  {name}
                  <X aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
        <div className="restriction-choices">
          {filtered.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  select(
                    event.target.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id),
                  )
                }
              />
              <span>
                <strong>{item.displayName}</strong>
                <small>{item.name}</small>
              </span>
            </label>
          ))}
          {!filtered.length && (
            <p role="status">
              {query
                ? 'No matches. Try another search.'
                : tab === 'nested'
                  ? 'No nested blocks yet. Set this block as a parent, or browse all blocks.'
                  : 'No nestable blocks yet.'}
            </p>
          )}
        </div>
      </div>
    </Field>
  );
}
