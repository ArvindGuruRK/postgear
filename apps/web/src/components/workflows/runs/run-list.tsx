'use client';

/**
 * The run list on the left of the Runs tab (Module 08, blueprint 7.3):
 * newest first, 25 a page, the next page loading as the end scrolls into
 * view. Each row: the status sticker in words, Test or Live, the trigger
 * phrase, when it started (exact on hover), how long it took, the version
 * of a live run and the credits it used. Filters: All, Succeeded, Failed,
 * Waiting, Test.
 */
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { Badge, Button, cn, MotionIcon, Skeleton, Text, TooltipHint } from '@postgear/ui';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listRuns } from '@/lib/workflows-api';
import type { RunSummary, WorkspaceCatalog } from '@/types/workflows';
import { Segmented } from '../fields/segmented';
import {
  appendPage,
  filterQuery,
  NO_MATCHING_RUNS,
  NO_RUNS,
  patchRuns,
  RUN_FILTERS,
  RUNS_NOT_LOADED,
  type RunFilter,
  type RunPatch,
  runRowView,
} from './run-list-model';

export interface RunListProps {
  automationId: string;
  catalog: WorkspaceCatalog | null;
  selectedId: string | null;
  onSelect: (runId: string) => void;
  /** Bumped to fetch the first page again (after a retry started a run). */
  reloadKey: number;
  /** The open run's live state, so its row keeps up. */
  patch: RunPatch | null;
}

type LoadState = 'loading' | 'ready' | 'error';

const RunRow = memo(function RunRow({
  run,
  catalog,
  selected,
  onSelect,
}: {
  run: RunSummary;
  catalog: WorkspaceCatalog | null;
  selected: boolean;
  onSelect: (runId: string) => void;
}) {
  const view = runRowView(run, catalog);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(run.id)}
        aria-current={selected ? 'true' : undefined}
        data-testid="run-row"
        className={cn(
          'flex w-full min-w-0 flex-col gap-1.5 rounded-md border-2 px-3 py-2 text-left outline-none transition-colors motion-reduce:transition-none',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          selected
            ? 'border-outline bg-secondary shadow-surfaceSm'
            : 'border-transparent hover:border-outline hover:bg-secondary',
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <Badge variant={view.status.variant}>{view.status.label}</Badge>
          <Badge variant="outline">{view.mode}</Badge>
          {view.version ? (
            <span className="ms-auto shrink-0 font-sans text-xs font-bold text-ink">
              {view.version}
            </span>
          ) : null}
        </span>
        <span className="type-ui w-full truncate text-sm text-ink">{view.trigger}</span>
        <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 font-sans text-xs text-ink type-muted">
          {view.startedIso ? (
            <time dateTime={view.startedIso} title={view.startedExact}>
              {view.started}
            </time>
          ) : null}
          {view.duration ? <span>{view.duration}</span> : null}
          {view.credits ? <span>{view.credits}</span> : null}
        </span>
      </button>
    </li>
  );
});

export function RunList({
  automationId,
  catalog,
  selectedId,
  onSelect,
  reloadKey,
  patch,
}: RunListProps) {
  const [filter, setFilter] = useState<RunFilter>('all');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const request = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const lastFilter = useRef<RunFilter>(filter);

  // The first page: again on a filter change (cleared at once), a reload
  // or a refresh (the old rows stay until the new ones arrive).
  useEffect(() => {
    void reloadKey;
    void refreshKey;
    const token = ++request.current;
    if (lastFilter.current !== filter) {
      lastFilter.current = filter;
      setRuns([]);
      setNextCursor(null);
      setState('loading');
    }
    setMoreFailed(false);
    listRuns(automationId, filterQuery(filter))
      .then((page) => {
        if (token !== request.current) return;
        setRuns(page.runs);
        setNextCursor(page.nextCursor);
        setState('ready');
      })
      .catch(() => {
        if (token !== request.current) return;
        setState('error');
      });
  }, [automationId, filter, reloadKey, refreshKey]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const token = request.current;
    setLoadingMore(true);
    setMoreFailed(false);
    listRuns(automationId, { ...filterQuery(filter), cursor: nextCursor })
      .then((page) => {
        if (token !== request.current) return;
        setRuns((current) => appendPage(current, page.runs));
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (token === request.current) setMoreFailed(true);
      })
      .finally(() => {
        if (token === request.current) setLoadingMore(false);
      });
  }, [automationId, filter, nextCursor, loadingMore]);

  // Infinite scroll: the next page loads as the end of the list comes near.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !nextCursor || moreFailed || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root: scroller.current, rootMargin: '0px 0px 320px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [nextCursor, moreFailed, loadMore]);

  const shown = useMemo(() => patchRuns(runs, patch), [runs, patch]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b-2 border-outline p-3">
        <Segmented
          label="Show runs"
          options={RUN_FILTERS}
          value={filter}
          onValueChange={setFilter}
          className="min-w-0"
        />
        <TooltipHint label="Refresh Runs">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Refresh Runs"
            className="ms-auto h-9 w-9 shrink-0 px-0"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="run-list">
        {state === 'loading' ? (
          <div className="flex flex-col gap-2 p-1" aria-busy="true">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : state === 'error' ? (
          <div className="flex flex-col items-start gap-2 p-2">
            <Text size="sm">{RUNS_NOT_LOADED}</Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              Try Again
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <Text size="sm" muted className="p-2" data-testid="runs-empty">
            {filter === 'all' ? NO_RUNS : NO_MATCHING_RUNS}
          </Text>
        ) : (
          <>
            <ul className="flex flex-col gap-1" aria-label="Runs">
              {shown.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  catalog={catalog}
                  selected={run.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
            {nextCursor ? (
              <div ref={sentinel} className="flex justify-center p-2">
                <Button variant="secondary" size="sm" disabled={loadingMore} onClick={loadMore}>
                  {loadingMore ? 'Loading...' : moreFailed ? 'Try Again' : 'Load More Runs'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
