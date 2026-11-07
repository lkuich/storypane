'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReviewPerson } from '@storypane/core';
import {
  insertMention,
  mentionQuery,
  updateMentions,
  type Mention,
  type MentionQuery,
} from './mentions';

export function MentionInput({
  members,
  value,
  mentions,
  onChange,
  label = 'Message',
  required = false,
}: {
  members: ReviewPerson[];
  value: string;
  mentions: Mention[];
  onChange: (value: string, mentions: Mention[]) => void;
  label?: string;
  required?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const lastSelection = useRef<{ start: number; end: number } | null>(null);
  const selection = useRef<{ start: number; end: number } | undefined>(undefined);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const matches = query
    ? members
        .filter((member) =>
          `${member.name} ${member.email}`
            .toLocaleLowerCase()
            .includes(query.text.trimEnd().toLocaleLowerCase()),
        )
        .slice(0, 8)
    : [];
  const open = query !== null && matches.length > 0;
  const selected = Math.min(active, matches.length - 1);
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value, mentions]);
  useEffect(() => {
    if (open)
      document.getElementById(`${id}-option-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, open, selected]);
  function choose(member: ReviewPerson) {
    if (!query || input.current?.disabled || input.current?.matches(':disabled')) return;
    const next = insertMention(value, mentions, query, member);
    if (!next) return;
    caret.current = next.caret;
    setQuery(null);
    setActive(0);
    onChange(next.value, next.mentions);
  }
  return (
    <div className="review-message-input field">
      <label htmlFor={id}>{label}</label>
      <div className="mention-editor">
        <textarea
          ref={input}
          id={id}
          required={required}
          maxLength={10000}
          rows={3}
          value={value}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={open ? `${id}-suggestions` : undefined}
          aria-activedescendant={open ? `${id}-option-${selected}` : undefined}
          onBeforeInput={(event) => {
            selection.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            lastSelection.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
            const updated = updateMentions(value, next, mentions, selection.current);
            selection.current = undefined;
            onChange(next, updated);
            setActive(0);
            setQuery(
              (event.nativeEvent as InputEvent).isComposing
                ? null
                : mentionQuery(
                    next,
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                    updated,
                  ),
            );
          }}
          onSelect={(event) => {
            const start = event.currentTarget.selectionStart,
              end = event.currentTarget.selectionEnd;
            if (lastSelection.current?.start === start && lastSelection.current.end === end) return;
            lastSelection.current = { start, end };
            setQuery(
              mentionQuery(
                value,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
                mentions,
              ),
            );
            setActive(0);
          }}
          onCompositionEnd={(event) => {
            setQuery(
              mentionQuery(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
                mentions,
              ),
            );
            setActive(0);
          }}
          onBlur={() => {
            setQuery(null);
            lastSelection.current = null;
          }}
          onKeyDown={(event) => {
            if (
              !open ||
              event.nativeEvent.isComposing ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              (event.shiftKey && event.key !== 'Escape')
            )
              return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(
                (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
              );
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              event.stopPropagation();
              choose(matches[selected]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setQuery(null);
            }
          }}
          placeholder="Share context or leave feedback… Type @ to mention someone."
        />
        {open && (
          <div
            className="mention-suggestions"
            id={`${id}-suggestions`}
            role="listbox"
            aria-label="Mention a person"
          >
            {matches.map((member, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                tabIndex={-1}
                id={`${id}-option-${index}`}
                key={member.id}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(member)}
              >
                <span className="avatar" aria-hidden="true">
                  {member.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{member.name}</strong>
                  <small>{member.email}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
