'use client';

/**
 * One page of the queue, with its filters in the URL.
 *
 * Responses are sequenced the way the media list's are: a slow page 1 must
 * never land after a fast page 2. While a post in view is in motion (about to
 * publish, retrying) the page re-fetches every few seconds so "Publishing"
 * becomes "Published" without anyone touching anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { POSTS_CHANGED_EVENT } from '@/lib/post-events';
import type { PostSummary, QueuePage } from '@/types/post';
import { describePost } from '../posts/post-status';
import {
  apiQuery,
  clearNarrowing,
  filtersFromParams,
  paramsFromFilters,
  type QueueFilters,
  type QueueStateFilter,
  withState,
} from './queue-filters';

const LIVE_POLL_MS = 8_000;
const IDLE_POLL_MS = 60_000;

export function useQueue(initial: QueuePage | null, initialParams: URLSearchParams) {
  const [filters, setFiltersState] = useState<QueueFilters>(() => filtersFromParams(initialParams));
  const [data, setData] = useState<QueuePage | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const latest = useRef(0);
  // The server rendered page 1 with no filters; only skip the first fetch when
  // that is also what the URL asks for.
  const skipFirst = useRef(
    Boolean(initial) && paramsFromFilters(filtersFromParams(initialParams)).toString() === '',
  );

  useEffect(() => {
    const params = paramsFromFilters(filters).toString();
    const next = `${window.location.pathname}${params ? `?${params}` : ''}`;

    // Only when something changed: see the calendar context for why.
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [filters]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the explicit reload trigger
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }

    const request = ++latest.current;
    setLoading(true);

    api<QueuePage>(`/posts/queue?${apiQuery(filters).toString()}`)
      .then((result) => {
        if (request === latest.current) {
          setData(result);
          setError(null);
          setNow(new Date());
        }
      })
      .catch((cause: unknown) => {
        if (request === latest.current) {
          setError(cause instanceof ApiError ? cause.message : 'The queue could not be loaded.');
        }
      })
      .finally(() => {
        if (request === latest.current) {
          setLoading(false);
        }
      });
  }, [filters, version]);

  const live = useMemo(
    () => (data?.posts ?? []).some((post) => describePost(post, now).live),
    [data, now],
  );

  useEffect(() => {
    const timer = setInterval(
      () => {
        setNow(new Date());
        if (document.visibilityState === 'visible') {
          setVersion((current) => current + 1);
        }
      },
      live ? LIVE_POLL_MS : IDLE_POLL_MS,
    );

    return () => clearInterval(timer);
  }, [live]);

  const setFilters = useCallback((patch: Partial<QueueFilters>) => {
    setFiltersState((current) => ({
      ...current,
      ...patch,
      // Any change other than paging goes back to the first page.
      page: patch.page ?? 1,
    }));
  }, []);

  const setState = useCallback(
    (state: QueueStateFilter) => setFiltersState((current) => withState(current, state)),
    [],
  );
  const reset = useCallback(() => setFiltersState(clearNarrowing), []);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  // Reload at once when the composer, open as a modal over the queue, saves
  // or deletes a post: see lib/post-events.ts.
  useEffect(() => {
    window.addEventListener(POSTS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(POSTS_CHANGED_EVENT, reload);
  }, [reload]);

  const replacePost = useCallback((post: PostSummary) => {
    setData((current) =>
      current
        ? {
            ...current,
            posts: current.posts.map((entry) => (entry.group === post.group ? post : entry)),
          }
        : current,
    );
  }, []);

  const removePost = useCallback((group: string) => {
    setData((current) =>
      current
        ? {
            ...current,
            posts: current.posts.filter((entry) => entry.group !== group),
            total: Math.max(0, current.total - 1),
          }
        : current,
    );
  }, []);

  return {
    filters,
    setFilters,
    setState,
    reset,
    data,
    loading,
    error,
    now,
    reload,
    replacePost,
    removePost,
  };
}
