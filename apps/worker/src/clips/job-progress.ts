/**
 * One clip job's row, as its activities move it along (Module 02, section 4).
 *
 * Every write is conditional on the row still being open, so a job that was
 * cancelled (by the API, or by the reconcile) is never brought back by a
 * late progress report, and `done` never overwrites a cancel that landed
 * first. `report` writes at most once a second unless the stage changes, and
 * progress never goes backwards within a stage: the events stream re-reads
 * this row every 750 ms, so the row is the single source of truth.
 *
 * The error stored is always `{ code, message }` with our own sentence for
 * the code (never a tool's text); the API re-derives the sentence from the
 * code anyway when it builds a view.
 */

import { ClipJobStatus, type Prisma, prisma } from '@postgear/db';
import { type ClipJobKind, type ClipPlatformId, clipErrorMessage } from '@postgear/video-engine';

const OPEN = [ClipJobStatus.QUEUED, ClipJobStatus.RUNNING];
export const REPORT_EVERY_MS = 1_000;

export interface StageReport {
  stage: string;
  /** 0 to 100; clamped and rounded. */
  progress: number;
}

export interface StoredJobError {
  code: string;
  message: string;
}

export function storedJobError(code: string, platform?: ClipPlatformId): StoredJobError {
  return { code, message: clipErrorMessage(code, platform) };
}

export class JobClosedError extends Error {
  constructor(readonly jobId: string) {
    super('This job is no longer open.');
    this.name = 'JobClosedError';
  }
}

/** The database calls job-progress makes, so tests can hand a fake. */
export interface JobRowStore {
  markRunning(jobId: string, now: Date): Promise<boolean>;
  report(jobId: string, stage: string, progress: number): Promise<boolean>;
  finish(
    jobId: string,
    status: 'DONE' | 'FAILED' | 'CANCELLED',
    data: { output?: Prisma.InputJsonValue; error?: Prisma.InputJsonValue },
    now: Date,
  ): Promise<boolean>;
  statusOf(jobId: string): Promise<ClipJobStatus | null>;
}

export const prismaJobRowStore: JobRowStore = {
  async markRunning(jobId, now) {
    const result = await prisma.clipJob.updateMany({
      where: { id: jobId, status: { in: OPEN } },
      data: { status: ClipJobStatus.RUNNING, startedAt: now },
    });
    return result.count > 0;
  },
  async report(jobId, stage, progress) {
    const result = await prisma.clipJob.updateMany({
      where: { id: jobId, status: ClipJobStatus.RUNNING },
      data: { stage, progress },
    });
    return result.count > 0;
  },
  async finish(jobId, status, data, now) {
    const result = await prisma.clipJob.updateMany({
      where: { id: jobId, status: { in: OPEN } },
      data: {
        status,
        finishedAt: now,
        ...(status === 'DONE' ? { progress: 100 } : {}),
        ...(data.output !== undefined ? { output: data.output } : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
      },
    });
    return result.count > 0;
  },
  async statusOf(jobId) {
    const row = await prisma.clipJob.findUnique({ where: { id: jobId }, select: { status: true } });
    return row?.status ?? null;
  },
};

export interface JobProgress {
  readonly jobId: string;
  /** QUEUED to RUNNING (and the start time). Throws `JobClosedError` when the job was closed meanwhile. */
  running(): Promise<void>;
  /** Throttled to one write a second unless the stage changes. Never throws on a database hiccup. */
  report(update: StageReport): Promise<void>;
  /** Forces the last throttled report out (call before a long step with no progress). */
  flush(): Promise<void>;
  done(output: Prisma.InputJsonValue): Promise<boolean>;
  failed(code: string, platform?: ClipPlatformId): Promise<boolean>;
  cancelled(): Promise<boolean>;
}

export interface JobProgressOptions {
  store?: JobRowStore;
  now?: () => Date;
  kind?: ClipJobKind;
  /** Called with a short reason when a report write fails; defaults to a console line. */
  onWriteError?: (reason: string) => void;
}

export function jobProgress(jobId: string, options: JobProgressOptions = {}): JobProgress {
  const store = options.store ?? prismaJobRowStore;
  const now = options.now ?? (() => new Date());
  const onWriteError =
    options.onWriteError ??
    ((reason: string) =>
      console.warn(JSON.stringify({ event: 'clips.job.report_failed', jobId, reason })));

  let lastStage: string | null = null;
  let lastProgress = -1;
  let lastWriteAt = 0;
  let pending: StageReport | null = null;

  const write = async (update: StageReport): Promise<void> => {
    lastWriteAt = now().getTime();
    pending = null;
    try {
      await store.report(jobId, update.stage, update.progress);
    } catch (error) {
      onWriteError(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    jobId,

    async running() {
      const moved = await store.markRunning(jobId, now());
      if (!moved) throw new JobClosedError(jobId);
    },

    async report(update) {
      const progress = Math.max(0, Math.min(100, Math.round(update.progress)));
      const stageChanged = update.stage !== lastStage;
      if (!stageChanged && progress <= lastProgress) return;

      lastStage = update.stage;
      lastProgress = progress;
      const next = { stage: update.stage, progress };

      if (stageChanged || now().getTime() - lastWriteAt >= REPORT_EVERY_MS) {
        await write(next);
      } else {
        pending = next;
      }
    },

    async flush() {
      if (pending) await write(pending);
    },

    done(output) {
      return store.finish(jobId, 'DONE', { output }, now());
    },

    failed(code, platform) {
      return store.finish(
        jobId,
        'FAILED',
        { error: storedJobError(code, platform) as unknown as Prisma.InputJsonValue },
        now(),
      );
    },

    cancelled() {
      return store.finish(
        jobId,
        'CANCELLED',
        { error: storedJobError('cancelled') as unknown as Prisma.InputJsonValue },
        now(),
      );
    },
  };
}
