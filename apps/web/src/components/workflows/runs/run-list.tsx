'use client';

/**
 * The run list on the left of the Runs tab (Module 08, blueprint 7.3):
 * newest first, 25 a page, the next page loading as the end scrolls into
 * view. Each row: the status sticker in words, Test or Live, the trigger
 * phrase, when it started (exact on hover), how long it took, the version
 * of a live run and the credits it used. The header (after n8n's executions
 * list, 2026-11-03): Auto Refresh, Refresh, and a filter menu: All, Succeeded,
 * Failed, Waiting, Test.
 */
import { ListFilterIcon } from '@animateicons/react/lucide/list-filter-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import {
  Badge,
  Button,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  MotionIcon,
  Skeleton,
  Text,
  TooltipHint,
} from '@postgear/ui';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { listRuns } from '@/lib/workflows-api';
import type { RunSummary, WorkspaceCatalog } from '@/types/workflows';
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
  /** Whether this workflow has no runs at all, for the empty state beside the list. */
  onEmptyChange?: (empty: boolean) => void;
}

const AUTO_REFRESH_MS = 5_000;

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
  onEmptyChange,
}: RunListProps) {
  const autoId = useId();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pages, setPages] = useState(1);
  const request = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const lastFilter = useRef<RunFilter>(filter);
  const opened = useRef(false);

  // Beside the list, the newest run opens by itself rather than leaving an empty pane.
  useEffect(() => {
    if (opened.current || state !== 'ready') return;
    opened.current = true;
    if (!selectedId && runs[0] && window.matchMedia?.('(min-width: 1024px)').matches) {
      onSelect(runs[0].id);
    }
  }, [state, runs, selectedId, onSelect]);

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
        setPages(1);
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
        setPages((count) => count + 1);
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

  // A refresh replaces what is loaded with the first page, so it waits while more are open:
  // the list must not jump under someone who has scrolled down.
  useEffect(() => {
    if (!autoRefresh || pages > 1) return;
    const timer = setInterval(() => {
      if (!document.hidden) setRefreshKey((value) => value + 1);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, pages]);

  const shown = useMemo(() => patchRuns(runs, patch), [runs, patch]);

  const hasNoRuns = state === 'ready' && filter === 'all' && shown.length === 0;
  useEffect(() => {
    onEmptyChange?.(hasNoRuns);
  }, [hasNoRuns, onEmptyChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b-2 border-outline px-3">
        <Checkbox
          id={autoId}
          checked={autoRefresh}
          onCheckedChange={(value) => setAutoRefresh(value === true)}
        />
        <label htmlFor={autoId} className="me-auto ms-2 font-sans text-sm font-medium text-ink">
          Auto refresh
        </label>
        <TooltipHint label="Refresh Runs">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh Runs"
            className="h-9 w-9 shrink-0 px-0"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <DropdownMenu>
          <TooltipHint label="Filter Runs">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={
                  filter === 'all'
                    ? 'Filter runs'
                    : `Filter runs: ${RUN_FILTERS.find((one) => one.value === filter)?.label}`
                }
                data-testid="run-filter"
                className="relative h-9 w-9 shrink-0 px-0"
              >
                <MotionIcon icon={ListFilterIcon} className="h-4 w-4" />
                {filter === 'all' ? null : (
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-actionPrimary"
                  />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => setFilter(value as RunFilter)}
            >
              {RUN_FILTERS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
