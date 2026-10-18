'use client';

/**
 * The overview for the range and channel in the URL, kept current while a
 * sync is running.
 *
 * Modelled on `use-queue.ts`: responses are sequenced so a slow 90-day
 * answer never lands on top of a fast 7-day one, the filters are mirrored
 * into the URL with `history.replaceState` (a navigation would re-run the
 * server page and refetch everything it already has), and the server-rendered
 * overview is kept for first paint when it matches what the URL asks for.
 *
 * ## After "Sync now"
 *
 * A sync is the worker's business and takes seconds to minutes; nothing
 * pushes its result to the page. So for a minute after one is requested the
 * overview is polled every ten seconds, and only swapped in when something
 * a sync would change actually changed (`syncFingerprint`): `generatedAt`
 * moves on every call and is not a signal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { AnalyticsOverview } from '@/types/analytics';
import {
  type AnalyticsFilters,
  apiQuery,
  paramsFromFilters,
  syncFingerprint,
} from './analytics-view-model';

const SYNC_WATCH_MS = 60_000;
const SYNC_POLL_MS = 10_000;

export interface AnalyticsHandle {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  data: AnalyticsOverview | null;
  loading: boolean;
  error: string | null;
  now: Date;
  reload: () => void;
  /** A sync was requested less than a minute ago; the page is watching for it. */
  syncing: boolean;
  /** Start watching for a sync's results. */
  watchSync: () => void;
}

export function useAnalytics(
  initial: AnalyticsOverview | null,
  initialFilters: AnalyticsFilters,
): AnalyticsHandle {
  const [filters, setFiltersState] = useState<AnalyticsFilters>(initialFilters);
  const [data, setData] = useState<AnalyticsOverview | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [syncUntil, setSyncUntil] = useState<number | null>(null);
  const latest = useRef(0);
  const skipFirst = useRef(Boolean(initial));

  useEffect(() => {
    const params = paramsFromFilters(filters).toString();
    const next = `${window.location.pathname}${params ? `?${params}` : ''}`;

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

    api<AnalyticsOverview>(`/analytics/overview?${apiQuery(filters).toString()}`)
      .then((result) => {
        if (request === latest.current) {
          setData(result);
          setError(null);
          setNow(new Date());
        }
      })
      .catch((cause: unknown) => {
        if (request === latest.current) {
          setError(cause instanceof ApiError ? cause.message : 'The metrics could not be loaded.');
        }
      })
      .finally(() => {
        if (request === latest.current) {
          setLoading(false);
        }
      });
  }, [filters, version]);

  // The quiet poll while a sync is expected: fetch, compare, swap only on change.
  useEffect(() => {
    if (syncUntil === null) {
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (Date.now() >= syncUntil) {
        setSyncUntil(null);
        return;
      }
      if (document.visibilityState !== 'visible') {
        return;
      }
      api<AnalyticsOverview>(`/analytics/overview?${apiQuery(filters).toString()}`)
        .then((result) => {
          if (cancelled) return;
          setNow(new Date());
          setData((current) =>
            current && syncFingerprint(current) === syncFingerprint(result) ? current : result,
          );
        })
        .catch(() => {
          // A failed poll is not an error the page needs to show; the next
          // tick tries again and the Sync pill reports the worker's state.
        });
    };

    const timer = setInterval(tick, SYNC_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [syncUntil, filters]);

  const setFilters = useCallback((patch: Partial<AnalyticsFilters>) => {
    setFiltersState((current) => ({ ...current, ...patch }));
  }, []);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const watchSync = useCallback(() => setSyncUntil(Date.now() + SYNC_WATCH_MS), []);

  return {
    filters,
    setFilters,
    data,
    loading,
    error,
    now,
    reload,
    syncing: syncUntil !== null,
    watchSync,
  };
}
