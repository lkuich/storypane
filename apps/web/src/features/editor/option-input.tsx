'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, Search, X } from 'lucide-react';
import type {
  Json,
  OptionItem,
  OptionPage,
  OptionSource,
  OptionRequestContext,
} from '@storypane/core';
import { Button, ErrorNotice } from '@storypane/ui';
import { EditorAvatars } from '../../components/editor-avatars';
import { PublicationStatus } from '../../components/publication-status';
import { usePageEditors } from './use-page-editors';
import { api, errorMessage, jsonRequest } from './api';
import { selectedSpaceId, storyUrl } from '../../lib/space-url';

function StoryOptionStatus({
  item,
  locale,
  id,
}: {
  item?: OptionItem;
  locale: string | undefined;
  id?: string;
}) {
  const publication = item?.publication;
  if (!publication) return null;
  const explanation =
    publication.status === 'draft'
      ? 'This story has not been published.'
      : publication.status === 'changed'
        ? 'The previous published version is live; newer draft changes are not published.'
        : 'This story is published.';
  return (
    <span
      id={id}
      className="option-story-status"
      title={`${publication.localeName}: ${explanation}`}
    >
      <PublicationStatus
        status={publication.status}
        localeName={publication.localeSlug !== locale ? publication.localeName : undefined}
      />
    </span>
  );
}

export function OptionInput({
  source,
  value,
  multiple = false,
  onChange,
  disabled,
  label,
  id: controlId,
  placeholder,
  refreshKey,
  context,
}: {
  id?: string;
  source: OptionSource;
  value: Json | undefined;
  multiple?: boolean;
  onChange: (value: Json) => void;
  disabled: boolean;
  label: string;
  placeholder?: string;
  refreshKey?: string;
  context?: OptionRequestContext;
}) {
  const spaceId = selectedSpaceId();
  const locale =
    source.type === 'stories' && typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('locale') ?? undefined)
      : undefined;
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [retry, setRetry] = useState(0);
  const editors = usePageEditors(source.type === 'stories' && open);
  const [page, setPage] = useState<OptionPage>({ items: [] }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<OptionItem[]>([]);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null);
  const generation = useRef(0),
    id = useId();
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string' && value
      ? [value]
      : [];
  const sourceKey = JSON.stringify(source),
    contextKey = JSON.stringify(context),
    selectedKey = JSON.stringify(selected);
  useEffect(() => {
    setSaved([]);
  }, [sourceKey, contextKey, spaceId, locale]);
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const values: string[] = JSON.parse(selectedKey);
    if (!values.length) return;
    const controller = new AbortController();
    async function refresh() {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const result = await api<OptionPage>('/options', {
          ...jsonRequest('POST', {
            source: JSON.parse(sourceKey),
            values,
            locale,
            context: contextKey ? JSON.parse(contextKey) : undefined,
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });
        if (!cancelled)
          setSaved((current) => [
            ...current.filter((item) => !values.includes(item.value)),
            ...values.map(
              (value) =>
                result.items.find((item) => item.value === value) ?? {
                  value,
                  label: current.find((item) => item.value === value)?.label ?? value,
                },
            ),
          ]);
      } catch {
        // Keep labels usable without claiming a stale publication status.
        if (!cancelled)
          setSaved((current) => current.map(({ publication: _publication, ...item }) => item));
      } finally {
        busy = false;
      }
    }
    void refresh();
    const stories = JSON.parse(sourceKey).type === 'stories';
    const timer = stories ? setInterval(() => void refresh(), 30_000) : undefined;
    if (stories) {
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refresh);
    }
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [sourceKey, contextKey, selectedKey, retry, spaceId, locale, refreshKey]);
  useEffect(() => {
    const current = ++generation.current;
    if (!open) return;
    setLoading(true);
    setError(null);
    setPage({ items: [] });
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        void api<OptionPage>('/options', {
          ...jsonRequest('POST', {
            source: JSON.parse(sourceKey),
            query,
            locale,
            context: contextKey ? JSON.parse(contextKey) : undefined,
          }),
          signal: controller.signal,
        })
          .then((result) => {
            if (current === generation.current) setPage(result);
          })
          .catch((cause) => {
            if (!controller.signal.aborted && current === generation.current)
              setError(errorMessage(cause));
          })
          .finally(() => {
            if (current === generation.current) setLoading(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      generation.current += 1;
    };
  }, [sourceKey, contextKey, query, retry, open, locale, spaceId, refreshKey]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function choose(item: OptionItem) {
    if (disabled) return;
    setSaved((current) => [...current.filter((old) => old.value !== item.value), item]);
    onChange(
      multiple
        ? selected.includes(item.value)
          ? selected.filter((value) => value !== item.value)
          : [...selected, item.value]
        : item.value,
    );
    if (!multiple) close();
  }
  async function more() {
    const current = generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api<OptionPage>(
        '/options',
        jsonRequest('POST', { source, query, cursor: page.nextCursor, locale, context }),
      );
      if (current === generation.current) {
        search.current?.focus();
        setPage((previous) => ({
          ...next,
          items: [
            ...previous.items,
            ...next.items.filter((item) => !previous.items.some((old) => old.value === item.value)),
          ],
        }));
      }
    } catch (cause) {
      if (current === generation.current) setError(errorMessage(cause));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  const itemFor = (value: string) =>
    saved.find((item) => item.value === value) ?? page.items.find((item) => item.value === value);
  const titleFor = (value: string) =>
    itemFor(value)?.label ??
    (source.type === 'inline'
      ? source.items.find((item) => item.value === value)?.label
      : undefined) ??
    value;
  return (
    <div
      className="option-picker"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const options = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[data-option]') ?? [],
          );
          const index = options.indexOf(event.target as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? options[index + 1] : options[index - 1];
          if (next) {
            event.preventDefault();
            next.focus();
          } else if (event.key === 'ArrowUp' && index === 0) {
            event.preventDefault();
            search.current?.focus();
          }
        }
        if (event.key === 'Enter' && event.target === search.current && !loading && page.items[0]) {
          event.preventDefault();
          choose(page.items[0]);
        }
      }}
    >
      <div className="option-control">
        <button
          ref={trigger}
          id={controlId}
          type="button"
          className="option-trigger"
          aria-label={label}
          aria-describedby={`${id}-value${selected.length === 1 && itemFor(selected[0])?.publication ? ` ${id}-status` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          disabled={disabled}
          onClick={() => {
            setQuery('');
            setOpen((current) => !current);
          }}
        >
          <span id={`${id}-value`} className="option-trigger-value">
            {selected.length
              ? selected.map(titleFor).join(', ')
              : (placeholder ??
                (source.type === 'stories' ? 'Choose a page…' : 'Choose an option…'))}
          </span>
          {source.type === 'stories' && selected.length === 1 && (
            <StoryOptionStatus item={itemFor(selected[0])} locale={locale} id={`${id}-status`} />
          )}
          <ChevronDown aria-hidden="true" />
        </button>
        {source.type === 'stories' && spaceId && selected.length === 1 && (
          <a
            className="button button--ghost icon-button option-story-link"
            href={storyUrl({ spaceId, storyId: selected[0] })}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${titleFor(selected[0])} story (new tab)`}
            title="Open story in a new tab"
          >
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        )}
      </div>
      {source.type === 'stories' && spaceId && selected.length > 1 && (
        <div className="option-story-links">
          {selected.map((value) => (
            <a
              key={value}
              href={storyUrl({ spaceId, storyId: value })}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${titleFor(value)} story (new tab)`}
            >
              {titleFor(value)}
              <StoryOptionStatus item={itemFor(value)} locale={locale} />
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
      {open && (
        <div id={id} role="dialog" aria-label={`${label} options`} className="option-popover">
          <div className="search-input">
            <Search aria-hidden="true" />
            <input
              ref={search}
              type="search"
              maxLength={200}
              aria-label={`Search ${label} options`}
              placeholder={
                source.type === 'stories' ? 'Search pages or paste a page ID…' : 'Search options…'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {multiple && selected.length > 0 && (
            <div className="option-selections">
              {selected.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`Remove ${titleFor(value)}`}
                  onClick={() => {
                    search.current?.focus();
                    onChange(selected.filter((item) => item !== value));
                  }}
                >
                  {titleFor(value)}
                  <X aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <div className="option-results" aria-busy={loading}>
            {page.items.map((item) => (
              <button
                type="button"
                data-option
                key={item.value}
                className="option-result"
                aria-pressed={selected.includes(item.value)}
                onClick={() => choose(item)}
              >
                <span>
                  <strong>{item.label}</strong>
                  {source.type === 'stories' && <StoryOptionStatus item={item} locale={locale} />}
                  {item.description && <small>{item.description}</small>}
                  {source.type === 'stories' && <small className="mono">{item.value}</small>}
                </span>
                {source.type === 'stories' && <EditorAvatars editors={editors[item.value] ?? []} />}
                {selected.includes(item.value) && <Check aria-hidden="true" />}
              </button>
            ))}
            {!page.items.length && !loading && !error && (
              <p className="option-empty">
                {source.type === 'stories'
                  ? 'No matching pages in this space.'
                  : 'No matching options.'}
              </p>
            )}
            {loading && (
              <p className="option-empty" role="status">
                Loading…
              </p>
            )}
          </div>
          <ErrorNotice message={error} retry={() => setRetry((current) => current + 1)} />
          <div className="option-footer">
            {selected.length > 0 && (
              <Button
                variant="ghost"
                className="button--small"
                onClick={() => {
                  onChange(multiple ? [] : null);
                  if (!multiple) close();
                }}
              >
                Clear selection
              </Button>
            )}
            {page.nextCursor && (
              <Button className="button--small" disabled={loading} onClick={() => void more()}>
                Load more choices
              </Button>
            )}
            {multiple && (
              <Button className="button--small" onClick={close}>
                Done
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
