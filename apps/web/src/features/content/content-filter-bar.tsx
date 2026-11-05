'use client';

import { useState } from 'react';
import { ArrowDownWideNarrow, Search, SlidersHorizontal, Trash2, Undo2, X } from 'lucide-react';
import type { OptionItem, StorySummary } from '@storypane/core';
import { Button, Field } from '@storypane/ui';
import { OptionInput } from '../editor/option-input';
import { defaultFilters, type ContentFilters } from './content-filters';

const statuses = [
  { value: 'draft', label: 'Draft' },
  { value: 'changed', label: 'Unpublished changes' },
  { value: 'published', label: 'Published' },
];
const dates = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom date range' },
];

export function ContentFilterBar({
  filters,
  onChange,
  stories,
  count,
  loading,
  deleted,
  onToggleDeleted,
  scheduleFilter,
  onScheduleChange,
}: {
  filters: ContentFilters;
  onChange: (next: ContentFilters) => void;
  stories: StorySummary[];
  count: number;
  loading: boolean;
  deleted: boolean;
  onToggleDeleted: () => void;
  scheduleFilter: string;
  onScheduleChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const authors = Array.from(
    new Map(
      stories.flatMap((story) =>
        story.modifiedBy
          ? [
              [
                story.modifiedBy.id,
                { value: story.modifiedBy.id, label: story.modifiedBy.name },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));
  const types = Array.from(
    new Map(
      stories.flatMap((story) =>
        story.contentType
          ? [
              [
                story.contentType.id,
                { value: story.contentType.id, label: story.contentType.name },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));
  const groups: {
    key: 'status' | 'modified' | 'modifiedBy' | 'contentType';
    label: string;
    placeholder: string;
    items: OptionItem[];
  }[] = [
    { key: 'status', label: 'Status', placeholder: 'All statuses', items: statuses },
    { key: 'modified', label: 'Date modified', placeholder: 'Any date', items: dates },
    { key: 'modifiedBy', label: 'Modified by', placeholder: 'Anyone', items: authors },
    { key: 'contentType', label: 'Content type', placeholder: 'All content types', items: types },
  ];
  const active = groups.filter((group) => filters[group.key]);
  const activeCount = active.length + Number(!!scheduleFilter);
  const hasSearch = !!filters.query.trim();
  const invalidRange =
    filters.modified === 'custom' && filters.from && filters.to && filters.from > filters.to;
  function update(key: (typeof groups)[number]['key'], value: string) {
    onChange({ ...filters, [key]: value, ...(key === 'modified' ? { from: '', to: '' } : {}) });
  }
  return (
    <section className="content-filter-bar" aria-label="Find stories">
      <div className="toolbar content-toolbar">
        <div className="search-input">
          <Search aria-hidden="true" />
          <input
            type="search"
            maxLength={200}
            aria-label="Search stories"
            placeholder="Search by name, path, or page ID…"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
          />
        </div>
        <Button
          aria-expanded={open}
          aria-controls="content-filters"
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal aria-hidden="true" /> Filters
          {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
        </Button>
        <label className="content-sort">
          <ArrowDownWideNarrow aria-hidden="true" />
          <select
            aria-label="Sort stories"
            value={filters.sort}
            onChange={(event) =>
              onChange({ ...filters, sort: event.target.value as ContentFilters['sort'] })
            }
          >
            <option value="newest">Recently modified</option>
            <option value="oldest">Oldest modified</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>
      {open && (
        <div className="content-filter-panel" id="content-filters">
          {groups.map((group) => (
            <Field key={group.key} label={group.label} htmlFor={`content-filter-${group.key}`}>
              <OptionInput
                id={`content-filter-${group.key}`}
                label={group.label}
                placeholder={group.placeholder}
                source={{ type: 'inline', items: group.items }}
                value={filters[group.key]}
                disabled={loading}
                onChange={(value) => update(group.key, typeof value === 'string' ? value : '')}
              />
            </Field>
          ))}
          {!deleted && (
            <Field label="Schedule" htmlFor="content-filter-schedule">
              <select
                id="content-filter-schedule"
                aria-label="Filter schedules"
                value={scheduleFilter}
                disabled={loading}
                onChange={(event) => onScheduleChange(event.target.value)}
              >
                <option value="">All schedules</option>
                <option value="pending">Scheduled</option>
                <option value="failed">Failed schedules</option>
              </select>
            </Field>
          )}
          {filters.modified === 'custom' && (
            <div className="content-date-range">
              <Field label="From" htmlFor="content-filter-from">
                <input
                  id="content-filter-from"
                  type="date"
                  max={filters.to || undefined}
                  value={filters.from}
                  onChange={(event) => onChange({ ...filters, from: event.target.value })}
                />
              </Field>
              <Field label="Through" htmlFor="content-filter-to">
                <input
                  id="content-filter-to"
                  type="date"
                  min={filters.from || undefined}
                  value={filters.to}
                  aria-invalid={!!invalidRange}
                  aria-describedby="content-date-hint"
                  onChange={(event) => onChange({ ...filters, to: event.target.value })}
                />
              </Field>
              <p id="content-date-hint" className={invalidRange ? 'field-error' : 'field-hint'}>
                {invalidRange
                  ? 'The end date must be on or after the start date.'
                  : 'Dates include the entire day in your local time. Leave either end open.'}
              </p>
            </div>
          )}
        </div>
      )}
      <div className="content-filter-summary">
        <span className="small muted" role="status">
          {loading
            ? 'Loading stories…'
            : `${count} of ${stories.length} ${deleted ? 'deleted ' : ''}${stories.length === 1 ? 'story' : 'stories'}`}
        </span>
        {(activeCount > 0 || hasSearch) && (
          <div className="content-filter-chips">
            {hasSearch && (
              <button
                type="button"
                className="content-filter-chip"
                aria-label="Clear search"
                onClick={() => onChange({ ...filters, query: '' })}
              >
                <span>Search: {filters.query}</span>
                <X aria-hidden="true" />
              </button>
            )}
            {active.map((group) => {
              const value =
                group.key === 'modified' && filters.modified === 'custom'
                  ? `${filters.from || 'Any date'} → ${filters.to || 'Any date'}`
                  : (group.items.find((item) => item.value === filters[group.key])?.label ??
                    filters[group.key]);
              return (
                <button
                  type="button"
                  key={group.key}
                  className="content-filter-chip"
                  aria-label={`Remove ${group.label} filter`}
                  onClick={() => update(group.key, '')}
                >
                  <span>
                    {group.label}: {value}
                  </span>
                  <X aria-hidden="true" />
                </button>
              );
            })}
            {scheduleFilter && (
              <button
                type="button"
                className="content-filter-chip"
                aria-label="Remove schedule filter"
                onClick={() => onScheduleChange('')}
              >
                <span>{scheduleFilter === 'pending' ? 'Scheduled' : 'Failed schedules'}</span>
                <X aria-hidden="true" />
              </button>
            )}
            <Button
              variant="ghost"
              className="button--small"
              onClick={() => {
                onChange({ ...defaultFilters, sort: filters.sort });
                onScheduleChange('');
              }}
            >
              Clear all
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          className="button--small content-trash-toggle"
          aria-pressed={deleted}
          onClick={onToggleDeleted}
        >
          {deleted ? <Undo2 aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
          {deleted ? 'Show active stories' : 'Deleted stories'}
        </Button>
      </div>
    </section>
  );
}
