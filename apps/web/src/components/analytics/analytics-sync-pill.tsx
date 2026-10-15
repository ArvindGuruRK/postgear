'use client';

/**
 * When the metrics were last fetched, and whether anything is fetching them.
 *
 * The analytics twin of `SchedulerStatusPill`: a number on this page is only
 * as current as the worker's last sync, and a worker that is not running
 * leaves every number looking perfectly healthy and quietly stale. The pill
 * asks `/analytics/sync` every half minute while the page is visible — and
 * straight away when the page requests a sync — and the tooltip lists each
 * channel's own last sync, so "2 channels need attention" can be read
 * without scrolling to the table.
 */
import {
  cn,
  StatusIndicator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@postgear/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AnalyticsSyncOverview } from '@/types/analytics';
import { useMounted } from '../posts/use-mounted';
import { syncPresentation } from './analytics-view-model';

const POLL_MS = 30_000;

export function AnalyticsSyncPill({
  initial,
  refreshKey = 0,
  now,
  className,
}: {
  /** What the server page loaded; null when it could not. */
  initial: AnalyticsSyncOverview | null;
  /** Bump to re-check immediately — after "Sync now". */
  refreshKey?: number;
  now: Date;
  className?: string;
}) {
  const [sync, setSync] = useState<AnalyticsSyncOverview | null | 'unknown'>(initial ?? 'unknown');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey` is the explicit re-check trigger
  useEffect(() => {
    let cancelled = false;

    const check = () =>
      api<AnalyticsSyncOverview>('/analytics/sync')
        .then((result) => !cancelled && setSync(result))
        .catch(() => !cancelled && setSync(null));

    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshKey]);

  // "Synced 2h ago" depends on the clock, which the server and the browser
  // read at different instants; the pill says "Checking" until hydrated.
  const mounted = useMounted();
  const shown = syncPresentation(mounted ? sync : 'unknown', now);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A button, so the explanation is reachable by keyboard as well as hover. */}
          <button
            type="button"
            className={cn(
              'rounded-full outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              className,
            )}
            data-testid="analytics-sync-status"
            data-status={shown.status}
            aria-label={`${shown.label}. ${shown.explanation}`}
          >
            <StatusIndicator
              status={shown.status}
              label={shown.label}
              className="rounded-full border-2 border-outline bg-secondary px-3 py-1 text-xs font-bold"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <p className="m-0">{shown.explanation}</p>
          {shown.lines.length > 0 ? (
            <ul className="m-0 mt-1.5 list-none p-0 opacity-80">
              {shown.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
