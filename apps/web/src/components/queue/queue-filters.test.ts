import {
  apiQuery,
  DEFAULT_FILTERS,
  filtersFromParams,
  isFiltered,
  paramsFromFilters,
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

  it('writes only what differs from the defaults', () => {
    expect(paramsFromFilters(DEFAULT_FILTERS).toString()).toBe('');
    expect(
      paramsFromFilters({ ...DEFAULT_FILTERS, state: 'QUEUE', page: 2, sort: 'desc' }).toString(),
    ).toBe('state=QUEUE&sort=desc&page=2');
  });

  it('widens local days to their full instants for the API', () => {
    const query = apiQuery({ ...DEFAULT_FILTERS, from: '2026-10-11', to: '2026-10-11' });
    const from = new Date(query.get('from') as string);
    const to = new Date(query.get('to') as string);

    expect(from).toEqual(new Date(2026, 9, 11));
    expect(to).toEqual(new Date(new Date(2026, 9, 12).getTime() - 1));
    expect(query.get('sort')).toBe('asc');
    expect(query.get('page')).toBe('1');
    expect(query.has('state')).toBe(false);
  });

  it('knows when a filter is active', () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, sort: 'desc', page: 4 })).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, channelId: 'x' })).toBe(true);
  });
});
