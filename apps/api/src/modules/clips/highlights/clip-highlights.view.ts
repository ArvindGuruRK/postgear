/**
 * What the video page reads about Find Clips (Module 16): the price for this
 * video, whether it has sound, and the latest run with its job.
 *
 * A run's own status is written at its ends (the worker's finish, failure
 * and cancel bookkeeping, the API's cancel of a job that never started, the
 * reconcile). While its job is still open, or if a write was lost, the job's
 * status is the truth, so the page never shows a run as running after its
 * job ended.
 */
import {
  type ClipHighlightRun,
  type ClipJob,
  ClipJobKind,
  type ClipJobStatus,
  type ClipVideo,
  prisma,
} from '@postgear/db';
import {
  aiMinutesCost,
  highlightsOutputSchema,
  isSignalTrackName,
  type SignalTrackName,
  tracksSentence,
} from '@postgear/video-engine';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';

const OPEN: ReadonlySet<ClipJobStatus> = new Set(['QUEUED', 'RUNNING']);

export interface HighlightRunView {
  id: string;
  /** The run's HIGHLIGHTS job, for progress and Cancel. */
  jobId: string | null;
  status: ClipJobStatus;
  /** Clips the run made. */
  found: number;
  /** The tracks the scorer used, in registry order. */
  tracks: SignalTrackName[];
  /** "Sound and picture": the "How this was found" line; null before the run ends. */
  foundBy: string | null;
  /** What the run was charged. */
  aiMinutes: number;
  /** A failed or cancelled run had its AI minutes given back. */
  refunded: boolean;
  /**
   * Sprint 13, Module 05: a run with a setup, once it ended: whether it read
   * the transcript, heard no speech, was asked for something, and how many
   * clips matched. Null for Sprint 12's run (Quick Find) and before the end.
   */
  ai: {
    read: boolean;
    noSpeech: boolean;
    asked: boolean;
    matched: number;
    /** Module 06: Look For Action ran, and the clips action found or helped. */
    watched?: boolean;
    actions?: number;
  } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface HighlightsView {
  /** What Find Clips costs for this video, in AI minutes. */
  price: number;
  /** The video has no sound: the run looks at the picture only. */
  noSound: boolean;
  run: HighlightRunView | null;
  job: ClipJobView | null;
}

/** Find Clips' price for a video of this length (Module 16 section 4). */
export function highlightsPrice(durationMs: number | null): number {
  return aiMinutesCost('signals', Math.max(0, durationMs ?? 0));
}

/** The run's status, with the job's as the truth while the run has not been closed. */
export function runStatus(
  run: Pick<ClipHighlightRun, 'status'>,
  job: Pick<ClipJob, 'status'> | null,
): ClipJobStatus {
  if (!OPEN.has(run.status)) return run.status;
  return job ? job.status : run.status;
}

export function toHighlightRunView(run: ClipHighlightRun, job: ClipJob | null): HighlightRunView {
  const status = runStatus(run, job);
  const tracks = run.tracks.filter(isSignalTrackName);
  return {
    id: run.id,
    jobId: job?.id ?? null,
    status,
    found: run.found,
    tracks,
    foundBy: status === 'DONE' && tracks.length > 0 ? tracksSentence(tracks) : null,
    aiMinutes: run.aiMinutesCharged,
    refunded: status === 'FAILED' || status === 'CANCELLED',
    ai: aiOf(job),
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

function aiOf(job: ClipJob | null): HighlightRunView['ai'] {
  const parsed = highlightsOutputSchema.safeParse(job?.output);
  return parsed.success && parsed.data.ai ? parsed.data.ai : null;
}

/** The newest run of a video and its job. */
export async function latestRunOf(
  orgId: string,
  videoId: string,
): Promise<{ run: ClipHighlightRun; job: ClipJob | null } | null> {
  const run = await prisma.clipHighlightRun.findFirst({
    where: { organizationId: orgId, videoId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (!run) return null;
  const job = await prisma.clipJob.findFirst({
    where: { organizationId: orgId, highlightRunId: run.id, kind: ClipJobKind.HIGHLIGHTS },
    orderBy: { createdAt: 'desc' },
  });
  return { run, job };
}

/** The video page's Find Clips block. */
export async function highlightsOf(
  orgId: string,
  video: Pick<ClipVideo, 'id' | 'durationMs' | 'hasAudio'>,
): Promise<HighlightsView> {
  const latest = await latestRunOf(orgId, video.id);
  return {
    price: highlightsPrice(video.durationMs),
    noSound: !video.hasAudio,
    run: latest ? toHighlightRunView(latest.run, latest.job) : null,
    job: latest?.job ? toJobView(latest.job) : null,
  };
}
