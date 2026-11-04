import type { PublicationStatus, StorySummary } from '@storypane/core';

export type ContentFilters = {
  query: string;
  status: PublicationStatus | '';
  modifiedBy: string;
  contentType: string;
  modified: '' | 'today' | 'week' | 'month' | 'custom';
  from: string;
  to: string;
  sort: 'newest' | 'oldest' | 'name';
};
export const defaultFilters: ContentFilters = {
  query: '',
  status: '',
  modifiedBy: '',
  contentType: '',
  modified: '',
  from: '',
  to: '',
  sort: 'newest',
};
const keys: Record<keyof ContentFilters, string> = {
  query: 'q',
  status: 'filterStatus',
  modifiedBy: 'filterEditor',
  contentType: 'filterType',
  modified: 'filterDate',
  from: 'filterFrom',
  to: 'filterTo',
  sort: 'sort',
};

function date(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = new Date(`${value}T00:00:00`);
  return Number.isFinite(result.getTime()) && result.getDate() === Number(value.slice(8))
    ? result
    : null;
}
export function readContentFilters(params: URLSearchParams): ContentFilters {
  const filters = { ...defaultFilters };
  for (const key of Object.keys(keys) as (keyof ContentFilters)[]) {
    const value = params.get(keys[key]) ?? '';
    if (key === 'status')
      filters.status = ['draft', 'changed', 'published'].includes(value)
        ? (value as ContentFilters['status'])
        : '';
    else if (key === 'modified')
      filters.modified = ['today', 'week', 'month', 'custom'].includes(value)
        ? (value as ContentFilters['modified'])
        : '';
    else if (key === 'sort')
      filters.sort = ['newest', 'oldest', 'name'].includes(value)
        ? (value as ContentFilters['sort'])
        : 'newest';
    else if (key === 'from' || key === 'to') filters[key] = date(value) ? value : '';
    else filters[key] = value.slice(0, 200);
  }
  return filters;
}
export function writeContentFilters(params: URLSearchParams, filters: ContentFilters) {
  for (const key of Object.keys(keys) as (keyof ContentFilters)[]) {
    if (
      filters[key] === defaultFilters[key] ||
      ((key === 'from' || key === 'to') && filters.modified !== 'custom')
    )
      params.delete(keys[key]);
    else params.set(keys[key], filters[key]);
  }
}
export function filterStories(
  stories: StorySummary[],
  filters: ContentFilters,
  now = new Date(),
): StorySummary[] {
  const query = filters.query.trim().toLowerCase();
  let from: Date | null = null,
    to: Date | null = null;
  if (filters.modified === 'custom') {
    from = date(filters.from);
    to = date(filters.to);
    if (to) to.setDate(to.getDate() + 1);
  } else if (filters.modified) {
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    from.setDate(
      from.getDate() - (filters.modified === 'week' ? 6 : filters.modified === 'month' ? 29 : 0),
    );
    to = new Date(now);
    to.setHours(24, 0, 0, 0);
  }
  return stories
    .filter((story) => {
      const modified = Date.parse(story.updatedAt);
      return (
        `${story.name} /${story.slug} ${story.id}`.toLowerCase().includes(query) &&
        (!filters.status || story.publicationStatus === filters.status) &&
        (!filters.modifiedBy || story.modifiedBy?.id === filters.modifiedBy) &&
        (!filters.contentType || story.contentType?.id === filters.contentType) &&
        (!from || modified >= from.getTime()) &&
        (!to || modified < to.getTime())
      );
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (filters.sort === 'name'
          ? a.name.localeCompare(b.name)
          : filters.sort === 'oldest'
            ? Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
            : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) ||
        a.id.localeCompare(b.id),
    );
}
