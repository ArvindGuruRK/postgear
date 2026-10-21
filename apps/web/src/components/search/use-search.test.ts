import { act, renderHook } from '@testing-library/react';
import { ApiError, api } from '@/lib/api';
import type { SearchResponse } from '@/types/search';
import { cleanQuery, useWorkspaceSearch } from './use-search';

jest.mock('@/lib/api', () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }

  return { api: jest.fn(), ApiError: MockApiError };
});

const apiMock = api as jest.Mock;

function response(query: string): SearchResponse {
  return {
    query,
    posts: [],
    channels: [],
    media: [],
    more: { posts: false, channels: false, media: false },
    unavailable: [],
  };
}

/** A promise the test settles by hand, to control which answer lands first. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function pass(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('cleanQuery', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanQuery('  summer \n  sale ')).toBe('summer sale');
  });
});

describe('useWorkspaceSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) =>
      response(new URL(path, 'http://x').searchParams.get('q') ?? ''),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends nothing for a search that is too short, or while closed', async () => {
    const { result, rerender } = renderHook(
      ({ query, enabled }) => useWorkspaceSearch(query, enabled),
      { initialProps: { query: 'a', enabled: true } },
    );

    await pass(1_000);
    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    expect(result.current.pending).toBe(false);

    rerender({ query: 'launch', enabled: false });
    await pass(1_000);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('waits for typing to pause, then sends one request with the cleaned words', async () => {
    const { result, rerender } = renderHook(({ query }) => useWorkspaceSearch(query, true), {
      initialProps: { query: 'la' },
    });

    await pass(100);
    rerender({ query: 'lau' });
    await pass(100);
    rerender({ query: '  launch  ' });

    expect(result.current.pending).toBe(true);
    expect(apiMock).not.toHaveBeenCalled();

    await pass(300);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/search?q=launch');
    expect(result.current.data?.query).toBe('launch');
    expect(result.current.answeredFor).toBe('launch');
    expect(result.current.pending).toBe(false);
  });

  it('encodes the search so its characters cannot change the request', async () => {
    renderHook(() => useWorkspaceSearch('a&orgId=2 b', true));

    await pass(300);

    expect(apiMock).toHaveBeenCalledWith('/search?q=a%26orgId%3D2+b');
  });

  it('ignores a slow answer to an older search that lands after a newer one', async () => {
    const first = deferred<SearchResponse>();
    const second = deferred<SearchResponse>();
    apiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ query }) => useWorkspaceSearch(query, true), {
      initialProps: { query: 'sum' },
    });

    await pass(300);
    rerender({ query: 'summer' });
    await pass(300);

    expect(apiMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(response('summer'));
    });
    await act(async () => {
      first.resolve(response('sum'));
    });

    expect(result.current.data?.query).toBe('summer');
    expect(result.current.answeredFor).toBe('summer');
  });

  it('keeps the last answer on screen while the next search loads', async () => {
    const next = deferred<SearchResponse>();
    const { result, rerender } = renderHook(({ query }) => useWorkspaceSearch(query, true), {
      initialProps: { query: 'sum' },
    });

    await pass(300);
    expect(result.current.answeredFor).toBe('sum');

    apiMock.mockReturnValueOnce(next.promise);
    rerender({ query: 'summer' });
    await pass(300);

    expect(result.current.pending).toBe(true);
    expect(result.current.data?.query).toBe('sum');

    await act(async () => {
      next.resolve(response('summer'));
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.data?.query).toBe('summer');
  });

  it('clears the results and drops a late answer once the search gets too short', async () => {
    const slow = deferred<SearchResponse>();
    apiMock.mockReturnValueOnce(slow.promise);

    const { result, rerender } = renderHook(({ query }) => useWorkspaceSearch(query, true), {
      initialProps: { query: 'summer' },
    });

    await pass(300);
    rerender({ query: 's' });
    await pass(300);

    await act(async () => {
      slow.resolve(response('summer'));
    });

    expect(result.current.data).toBeNull();
    expect(result.current.answeredFor).toBe('');
    expect(result.current.active).toBe(false);
  });

  it('reports a failure with the API message, and retry runs it again', async () => {
    apiMock.mockRejectedValueOnce(new ApiError('Too many requests', 429));

    const { result } = renderHook(() => useWorkspaceSearch('launch', true));
    await pass(300);

    expect(result.current.error).toBe('Too many requests');
    expect(result.current.pending).toBe(false);

    await act(async () => {
      result.current.retry();
    });

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.query).toBe('launch');
  });

  it('uses a plain message for a failure that is not an API error', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useWorkspaceSearch('launch', true));
    await pass(300);

    expect(result.current.error).toBe('The search could not be loaded.');
  });

  it('cuts a search to the length the API accepts', async () => {
    renderHook(() => useWorkspaceSearch('a'.repeat(150), true));
    await pass(300);

    expect(apiMock).toHaveBeenCalledWith(`/search?q=${'a'.repeat(100)}`);
  });
});
