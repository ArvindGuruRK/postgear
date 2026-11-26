'use client';

/**
 * Find Clips at the top of the video page's right column (Module 16,
 * section 5; blueprint section 5):
 *
 * - **The button** (`Button variant="highlight"`, the only violet on the
 *   page) carries the price, "Find Clips (15 AI Minutes)", with the AI
 *   minutes chip under it. Too few minutes: the button is off and an
 *   `Alert variant="warning"` says why, with **See Plans**.
 * - **A second run asks first** (`AlertDialog`, "Find Clips Again"): new
 *   clips nobody opened are replaced.
 * - **While it runs** the button gives way to the step in words, a
 *   `Progress`, the time left when known, and **Cancel** (the minutes come
 *   back). The run is followed with `useClipJob`, so it survives a reload.
 * - **When it ends** the page reads the video again (new clips, the run's
 *   line) and the plan snapshot again (a failure or a cancel gave the
 *   minutes back). A failure shows its sentence with **Try Again**.
 * - **Notes** in `type-muted`: the AI note always, the no-sound note, and
 *   the nothing-found note.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  buttonVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Progress,
  toast,
} from '@postgear/ui';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError } from '@/lib/api';
import { cancelClipJob, startHighlights } from '@/lib/clips-api';
import { meterOf, useEntitlements } from '@/lib/entitlements';
import type { ClipSummary, HighlightsView } from '@/types/clips';
import { isTerminalJob } from '../clip-job-model';
import { timeLeft } from '../editor/export-model';
import { AI_MINUTES_METER, AiMinutesChipView } from '../home/clips-meters';
import { clipErrorSentence } from '../library/clip-actions';
import { useClipJob } from '../use-clip-job';
import {
  asksFirst,
  findAgainSentence,
  findClipsBlock,
  findClipsNotes,
  quickFindLabel,
  HIGHLIGHTS_CANCELLED,
  HIGHLIGHTS_FAILED,
} from './find-clips-model';

const NOTE = 'm-0 font-sans text-sm text-ink type-muted';

export function FindClips({
  orgId,
  videoId,
  highlights,
  clips,
  onSettled,
}: {
  orgId: string;
  videoId: string;
  highlights: HighlightsView;
  clips: readonly ClipSummary[];
  /** The run ended (or was refused as already running): read the video again. */
  onSettled: () => void;
}) {
  const { snapshot, refresh: refreshPlan } = useEntitlements(orgId);
  const meter = meterOf(snapshot, AI_MINUTES_METER);
  const openJob =
    highlights.job && !isTerminalJob(highlights.job.status) ? highlights.job.id : null;
  const [jobId, setJobId] = useState<string | null>(openJob);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const job = useClipJob(jobId);
  const live = job.job && !isTerminalJob(job.job.status) ? job.job : null;
  const running = live !== null || (jobId !== null && job.job === null && !job.error);

  // A run started elsewhere (another tab, before a reload) is followed too.
  useEffect(() => {
    if (openJob) setJobId((current) => current ?? openJob);
  }, [openJob]);

  // The followed run ended: the new clips, the run's line, and the meter.
  const ended = job.job && isTerminalJob(job.job.status) ? `${job.job.id}:${job.job.status}` : null;
  const settled = useRef<string | null>(null);
  useEffect(() => {
    if (!ended || settled.current === ended) return;
    settled.current = ended;
    setJobId(null);
    onSettled();
    void refreshPlan();
  }, [ended, onSettled, refreshPlan]);

  const price = highlights.price;
  const block = findClipsBlock(price, meter);

  const start = useCallback(async () => {
    if (starting || running) return;
    setStarting(true);
    setProblem(null);
    try {
      const started = await startHighlights(videoId);
      setJobId(started.job.id);
      void refreshPlan();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'highlights_running') {
        onSettled();
        return;
      }
      setProblem(clipErrorSentence(cause));
      void refreshPlan();
    } finally {
      setStarting(false);
    }
  }, [onSettled, refreshPlan, running, starting, videoId]);

  const request = () => {
    if (asksFirst(highlights, clips)) setConfirming(true);
    else void start();
  };

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelClipJob(jobId);
      toast({ title: HIGHLIGHTS_CANCELLED });
    } catch (cause) {
      setProblem(clipErrorSentence(cause));
    }
    job.refresh();
  }, [job, jobId]);

  const failed = !running && highlights.run?.status === 'FAILED';
  const notes = findClipsNotes(highlights, running);

  return (
    <div className="flex flex-col gap-3" data-testid="find-clips">
      {running ? (
        <div className="flex flex-col gap-2" data-testid="find-clips-progress">
          <div className="flex items-center justify-between gap-3 font-sans text-sm text-ink">
            <span className="type-ui">{live?.stageLabel ?? 'Waiting for its turn'}</span>
            <span className="tabular-nums type-muted">{Math.round(live?.progress ?? 0)}%</span>
          </div>
          <Progress
            value={live?.progress ?? 0}
            tone="ai"
            aria-label={live?.stageLabel ?? 'Waiting for its turn'}
          />
          {timeLeft(live?.etaSeconds ?? null) ? (
            <p className={NOTE}>{timeLeft(live?.etaSeconds ?? null)}</p>
          ) : null}
          <Button variant="secondary" size="sm" className="w-fit" onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Sprint 13: Find Clips opens Clip Setup; Quick Find keeps Sprint 12's one press. */}
          <div className="flex items-stretch gap-2">
            <Link
              href={`/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(videoId)}/setup`}
              className={cn(buttonVariants({ variant: 'highlight' }), 'flex-1')}
              data-testid="find-clips-setup"
            >
              <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
              Find Clips
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  aria-label="More Ways To Find Clips"
                  className="px-3"
                  disabled={starting}
                  data-testid="find-clips-more"
                >
                  <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={block !== null || starting}
                  onSelect={request}
                  data-testid="find-clips-quick"
                >
                  {starting ? 'Starting' : quickFindLabel(price)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <AiMinutesChipView meter={meter} orgId={orgId} className="self-start" />
        </div>
      )}

      {block && !running ? (
        <Alert variant="warning" className="items-center" data-testid="find-clips-blocked">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{block}</p>
          <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>See Plans</ActionLink>
        </Alert>
      ) : null}

      {problem ? (
        <Alert variant="warning" className="items-center" data-testid="find-clips-problem">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{problem}</p>
        </Alert>
      ) : null}

      {failed && !problem ? (
        <Alert variant="danger" className="items-center" data-testid="find-clips-failed">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{HIGHLIGHTS_FAILED}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={block !== null || starting}
            onClick={request}
          >
            Try Again
          </Button>
        </Alert>
      ) : null}

      {notes.map((note) => (
        <p key={note} className={NOTE}>
          {note}
        </p>
      ))}

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Find Clips Again</AlertDialogTitle>
            <AlertDialogDescription>{findAgainSentence(price)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="highlight"
              onClick={() => {
                setConfirming(false);
                void start();
              }}
            >
              Find Clips
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
