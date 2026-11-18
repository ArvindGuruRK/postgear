'use client';

/**
 * The Export tab for now (Module 08 section 5): Module 05's export, a
 * quality and **Export Clip**, with the progress and the outcome. Module 15
 * replaces this body with the full export options.
 *
 * What is on screen is saved first: an export draws the saved version, so a
 * change still waiting for its pause would be left out. When the save cannot
 * land (offline, a conflict) the export does not start and says why.
 */
import {
  Alert,
  AlertDescription,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';
import {
  EXPORT_QUALITIES,
  type ExportQuality,
  QUALITY_LABELS,
  qualityAllowed,
} from '@postgear/video-engine';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api';
import { exportClip } from '@/lib/clips-api';
import { useEntitlements } from '@/lib/entitlements';
import type { ClipSharpState } from '@/types/clips';
import { isTerminalJob } from '../clip-job-model';
import { useClipJob } from '../use-clip-job';

export const EXPORT_UNSAVED_SENTENCE =
  'Your latest changes are not saved yet, so the export would leave them out. Try again once they are saved.';
export const EXPORT_UNREACHABLE_SENTENCE =
  'We could not start the export. Check your connection and try again.';
export const EXPORT_DONE_SENTENCE = 'Your clip is ready in Media.';
export const EXPORT_FAILED_SENTENCE = 'The export did not finish. Try again.';
const SHARP_FETCHING_SENTENCE =
  'We are still getting the sharp video. An export now waits for it before it starts.';

export interface ClipExportState {
  quality: ExportQuality;
  setQuality: (quality: ExportQuality) => void;
  /** The plan's highest quality ('720p' and the rest), or null while unknown. */
  ceiling: string | null;
  running: boolean;
  starting: boolean;
  problem: string | null;
  jobId: string | null;
  start: () => Promise<void>;
}

/** The export's state, kept by the editor so Next ("Export Clip") and the panel share it. */
export function useClipExport({
  orgId,
  clipId,
  flush,
}: {
  orgId: string;
  clipId: string;
  /** Saves what is on screen now; true once the server has it. */
  flush: () => Promise<boolean>;
}): ClipExportState & { job: ReturnType<typeof useClipJob> } {
  const { snapshot } = useEntitlements(orgId);
  const ceilingValue = snapshot?.values['clips.export_max_quality'];
  const ceiling = typeof ceilingValue === 'string' ? ceilingValue : null;
  const [quality, setQuality] = useState<ExportQuality>('1080p');
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const job = useClipJob(jobId);
  const running = job.job ? !isTerminalJob(job.job.status) : false;

  const start = useCallback(async () => {
    if (starting || running) return;
    setStarting(true);
    setProblem(null);
    try {
      if (!(await flush())) {
        setProblem(EXPORT_UNSAVED_SENTENCE);
        return;
      }
      // A plan below the chosen quality exports at its own highest.
      const wanted =
        ceiling &&
        !qualityAllowed(quality, ceiling) &&
        (EXPORT_QUALITIES as readonly string[]).includes(ceiling)
          ? (ceiling as ExportQuality)
          : quality;
      const made = await exportClip(clipId, wanted);
      setJobId(made.id);
    } catch (cause) {
      setProblem(
        cause instanceof ApiError && cause.status !== 0
          ? cause.message
          : EXPORT_UNREACHABLE_SENTENCE,
      );
    } finally {
      setStarting(false);
    }
  }, [ceiling, clipId, flush, quality, running, starting]);

  return { quality, setQuality, ceiling, running, starting, problem, jobId, start, job };
}

export function ExportPanel({
  orgId,
  state,
  sharp,
}: {
  orgId: string;
  state: ClipExportState & { job: ReturnType<typeof useClipJob> };
  sharp: ClipSharpState;
}) {
  const { job } = state;
  const view = job.job;
  // Only what the plan allows (all four while the plan is still loading: the API re-checks).
  const options = EXPORT_QUALITIES.filter(
    (value) => state.ceiling === null || qualityAllowed(value, state.ceiling),
  );
  const shown = options.includes(state.quality) ? state.quality : (options.at(-1) ?? state.quality);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="m-0 font-sans text-sm text-ink type-label">Quality</p>
        <Select value={shown} onValueChange={(value) => state.setQuality(value as ExportQuality)}>
          <SelectTrigger aria-label="Export Quality" disabled={state.running || state.starting}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((value) => (
              <SelectItem key={value} value={value}>
                {QUALITY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {sharp === 'fetching' ? (
        <p className="m-0 font-sans text-sm text-ink type-muted">{SHARP_FETCHING_SENTENCE}</p>
      ) : null}

      {state.problem ? (
        <Alert variant="warning">
          <AlertDescription>{state.problem}</AlertDescription>
        </Alert>
      ) : null}
      {job.error ? (
        <Alert variant="danger">
          <AlertDescription>{job.error}</AlertDescription>
        </Alert>
      ) : null}

      {view && !isTerminalJob(view.status) ? (
        <div className="flex flex-col gap-2" data-testid="clip-export-progress">
          <div className="flex items-center justify-between gap-3 font-sans text-sm text-ink">
            <span>{view.stageLabel}</span>
            <span className="tabular-nums type-muted">{Math.round(view.progress)}%</span>
          </div>
          <Progress value={view.progress} aria-label={view.stageLabel} />
        </div>
      ) : null}
      {view?.status === 'DONE' ? (
        <p className="m-0 font-sans text-sm text-ink" data-testid="clip-export-done">
          {EXPORT_DONE_SENTENCE}{' '}
          <Link
            className="underline underline-offset-2"
            href={`/${encodeURIComponent(orgId)}/media`}
          >
            Open Media
          </Link>
        </p>
      ) : null}
      {view?.status === 'FAILED' ? (
        <Alert variant="danger">
          <AlertDescription>{view.error?.message ?? EXPORT_FAILED_SENTENCE}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
