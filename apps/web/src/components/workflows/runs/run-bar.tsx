'use client';

/**
 * The run bar at the bottom of the canvas (Module 08, blueprint 3 and 7.2):
 * "Test run 14:02, 4 of 6 steps, 3.1 s", the run's status in words, Stop
 * while it runs, Close once it ended (Close clears the paint), and Open
 * Review while a step waits at a Manual Review.
 *
 * Rejected and Review Expired are outcomes, not failures, so their sticker
 * is neutral, never red (`RUN_STATUS`). A full-width strip that wraps on a
 * phone; the page places it under the canvas.
 */
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
import { ClipboardCheckIcon } from '@animateicons/react/lucide/clipboard-check-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { Badge, Button, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import { LoaderCircle, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isTerminalRun, type RunModel, type StepPaintState } from './run-model';
import { formatDuration, RUN_STATUS, type RunTone } from './run-words';

export interface RunBarProps {
  run: RunModel;
  /** Steps in the run's graph, for "4 of 6 steps". */
  totalSteps: number;
  stopping: boolean;
  onStop: () => void;
  onClose: () => void;
  /** Shown when the run waits at a Manual Review: opens its card. */
  onOpenReview?: (nodeKey: string) => void;
  className?: string;
}

/** Steps that have finished one way or another (a skipped branch counts: it is settled). */
const SETTLED: ReadonlySet<StepPaintState> = new Set([
  'succeeded',
  'dryRun',
  'handled',
  'failed',
  'skipped',
]);

export function settledSteps(run: Pick<RunModel, 'paint'>): number {
  let count = 0;
  for (const paint of Object.values(run.paint)) if (SETTLED.has(paint.state)) count += 1;
  return count;
}

/** How long the run has taken: to its end, or to `now` while it runs. */
export function runElapsedMs(
  run: Pick<RunModel, 'startedAt' | 'finishedAt'>,
  now: number,
): number | null {
  if (!run.startedAt) return null;
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

function clockTime(at: string | null): string {
  if (!at) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** "Test run 14:02, 4 of 6 steps, 3.1 s" ("Live run" for a live one). */
export function runBarSummary(
  run: Pick<RunModel, 'mode' | 'startedAt' | 'finishedAt' | 'paint'>,
  totalSteps: number,
  now: number,
): string {
  const kind = run.mode === 'LIVE' ? 'Live run' : 'Test run';
  const time = clockTime(run.startedAt);
  const steps = `${settledSteps(run)} of ${totalSteps} ${totalSteps === 1 ? 'step' : 'steps'}`;
  const elapsed = runElapsedMs(run, now);
  const duration = elapsed === null ? '' : `, ${formatDuration(elapsed)}`;
  return `${time ? `${kind} ${time}` : kind}, ${steps}${duration}`;
}

/** The step a waiting run waits on (a Manual Review), if any. */
export function waitingStep(run: Pick<RunModel, 'paint'>): string | null {
  for (const [key, paint] of Object.entries(run.paint)) if (paint.waiting) return key;
  return null;
}

const TONE_BADGE: Record<RunTone, 'outline' | 'primary' | 'accent' | 'success' | 'danger'> = {
  neutral: 'outline',
  running: 'primary',
  waiting: 'accent',
  success: 'success',
  danger: 'danger',
};

/** Under 10 s the tenths move; after that a second at a time is enough. */
function tickMs(elapsed: number | null): number {
  return elapsed !== null && elapsed >= 10_000 ? 1_000 : 200;
}

export function RunBar({
  run,
  totalSteps,
  stopping,
  onStop,
  onClose,
  onOpenReview,
  className,
}: RunBarProps) {
  const ended = isTerminalRun(run.runStatus);
  const [now, setNow] = useState(() => Date.now());
  const elapsed = runElapsedMs(run, now);
  const tick = tickMs(elapsed);
  const ticking = !ended && run.startedAt !== null;

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(id);
  }, [ticking, tick]);

  const status = RUN_STATUS[run.runStatus];
  const review = onOpenReview ? waitingStep(run) : null;

  return (
    <section
      aria-label="Run progress"
      className={cn(
        'flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t-2 border-outline bg-chrome px-3 py-2',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
          <Play aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span className="type-ui" data-testid="run-bar-summary">
            {runBarSummary(run, totalSteps, now)}
          </span>
        </span>
        <span role="status">
          <Badge
            variant={TONE_BADGE[status.tone]}
            data-tone={status.tone}
            className={status.tone === 'neutral' ? 'bg-secondary' : undefined}
          >
            {status.label}
          </Badge>
        </span>
        {run.error && status.tone === 'danger' ? (
          <span className="min-w-0 max-w-full truncate text-sm text-dangerInk" title={run.error}>
            {run.error}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {review && onOpenReview ? (
          <Button variant="primary" size="sm" onClick={() => onOpenReview(review)}>
            <MotionIcon icon={ClipboardCheckIcon} className="h-4 w-4" />
            Open Review
          </Button>
        ) : null}
        {ended ? (
          <TooltipHint label="Close">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              aria-label="Close"
              onClick={onClose}
            >
              <MotionIcon icon={XIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onStop}
            disabled={stopping}
            aria-busy={stopping || undefined}
          >
            {stopping ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                strokeWidth={2.5}
              />
            ) : (
              <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
            )}
            {stopping ? 'Stopping' : 'Stop'}
          </Button>
        )}
      </div>
    </section>
  );
}
