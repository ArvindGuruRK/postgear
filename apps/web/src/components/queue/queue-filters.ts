/**
 * The queue's filters: what they are, how they travel in the URL, and what
 * they send to the API. Pure, so the URL round trip is testable without React.
 *
 * The page opens on the queued posts (2026-10-23), as Buffer's and Postiz's
 * lists do: the question it answers first is "what goes out next". Every
 * other tab is one click away and keeps its own natural order: published
 * posts newest first, everything else soonest first.
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

export const DEFAULT_STATE: QueueStateFilter = 'QUEUE';

export const DEFAULT_FILTERS: QueueFilters = {
  state: DEFAULT_STATE,
  channelId: null,
  from: null,
  to: null,
  sort: 'asc',
  page: 1,
};

/** In the order a person works through them: what is next, what broke, what is unfinished. */
export const STATE_TABS: { value: QueueStateFilter; label: string }[] = [
  { value: 'QUEUE', label: 'Queued' },
  { value: 'ERROR', label: 'Failed' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'all', label: 'All' },
];

const STATES: readonly QueueStateFilter[] = STATE_TABS.map((tab) => tab.value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A tab's own order: what already went out reads newest first, the rest soonest first. */
export function defaultSort(state: QueueStateFilter): QueueSort {
  return state === 'PUBLISHED' ? 'desc' : 'asc';
}

/** Switching tab: back to that tab's own order and its first page; channel and dates stay. */
export function withState(filters: QueueFilters, state: QueueStateFilter): QueueFilters {
  return { ...filters, state, sort: defaultSort(state), page: 1 };
}

/** "Clear Filters": drops the channel and dates, keeps the tab and its order. */
export function clearNarrowing(filters: QueueFilters): QueueFilters {
  return { ...filters, channelId: null, from: null, to: null, page: 1 };
}

export function filtersFromParams(params: URLSearchParams): QueueFilters {
  const raw = params.get('state');
  const state = STATES.includes(raw as QueueStateFilter)
    ? (raw as QueueStateFilter)
    : DEFAULT_STATE;
  const sort = params.get('sort');
  const page = Number(params.get('page') ?? '1');
  const from = params.get('from');
  const to = params.get('to');

  return {
    state,
    channelId: params.get('channel') || null,
    from: from && DAY.test(from) ? from : null,
    to: to && DAY.test(to) ? to : null,
    sort: sort === 'asc' || sort === 'desc' ? sort : defaultSort(state),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Only what differs from the defaults, so the plain `/queue` URL stays plain. */
export function paramsFromFilters(filters: QueueFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.state !== DEFAULT_STATE) params.set('state', filters.state);
  if (filters.channelId) params.set('channel', filters.channelId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.sort !== defaultSort(filters.state)) params.set('sort', filters.sort);
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

/** True when a channel or a date narrows the tab, which is what "Clear Filters" undoes. */
export function isNarrowed(filters: QueueFilters): boolean {
  return filters.channelId !== null || filters.from !== null || filters.to !== null;
}

function localDay(value: string | null): Date | null {
  if (!value || !DAY.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return Number.isNaN(date.getTime()) ? null : date;
}
