'use client';

/**
 * The Logs dock under the canvas (Module 08, blueprint 3 and 7.2; after n8n's
 * Logs, 2026-11-03). Always there as a strip: "Test run 14:02, 4 of 6 steps,
 * 3.1 s", the run's status in words, Close once it ended (Close clears the
 * paint), and Open Review while a step waits at a Manual Review. Stop stays on
 * the canvas, where Test Workflow was. It opens upward, and resizes, to the steps on the left and what the
 * chosen one got and gave on the right.
 *
 * It opens by itself when a test fails, because that is when someone wants it.
 * Rejected and Review Expired are outcomes, not failures, so their sticker is
 * neutral, never red (`RUN_STATUS`). Retry From Here stays on the Runs tab: the
 * builder's test follows one run and could not follow the new one.
 */
import { ChevronUpIcon } from '@animateicons/react/lucide/chevron-up-icon';
import { ClipboardCheckIcon } from '@animateicons/react/lucide/clipboard-check-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { getDefinition } from '@postgear/automation';
import { Badge, Button, cn, MotionIcon, Text, TooltipHint } from '@postgear/ui';
import { useEffect, useMemo, useState } from 'react';
import { RunGlyph } from '../canvas/run-glyph';
import { paintLook } from '../canvas/step-paint';
import { StepGlyph } from '../list/step-glyph';
import { ResizeHandle } from '../panel/resize-handle';
import { failedStepKey, orderedSteps } from './run-detail-model';
import { isTerminalRun, type RunModel, type StepPaintState } from './run-model';
import { StepRunBody } from './run-step-list';
import { formatDuration, RUN_STATUS, type RunTone, stepBadgeText } from './run-words';

export interface LogsDockProps {
  /** The latest test; null until one ran on this page. */
  run: RunModel | null;
  /** Steps in the run's graph, for "4 of 6 steps". */
  totalSteps: number;
  onClose: () => void;
  /** It opened or closed: the canvas above changed height. */
  onOpenChange?: (open: boolean) => void;
  /** The canvas shows this run, so Close has something to clear. */
  painted?: boolean;
  /** Shown when the run waits at a Manual Review: opens its card. */
  onOpenReview?: (nodeKey: string) => void;
  onReviewAnswered?: () => void;
  workflowName?: string;
  activeVersion?: number | null;
  className?: string;
}

const HEIGHT = { start: 288, min: 160, max: 640, step: 24 };

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

export function LogsDock({
  run,
  totalSteps,
  onClose,
  onOpenChange,
  painted = true,
  onOpenReview,
  onReviewAnswered = () => undefined,
  workflowName = '',
  activeVersion = null,
  className,
}: LogsDockProps) {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(HEIGHT.start);
  const [picked, setPicked] = useState<string | null>(null);
  const ended = run ? isTerminalRun(run.runStatus) : false;
  const [now, setNow] = useState(() => Date.now());
  const elapsed = run ? runElapsedMs(run, now) : null;
  const tick = tickMs(elapsed);
  const ticking = run !== null && !ended && run.startedAt !== null;

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(id);
  }, [ticking, tick]);

  const runId = run?.runId;
  const failed = run?.runStatus === 'FAILED';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new run starts on its own steps
  useEffect(() => {
    setPicked(null);
  }, [runId]);
  useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const steps = useMemo(() => (run ? orderedSteps(run) : []), [run]);
  const chosen =
    steps.find((step) => step.nodeKey === picked) ??
    steps.find((step) => step.nodeKey === (run ? failedStepKey(run) : null)) ??
    steps.at(-1);
  const status = run ? RUN_STATUS[run.runStatus] : null;
  const review = run && onOpenReview ? waitingStep(run) : null;

  return (
    <section
      aria-label="Run progress"
      className={cn(
        'flex w-full shrink-0 flex-col border-t-2 border-outline bg-secondary',
        className,
      )}
    >
      {open ? (
        <ResizeHandle
          label="Resize Logs"
          value={height}
          min={HEIGHT.min}
          max={HEIGHT.max}
          step={HEIGHT.step}
          grows="up"
          valueText={`Logs ${height} pixels tall`}
          onChange={setHeight}
          className="-mt-1 -mb-1 w-full"
        />
      ) : null}
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ms-1 h-9 shrink-0 px-2"
          aria-expanded={open}
          aria-controls="workflow-logs"
          onClick={() => setOpen((value) => !value)}
          data-testid="logs-toggle"
        >
          <MotionIcon
            icon={ChevronUpIcon}
            className={cn('h-4 w-4 transition-transform', open ? 'rotate-180' : '')}
          />
          Logs
        </Button>
        {run && status ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className="type-ui min-w-0 truncate text-sm text-ink"
              data-testid="run-bar-summary"
            >
              {runBarSummary(run, totalSteps, now)}
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
              <span
                className="min-w-0 max-w-full truncate text-sm text-dangerInk"
                title={run.error}
              >
                {run.error}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="flex-1" />
        )}

        {run ? (
          <div className="flex shrink-0 items-center gap-2">
            {review && onOpenReview ? (
              <Button variant="primary" size="sm" onClick={() => onOpenReview(review)}>
                <MotionIcon icon={ClipboardCheckIcon} className="h-4 w-4" />
                Open Review
              </Button>
            ) : null}
            {ended && painted ? (
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
            ) : null}
          </div>
        ) : null}
      </div>

      {open ? (
        <div
          id="workflow-logs"
          style={{ height }}
          className="flex min-h-0 border-t-2 border-outline"
          data-testid="logs-body"
        >
          {run && chosen ? (
            <>
              <ol
                aria-label="Steps in run order"
                className="w-80 shrink-0 overflow-y-auto border-r-2 border-outline p-2"
              >
                {steps.map((step) => {
                  const paint = run.paint[step.nodeKey];
                  const icon = getDefinition(step.nodeType)?.icon ?? 'manual';
                  return (
                    <li key={step.nodeKey}>
                      <button
                        type="button"
                        aria-current={step.nodeKey === chosen.nodeKey ? 'true' : undefined}
                        onClick={() => setPicked(step.nodeKey)}
                        className={cn(
                          'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-primary',
                          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing',
                          step.nodeKey === chosen.nodeKey ? 'bg-primary' : '',
                        )}
                      >
                        <StepGlyph icon={icon} className="h-5 w-5 shrink-0" />
                        <span className="type-ui min-w-0 flex-1 truncate text-sm text-ink">
                          {step.nodeName}
                        </span>
                        {paint && formatDuration(paint.durationMs) ? (
                          <span className="shrink-0 font-sans text-xs text-ink type-muted">
                            {formatDuration(paint.durationMs)}
                          </span>
                        ) : null}
                        <span
                          title={paint ? stepBadgeText(paint) : 'Queued'}
                          className="flex shrink-0"
                        >
                          <RunGlyph
                            look={paint ? paintLook(paint) : { icon: 'clock', tone: 'neutral' }}
                            className="h-5 w-5"
                          />
                          <span className="sr-only">{paint ? stepBadgeText(paint) : 'Queued'}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-inset p-4">
                <StepRunBody
                  step={chosen}
                  node={run.graph?.nodes.find((node) => node.key === chosen.nodeKey)}
                  run={{
                    runId: run.runId,
                    status: run.runStatus,
                    mode: run.mode,
                    version: null,
                  }}
                  workflowName={workflowName}
                  activeVersion={activeVersion}
                  retrying={false}
                  focusReview={false}
                  onReviewAnswered={onReviewAnswered}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <Text size="sm" muted>
                Test the workflow to see what each step received and returned.
              </Text>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
