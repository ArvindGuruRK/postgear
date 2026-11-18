import { act, renderHook } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import type { ListStreamsOptions } from '@/lib/clips-api';
import type { ClipStreamsPage } from '@/types/clips';
import { fixtureStream } from '../clips-fixtures';
import { STREAMS_LOAD_FAILED, type StreamsQuery, useChannelStreams } from './use-channel-streams';

jest.mock('@/lib/clips-api', () => ({}));

interface Pending {
  channelId: string;
  options: ListStreamsOptions;
  resolve: (page: ClipStreamsPage) => void;
  reject: (cause: unknown) => void;
}

function page(ids: string[], overrides: Partial<ClipStreamsPage> = {}): ClipStreamsPage {
  return {
    kind: 'streams',
    sort: 'newest',
    period: null,
    items: ids.map((externalId) => fixtureStream({ externalId, title: `Stream ${externalId}` })),
    nextCursor: null,
    updatedAt: '2026-11-18T10:00:00.000Z',
    stale: false,
    capped: false,
    notice: null,
    ...overrides,
  };
}

function controlledApi() {
  const calls: Pending[] = [];
  const api = {
    list: jest.fn(
      (channelId: string, options: ListStreamsOptions = {}) =>
        new Promise<ClipStreamsPage>((resolve, reject) => {
          calls.push({ channelId, options, resolve, reject });
        }),
    ),
    refresh: jest.fn(async () => ({ refreshedAt: '2026-11-18T10:00:00.000Z' })),
  };
  return { api, calls };
}

const QUERY: StreamsQuery = {
  channelId: 'channel-1',
  kind: 'streams',
  sort: 'newest',
  period: null,
  showHidden: false,
};

const ids = (items: Array<{ externalId: string }>) => items.map((item) => item.externalId);

describe('useChannelStreams', () => {
  it('asks nothing without a query', () => {
    const { api } = controlledApi();
    const { result } = renderHook(() => useChannelStreams(null, api));
    expect(api.list).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('loads the first page for the query', async () => {
    const { api, calls } = controlledApi();
    const { result } = renderHook(() => useChannelStreams(QUERY, api));
    expect(result.current.loading).toBe(true);
    expect(calls[0].options).toMatchObject({
      kind: 'streams',
      sort: 'newest',
      hidden: false,
      cursor: null,
    });

    await act(async () => calls[0].resolve(page(['a', 'b'], { nextCursor: 'next', capped: true })));
    expect(ids(result.current.items)).toEqual(['a', 'b']);
    expect(result.current).toMatchObject({ loading: false, hasMore: true, capped: true });
  });

  it('drops the rows and lets a newer query win over a slower older one', async () => {
    const { api, calls } = controlledApi();
    const { result, rerender } = renderHook(({ query }) => useChannelStreams(query, api), {
      initialProps: { query: QUERY },
    });
    rerender({ query: { ...QUERY, showHidden: true } });
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].options.hidden).toBe(true);

    await act(async () => calls[1].resolve(page(['new'])));
    await act(async () => calls[0].resolve(page(['old'])));
    expect(ids(result.current.items)).toEqual(['new']);
  });

  it('adds only rows it has not got on Show More', async () => {
    const { api, calls } = controlledApi();
    const { result } = renderHook(() => useChannelStreams(QUERY, api));
    await act(async () => calls[0].resolve(page(['a', 'b'], { nextCursor: 'c2' })));

    act(() => result.current.loadMore());
    expect(calls[1].options.cursor).toBe('c2');
    await act(async () => calls[1].resolve(page(['b', 'c'])));
    expect(ids(result.current.items)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);
  });

  it('keeps the rows when Show More fails', async () => {
    const { api, calls } = controlledApi();
    const { result } = renderHook(() => useChannelStreams(QUERY, api));
    await act(async () => calls[0].resolve(page(['a'], { nextCursor: 'c2' })));
    act(() => result.current.loadMore());
    await act(async () => calls[1].reject(new TypeError('Failed to fetch')));
    expect(ids(result.current.items)).toEqual(['a']);
    expect(result.current.moreError).toEqual({ message: STREAMS_LOAD_FAILED, code: undefined });
  });

  it('returns a refresh refusal for the caller to show', async () => {
    const { api, calls } = controlledApi();
    api.refresh.mockRejectedValueOnce(
      new ApiError(
        'This list was refreshed a moment ago. Try again in 30 seconds.',
        429,
        'refresh_throttled',
      ),
    );
    const { result } = renderHook(() => useChannelStreams(QUERY, api));
    await act(async () => calls[0].resolve(page(['a'])));

    let refusal: unknown;
    await act(async () => {
      refusal = await result.current.refresh();
    });
    expect(refusal).toEqual({
      message: 'This list was refreshed a moment ago. Try again in 30 seconds.',
      code: 'refresh_throttled',
    });
    expect(api.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      refusal = await result.current.refresh();
    });
    expect(refusal).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});
