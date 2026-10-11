/**
 * The queue's filters: what they are, how they travel in the URL, and what
 * they send to the API. Pure, so the URL round trip is testable without React.
 */
import type { PostState } from '@/types/post';

export type QueueStateFilter = 'all' | PostState;
export type QueueSort = 'asc' | 'desc';

export interface QueueFilters {
  state: QueueStateFilter;
  channelId: string | null;
  /** `YYYY-MM-DD`, local. */
  from: string | null;
  to: string | null;
  sort: QueueSort;
  page: number;
}

export const DEFAULT_FILTERS: QueueFilters = {
  state: 'all',
  channelId: null,
  from: null,
  to: null,
  sort: 'asc',
  page: 1,
};

export const STATE_TABS: { value: QueueStateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'QUEUE', label: 'Queued' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ERROR', label: 'Failed' },
  { value: 'DRAFT', label: 'Drafts' },
];

const STATES: readonly QueueStateFilter[] = ['all', 'QUEUE', 'PUBLISHED', 'ERROR', 'DRAFT'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function filtersFromParams(params: URLSearchParams): QueueFilters {
  const state = params.get('state');
  const sort = params.get('sort');
  const page = Number(params.get('page') ?? '1');
  const from = params.get('from');
  const to = params.get('to');

  return {
    state: STATES.includes(state as QueueStateFilter) ? (state as QueueStateFilter) : 'all',
    channelId: params.get('channel') || null,
    from: from && DAY.test(from) ? from : null,
    to: to && DAY.test(to) ? to : null,
    sort: sort === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Only what differs from the defaults, so the plain `/queue` URL stays plain. */
export function paramsFromFilters(filters: QueueFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.state !== 'all') params.set('state', filters.state);
  if (filters.channelId) params.set('channel', filters.channelId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.sort !== 'asc') params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));

  return params;
}

/** The query the API takes. Dates are local days, widened to their instants. */
export function apiQuery(filters: QueueFilters): URLSearchParams {
  const params = new URLSearchParams({ sort: filters.sort, page: String(filters.page) });

  if (filters.state !== 'all') params.set('state', filters.state);
  if (filters.channelId) params.set('channelId', filters.channelId);

  const from = localDay(filters.from);
  if (from) params.set('from', from.toISOString());

  const to = localDay(filters.to);
  if (to) {
    to.setDate(to.getDate() + 1);
    params.set('to', new Date(to.getTime() - 1).toISOString());
  }

  return params;
}

export function isFiltered(filters: QueueFilters): boolean {
  return (
    filters.state !== 'all' ||
    filters.channelId !== null ||
    filters.from !== null ||
    filters.to !== null
  );
}

function localDay(value: string | null): Date | null {
  if (!value || !DAY.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return Number.isNaN(date.getTime()) ? null : date;
}
