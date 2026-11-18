'use client';

/**
 * The Clips tab's list (Module 07, section 5): one status filter, the
 * sources, the sort, and pages of 24 with Show More. The counts per state
 * come with every page and follow the source filter.
 *
 * Any filter change drops the old rows and starts again; a newer request
 * always wins (an `AbortController` and a sequence guard). Show More adds
 * only clips it has not got. `patch`, `prepend` and `drop` keep the list in
 * step with what the menu did, without asking again; the counts are read
 * again quietly after such a change so they never drift.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { listClips } from '@/lib/clips-api';
import type {
  ClipCounts,
  ClipListItem,
  ClipListSort,
  ClipSource,
  ClipStatusFilter,
} from '@/types/clips';

export const CLIPS_LOAD_FAILED = 'Your clips could not be loaded. Check your connection.';

export const EMPTY_COUNTS: ClipCounts = Object.freeze({
  all: 0,
  new: 0,
  draft: 0,
  exported: 0,
  scheduled: 0,
  hidden: 0,
}) as ClipCounts;

export interface ClipsListState {
  clips: ClipListItem[];
  counts: ClipCounts;
  total: number;
  status: ClipStatusFilter;
  sources: ClipSource[];
  sort: ClipListSort;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  setStatus: (status: ClipStatusFilter) => void;
  setSources: (sources: ClipSource[]) => void;
  setSort: (sort: ClipListSort) => void;
  loadMore: () => void;
  refresh: () => void;
  /** Puts a changed clip in place, or takes it off when it no longer fits the filter. */
  patch: (clipId: string, change: Partial<ClipListItem>) => void;
  prepend: (clip: ClipListItem) => void;
  drop: (clipId: string) => void;
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : CLIPS_LOAD_FAILED;
}

/** How often a list with a running export reads its rings again. */
export const EXPORT_POLL_MS = 5_000;

export function useClipsList(
  options: { load?: typeof listClips; enabled?: boolean } = {},
): ClipsListState {
  const load = options.load ?? listClips;
  const enabled = options.enabled ?? true;
  const [clips, setClips] = useState<ClipListItem[]>([]);
  const [counts, setCounts] = useState<ClipCounts>(EMPTY_COUNTS);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<ClipStatusFilter>('all');
  const [sources, setSourcesState] = useState<ClipSource[]>([]);
  const [sort, setSort] = useState<ClipListSort>('newest');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const sourceKey = [...sources].sort().join(',');

  useEffect(() => {
    void tick;
    if (!enabled) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const mine = ++sequence.current;
    setLoading(true);
    setError(null);
    load({
      status,
      sources: sourceKey ? (sourceKey.split(',') as ClipSource[]) : [],
      sort,
      page: 1,
      signal: abort.signal,
    })
      .then((answer) => {
        if (mine !== sequence.current) return;
        setClips(answer.clips);
        setCounts(answer.counts);
        setTotal(answer.total);
        setPage(1);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (mine !== sequence.current || abort.signal.aborted) return;
        setError(messageOf(cause));
        setLoading(false);
      });
    return () => abort.abort();
  }, [enabled, load, sort, sourceKey, status, tick]);

  const hasMore = clips.length < total;

  // While a shown clip exports, its ring moves: the pages read so far are read
  // again quietly and only the export fields change (no loading state, no reorder).
  const exporting = clips.some((clip) => clip.exportProgress !== null);
  useEffect(() => {
    if (!enabled || !exporting) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      const mine = sequence.current;
      const pages = Array.from({ length: page }, (_, index) => index + 1);
      Promise.all(
        pages.map((one) => load({ status, sources, sort, page: one, signal: abort.signal })),
      )
        .then((answers) => {
          if (mine !== sequence.current) return;
          const fresh = new Map(answers.flatMap((answer) => answer.clips).map((clip) => [clip.id, clip]));
          setClips((current) =>
            current.map((clip) => {
              const next = fresh.get(clip.id);
              return next
                ? {
                    ...clip,
                    exportProgress: next.exportProgress,
                    state: next.state,
                    exported: next.exported,
                    exportedMediaId: next.exportedMediaId,
                  }
                : clip;
            }),
          );
        })
        .catch(() => undefined);
    }, EXPORT_POLL_MS);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [enabled, exporting, load, page, sort, sources, status]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    const mine = sequence.current;
    const next = page + 1;
    setLoadingMore(true);
    load({ status, sources, sort, page: next })
      .then((answer) => {
        if (mine !== sequence.current) return;
        setClips((current) => {
          const known = new Set(current.map((clip) => clip.id));
          return [...current, ...answer.clips.filter((clip) => !known.has(clip.id))];
        });
        setCounts(answer.counts);
        setTotal(answer.total);
        setPage(next);
      })
      .catch((cause: unknown) => {
        if (mine === sequence.current) setError(messageOf(cause));
      })
      .finally(() => {
        if (mine === sequence.current) setLoadingMore(false);
      });
  }, [hasMore, load, loading, loadingMore, page, sort, sources, status]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  // The counts after a change from the menu, read again without touching the rows.
  const recount = useCallback(() => {
    const mine = sequence.current;
    load({ status, sources, sort, page: 1 })
      .then((answer) => {
        if (mine !== sequence.current) return;
        setCounts(answer.counts);
        setTotal(answer.total);
      })
      .catch(() => undefined);
  }, [load, sort, sources, status]);

  const fits = useCallback(
    (clip: Pick<ClipListItem, 'state'>) =>
      status === 'all' ? clip.state !== 'hidden' : clip.state === status,
    [status],
  );

  const patch = useCallback(
    (clipId: string, change: Partial<ClipListItem>) => {
      // The exact total and counts come back with the recount.
      setClips((current) =>
        current.flatMap((clip) => {
          if (clip.id !== clipId) return [clip];
          const merged = { ...clip, ...change };
          return fits(merged) ? [merged] : [];
        }),
      );
      recount();
    },
    [fits, recount],
  );

  const prepend = useCallback(
    (clip: ClipListItem) => {
      if (fits(clip)) {
        setClips((current) => [clip, ...current.filter((one) => one.id !== clip.id)]);
      }
      recount();
    },
    [fits, recount],
  );

  const drop = useCallback(
    (clipId: string) => {
      setClips((current) => current.filter((clip) => clip.id !== clipId));
      recount();
    },
    [recount],
  );

  const setSources = useCallback((next: ClipSource[]) => setSourcesState([...new Set(next)]), []);

  return {
    clips,
    counts,
    total,
    status,
    sources,
    sort,
    loading,
    loadingMore,
    error,
    hasMore,
    setStatus,
    setSources,
    setSort,
    loadMore,
    refresh,
    patch,
    prepend,
    drop,
  };
}
