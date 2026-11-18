'use client';

/**
 * One list of one channel (Module 06, section 6): the first page for the
 * chosen list, sort, period and Show Hidden, then Show More, 50 at a time.
 *
 * - Any change of what is asked for drops the old rows and starts again; a
 *   newer request always wins (an `AbortController` and a sequence guard),
 *   so a slow answer for the last tab never lands on this one.
 * - Show More keeps the rows already drawn and adds only rows it has not got
 *   (by `externalId`), so a list that moved between pages never doubles up.
 * - Refresh asks the platform again (`refreshChannel`, 30 seconds apart) and
 *   then reads the first page; its refusal comes back to the caller to show.
 * - `update` lets the page hide, show again and undo without asking again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { listStreams, refreshChannel } from '@/lib/clips-api';
import type { ClipStreamItem, ListKind, ListPeriod, ListSort } from '@/types/clips';

export const STREAMS_LOAD_FAILED = 'We could not load this list. Try again.';

export interface StreamsQuery {
  channelId: string;
  kind: ListKind;
  sort: ListSort;
  period: ListPeriod | null;
  showHidden: boolean;
}

export interface StreamsRefusal {
  message: string;
  code: string | undefined;
}

export interface StreamsState {
  items: ClipStreamItem[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: StreamsRefusal | null;
  /** A Show More that failed: the rows stay and this sentence shows under them. */
  moreError: StreamsRefusal | null;
  hasMore: boolean;
  updatedAt: string | null;
  stale: boolean;
  capped: boolean;
  notice: string | null;
  loadMore: () => void;
  reload: () => void;
  /** Asks the platform again; resolves with the refusal, or null when it worked. */
  refresh: () => Promise<StreamsRefusal | null>;
  update: (change: (items: ClipStreamItem[]) => ClipStreamItem[]) => void;
}

function refusalOf(cause: unknown): StreamsRefusal {
  return cause instanceof ApiError && cause.status !== 0
    ? { message: cause.message, code: cause.code }
    : { message: STREAMS_LOAD_FAILED, code: undefined };
}

interface Api {
  list: typeof listStreams;
  refresh: typeof refreshChannel;
}

const DEFAULT_API: Api = { list: listStreams, refresh: refreshChannel };

export function useChannelStreams(
  query: StreamsQuery | null,
  api: Api = DEFAULT_API,
): StreamsState {
  const [items, setItems] = useState<ClipStreamItem[]>([]);
  const [loading, setLoading] = useState(query !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<StreamsRefusal | null>(null);
  const [moreError, setMoreError] = useState<StreamsRefusal | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [meta, setMeta] = useState({
    updatedAt: null as string | null,
    stale: false,
    capped: false,
    notice: null as string | null,
  });
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const channelId = query?.channelId ?? null;
  const kind = query?.kind ?? null;
  const sort = query?.sort ?? null;
  const period = query?.period ?? null;
  const showHidden = query?.showHidden ?? false;

  const request = useCallback(
    (from: string | null) => {
      if (channelId === null || kind === null || sort === null) return null;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const mine = ++sequence.current;
      const promise = api.list(channelId, {
        kind,
        sort,
        period: period ?? undefined,
        hidden: showHidden,
        cursor: from,
        signal: abort.signal,
      });
      return { promise, mine, abort };
    },
    [api, channelId, kind, sort, period, showHidden],
  );

  const reload = useCallback(() => {
    const started = request(null);
    if (!started) {
      setItems([]);
      setLoading(false);
      return;
    }
    setItems([]);
    setCursor(null);
    setError(null);
    setMoreError(null);
    setLoading(true);
    setLoadingMore(false);
    started.promise
      .then((page) => {
        if (started.mine !== sequence.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setMeta({
          updatedAt: page.updatedAt,
          stale: page.stale,
          capped: page.capped,
          notice: page.notice,
        });
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (started.mine !== sequence.current || started.abort.signal.aborted) return;
        setError(refusalOf(cause));
        setLoading(false);
      });
  }, [request]);

  useEffect(() => {
    reload();
    return () => controller.current?.abort();
  }, [reload]);

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore || loading) return;
    const started = request(cursor);
    if (!started) return;
    setLoadingMore(true);
    setMoreError(null);
    started.promise
      .then((page) => {
        if (started.mine !== sequence.current) return;
        setItems((current) => {
          const known = new Set(current.map((item) => item.externalId));
          return [...current, ...page.items.filter((item) => !known.has(item.externalId))];
        });
        setCursor(page.nextCursor);
        setMeta({
          updatedAt: page.updatedAt,
          stale: page.stale,
          capped: page.capped,
          notice: page.notice,
        });
        setLoadingMore(false);
      })
      .catch((cause: unknown) => {
        if (started.mine !== sequence.current || started.abort.signal.aborted) return;
        setMoreError(refusalOf(cause));
        setLoadingMore(false);
      });
  }, [cursor, loading, loadingMore, request]);

  const refresh = useCallback(async (): Promise<StreamsRefusal | null> => {
    if (channelId === null) return null;
    setRefreshing(true);
    try {
      await api.refresh(channelId);
      reload();
      return null;
    } catch (cause) {
      return refusalOf(cause);
    } finally {
      setRefreshing(false);
    }
  }, [api, channelId, reload]);

  const update = useCallback((change: (current: ClipStreamItem[]) => ClipStreamItem[]) => {
    setItems(change);
  }, []);

  return {
    items,
    loading,
    loadingMore,
    refreshing,
    error,
    moreError,
    hasMore: cursor !== null,
    updatedAt: meta.updatedAt,
    stale: meta.stale,
    capped: meta.capped,
    notice: meta.notice,
    loadMore,
    reload,
    refresh,
    update,
  };
}
