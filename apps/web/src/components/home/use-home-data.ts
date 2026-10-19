'use client';

/**
 * The Home page's live data: the viewer's clock, the dashboard numbers and
 * the posts up next.
 *
 * The server renders what it can (channels, credits, the first page of the
 * queue, and the dashboard counted in UTC for the first steps and the failed
 * count, which no time zone changes). What depends on the viewer's clock is
 * fetched here: the streak and the weekly goal are counted in their weeks,
 * which the server cannot know.
 *
 * Both lists stay current the way the queue does: they reload at once when
 * the composer saves or deletes a post (`post-events.ts`), and every minute
 * while the tab is visible, which is how a publish by the worker shows up.
 * Requests are sequenced so a slow response never lands over a newer one,
 * and none goes out while `SyncActiveWorkspace` is still pointing the API at
 * this workspace (see `useWorkspaceScope`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceScope } from '@/components/navigation/workspace-provider';
import { ApiError, api } from '@/lib/api';
import { POSTS_CHANGED_EVENT } from '@/lib/post-events';
import type { DashboardGoalResponse, DashboardSummary } from '@/types/dashboard';
import type { PostSummary, QueuePage } from '@/types/post';
import { viewerTimeZone } from './home-model';

const REFRESH_MS = 60_000;

/** How many queued posts "Up next" shows. */
export const UP_NEXT_COUNT = 5;

/**
 * The viewer's clock, ticking on the minute; null until mounted.
 *
 * Null on the server and on the first client render, so the greeting and
 * every time on the page wait for the browser's own clock and zone rather
 * than rendering the server's and then changing (a hydration mismatch).
 * Re-read when the tab comes back, since a sleeping laptop delays timers.
 */
export function useClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const current = new Date();
      setNow(current);
      clearTimeout(timer);
      // Just past the next minute, so a boundary (noon, midnight) is never missed.
      const untilNextMinute = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());
      timer = setTimeout(tick, untilNextMinute + 50);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return now;
}

/** Reloads on a post change and every minute while the tab is visible. */
function useLiveReload(reload: () => void) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, REFRESH_MS);
    window.addEventListener(POSTS_CHANGED_EVENT, reload);

    return () => {
      clearInterval(timer);
      window.removeEventListener(POSTS_CHANGED_EVENT, reload);
    };
  }, [reload]);
}

/**
 * One scoped, sequenced fetch: the shape both lists share.
 *
 * `skipFirst` keeps the server's render instead of fetching it again on
 * mount, unless a workspace switch is in flight, in which case what the
 * server loaded may belong to the previous workspace and is replaced as soon
 * as the switch lands.
 */
function useScopedFetch<T>(load: () => Promise<T>, skipFirst: boolean, fallbackError: string) {
  const { orgId, scope, status } = useWorkspaceScope();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!skipFirst);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);
  const skip = useRef(skipFirst);
  const loadRef = useRef(load);
  loadRef.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the explicit reload trigger
  useEffect(() => {
    if (status === 'failed') {
      setError(fallbackError);
      setLoading(false);
      return;
    }
    if (status !== 'ready' || scope.status(orgId) !== 'ready') {
      skip.current = false;
      return;
    }
    if (skip.current) {
      skip.current = false;
      return;
    }

    const request = ++latest.current;
    setLoading(true);

    loadRef
      .current()
      .then((result) => {
        if (request === latest.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (request === latest.current) {
          setError(cause instanceof ApiError ? cause.message : fallbackError);
        }
      })
      .finally(() => {
        if (request === latest.current) {
          setLoading(false);
        }
      });
  }, [orgId, scope, status, version, fallbackError]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  useLiveReload(reload);

  return { data, setData, error, loading, reload };
}

/**
 * `GET /dashboard` in the viewer's zone, and the admin's goal edit.
 *
 * Always fetched on mount, even with the server's UTC copy in hand: the
 * streak and this week's count are only right in the viewer's own weeks.
 * Until it lands, the first steps and the failed count come from that copy,
 * which no zone changes, so neither pops in late.
 */
export function useDashboard(initial: DashboardSummary | null) {
  const load = useCallback(
    () => api<DashboardSummary>(`/dashboard?tz=${encodeURIComponent(viewerTimeZone())}`),
    [],
  );
  const { data, setData, error, loading, reload } = useScopedFetch(
    load,
    false,
    'The stats could not be loaded.',
  );

  /** Saves a new target (null: back to the suggestion); throws the API's message. */
  const saveGoal = useCallback(
    async (target: number | null) => {
      const result = await api<DashboardGoalResponse>('/dashboard/goal', {
        method: 'PATCH',
        body: { target },
      });
      setData((current) =>
        current ? { ...current, goal: { ...current.goal, ...result.goal } } : current,
      );
    },
    [setData],
  );

  return {
    /** The zoned summary: the only source for the streak and the goal. */
    summary: data,
    firstSteps: data?.firstSteps ?? initial?.firstSteps ?? null,
    failed: data?.failed ?? initial?.failed ?? null,
    error: data ? null : error,
    loading,
    reload,
    saveGoal,
  };
}

/** The next queued posts, soonest first, from now on. */
export function useUpNext(initial: QueuePage | null) {
  const load = useCallback(() => {
    const params = new URLSearchParams({
      state: 'QUEUE',
      from: new Date().toISOString(),
      sort: 'asc',
      page: '1',
    });
    return api<QueuePage>(`/posts/queue?${params.toString()}`);
  }, []);
  const { data, error, loading, reload } = useScopedFetch(
    load,
    initial !== null,
    'The queue could not be loaded.',
  );

  const page = data ?? initial;
  const posts: PostSummary[] | null = page ? page.posts.slice(0, UP_NEXT_COUNT) : null;

  return { posts, error: page ? null : error, loading, reload };
}
