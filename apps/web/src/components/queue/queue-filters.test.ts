import {
  apiQuery,
  clearNarrowing,
  DEFAULT_FILTERS,
  defaultSort,
  filtersFromParams,
  isNarrowed,
  paramsFromFilters,
  withState,
} from './queue-filters';

describe('queue filters', () => {
  it('reads valid values from the URL and falls back for the rest', () => {
    expect(
      filtersFromParams(
        new URLSearchParams(
          'state=ERROR&channel=ch_1&from=2026-10-01&to=2026-10-31&sort=desc&page=3',
        ),
      ),
    ).toEqual({
      state: 'ERROR',
      channelId: 'ch_1',
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'desc',
      page: 3,
    });

    expect(
      filtersFromParams(new URLSearchParams('state=NOPE&from=yesterday&page=-2&sort=up')),
    ).toEqual(DEFAULT_FILTERS);
  });

  it('opens on the queued posts, soonest first', () => {
    expect(filtersFromParams(new URLSearchParams())).toMatchObject({ state: 'QUEUE', sort: 'asc' });
  });

  it('gives each tab its own order: published newest first, the rest soonest first', () => {
    expect(defaultSort('PUBLISHED')).toBe('desc');
    expect(defaultSort('QUEUE')).toBe('asc');
    expect(defaultSort('all')).toBe('asc');
    expect(filtersFromParams(new URLSearchParams('state=PUBLISHED')).sort).toBe('desc');
    expect(filtersFromParams(new URLSearchParams('state=PUBLISHED&sort=asc')).sort).toBe('asc');
  });

  it('writes only what differs from the defaults', () => {
    expect(paramsFromFilters(DEFAULT_FILTERS).toString()).toBe('');
    expect(
      paramsFromFilters({ ...DEFAULT_FILTERS, state: 'all', page: 2, sort: 'desc' }).toString(),
    ).toBe('state=all&sort=desc&page=2');
    // Newest first is the published tab's own order, so it is not written.
    expect(paramsFromFilters(withState(DEFAULT_FILTERS, 'PUBLISHED')).toString()).toBe(
      'state=PUBLISHED',
    );
  });

  it('switches tab back to its own order and first page, keeping the channel and dates', () => {
    const narrowed = { ...DEFAULT_FILTERS, channelId: 'ch_1', from: '2026-10-01', page: 4 };

    expect(withState(narrowed, 'PUBLISHED')).toEqual({
      ...narrowed,
      state: 'PUBLISHED',
      sort: 'desc',
      page: 1,
    });
  });

  it('clears the channel and dates but keeps the tab', () => {
    const narrowed = {
      ...DEFAULT_FILTERS,
      state: 'ERROR' as const,
      channelId: 'ch_1',
      from: '2026-10-01',
      to: '2026-10-02',
      page: 2,
    };

    expect(clearNarrowing(narrowed)).toEqual({ ...DEFAULT_FILTERS, state: 'ERROR' });
  });

  it('widens local days to their full instants for the API', () => {
    const query = apiQuery({ ...DEFAULT_FILTERS, from: '2026-10-11', to: '2026-10-11' });
    const from = new Date(query.get('from') as string);
    const to = new Date(query.get('to') as string);

    expect(from).toEqual(new Date(2026, 9, 11));
    expect(to).toEqual(new Date(new Date(2026, 9, 12).getTime() - 1));
    expect(query.get('sort')).toBe('asc');
    expect(query.get('page')).toBe('1');
    expect(query.get('state')).toBe('QUEUE');
    expect(apiQuery({ ...DEFAULT_FILTERS, state: 'all' }).has('state')).toBe(false);
  });

  it('knows when a channel or date narrows the tab', () => {
    expect(isNarrowed(DEFAULT_FILTERS)).toBe(false);
    expect(isNarrowed({ ...DEFAULT_FILTERS, state: 'ERROR', sort: 'desc', page: 4 })).toBe(false);
    expect(isNarrowed({ ...DEFAULT_FILTERS, channelId: 'x' })).toBe(true);
    expect(isNarrowed({ ...DEFAULT_FILTERS, to: '2026-10-11' })).toBe(true);
  });
});
