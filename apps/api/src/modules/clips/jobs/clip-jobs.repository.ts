/**
 * `ClipJob` rows (Sprint 12, Module 02). Every read and write is scoped to
 * the workspace: an id from the URL is never enough on its own.
 */
import { Injectable } from '@nestjs/common';
import {
  type ClipJob,
  ClipJobKind,
  ClipJobStatus,
  ClipVideoStatus,
  type Prisma,
  prisma,
} from '@postgear/db';
import { priorityRank } from '@postgear/video-engine';
import { type ClipsTx, serializable } from '../clips.tx';

/** The statuses a job can still change from. */
export const OPEN_JOB_STATUSES: readonly ClipJobStatus[] = [
  ClipJobStatus.QUEUED,
  ClipJobStatus.RUNNING,
];

export interface NewClipJob {
  id: string;
  organizationId: string;
  kind: ClipJobKind;
  priority: string;
  input: Prisma.InputJsonValue;
  videoId: string | null;
  clipId: string | null;
  highlightRunId: string | null;
  createdById: string | null;
  expiresAt: Date | null;
}

@Injectable()
export class ClipJobsRepository {
  /** Writes a QUEUED row; inside `tx` when it must land with other rows (a video, a clip). */
  create(job: NewClipJob, tx: ClipsTx = prisma): Promise<ClipJob> {
    return tx.clipJob.create({ data: { ...job, status: ClipJobStatus.QUEUED } });
  }

  find(orgId: string, jobId: string): Promise<ClipJob | null> {
    return prisma.clipJob.findFirst({ where: { id: jobId, organizationId: orgId } });
  }

  /**
   * Marks a job cancelled when its workflow never existed or is gone.
   * Conditional on the job still being open, so it never overwrites the
   * worker's own last word. Returns whether this call changed the row.
   */
  async cancelOpen(orgId: string, jobId: string, error: Prisma.InputJsonValue): Promise<boolean> {
    const result = await prisma.clipJob.updateMany({
      where: { id: jobId, organizationId: orgId, status: { in: [...OPEN_JOB_STATUSES] } },
      data: { status: ClipJobStatus.CANCELLED, error, finishedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * How long this workspace's last finished jobs of a kind took, in seconds,
   * newest first: the prior an ETA leans on before the job has a pace.
   */
  async recentDurations(orgId: string, kind: ClipJobKind, take = 10): Promise<number[]> {
    const rows = await prisma.clipJob.findMany({
      where: {
        organizationId: orgId,
        kind,
        status: ClipJobStatus.DONE,
        startedAt: { not: null },
        finishedAt: { not: null },
      },
      orderBy: { finishedAt: 'desc' },
      take,
      select: { startedAt: true, finishedAt: true },
    });
    return rows
      .map((row) =>
        row.startedAt && row.finishedAt
          ? (row.finishedAt.getTime() - row.startedAt.getTime()) / 1000
          : Number.NaN,
      )
      .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  }

  /** Jobs of a kind still waiting or running in the workspace (the concurrency check). */
  countOpen(orgId: string, kinds: readonly ClipJobKind[]): Promise<number> {
    return prisma.clipJob.count({
      where: {
        organizationId: orgId,
        kind: { in: [...kinds] },
        status: { in: [...OPEN_JOB_STATUSES] },
      },
    });
  }

  /**
   * Claims the IMPORT jobs that may start now (Module 04, the concurrent
   * import cap). A slot is held by a RUNNING job or by a QUEUED one already
   * handed to Temporal (`startedAt` set by this claim; the worker sets it
   * again when it really starts). The free slots go to the waiting jobs with
   * the highest priority, then the oldest. Serializable, so two callers at
   * once (a `settled` call and a new import) can never both fill the last
   * slot: one is aborted, retried, and sees the other's claim.
   */
  claimWaitingImports(orgId: string, cap: number, now: Date): Promise<ClaimedJob[]> {
    return serializable(async (tx) => {
      const busy = await tx.clipJob.count({
        where: {
          organizationId: orgId,
          kind: ClipJobKind.IMPORT,
          OR: [
            { status: ClipJobStatus.RUNNING },
            { status: ClipJobStatus.QUEUED, startedAt: { not: null } },
          ],
        },
      });
      const free = Math.max(0, Math.floor(cap) - busy);
      if (free === 0) return [];

      const waiting = await tx.clipJob.findMany({
        where: {
          organizationId: orgId,
          kind: ClipJobKind.IMPORT,
          status: ClipJobStatus.QUEUED,
          startedAt: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: WAITING_SCAN_LIMIT,
        select: { id: true, organizationId: true, kind: true, priority: true, createdAt: true },
      });
      const picked = pickNext(waiting, free);
      if (picked.length === 0) return [];

      await tx.clipJob.updateMany({
        where: {
          id: { in: picked.map((job) => job.id) },
          status: ClipJobStatus.QUEUED,
          startedAt: null,
        },
        data: { startedAt: now },
      });
      return picked.map(({ id, organizationId, kind }) => ({ id, organizationId, kind }));
    });
  }

  /**
   * A cancelled import's video: soft deleted while still IMPORTING (the row
   * and its rights record stay), and its asset rows dropped with the files.
   */
  async removeCancelledVideo(orgId: string, videoId: string, now: Date): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const removed = await tx.clipVideo.updateMany({
        where: {
          id: videoId,
          organizationId: orgId,
          status: ClipVideoStatus.IMPORTING,
          deletedAt: null,
        },
        data: { deletedAt: now, removedReason: 'deleted' },
      });
      if (removed.count === 0) return false;
      await tx.clipAsset.deleteMany({ where: { organizationId: orgId, videoId } });
      return true;
    });
  }

  /** Gives a claim back when its workflow could not be started; the job waits for the next pass. */
  async releaseClaim(orgId: string, jobId: string): Promise<void> {
    await prisma.clipJob.updateMany({
      where: { id: jobId, organizationId: orgId, status: ClipJobStatus.QUEUED },
      data: { startedAt: null },
    });
  }

  /** The newest job of a kind for a video (the card's state, the origin to retry). */
  latestForVideo(orgId: string, videoId: string, kind: ClipJobKind): Promise<ClipJob | null> {
    return prisma.clipJob.findFirst({
      where: { organizationId: orgId, videoId, kind },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** Open jobs of one video, newest first (cancel and delete stop them). */
  openForVideo(orgId: string, videoId: string): Promise<ClipJob[]> {
    return prisma.clipJob.findMany({
      where: { organizationId: orgId, videoId, status: { in: [...OPEN_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The reconcile's QUEUED candidates in every workspace: made before
   * `before`, oldest first. Bounded, so one pass stays short.
   */
  staleQueued(before: Date, take: number): Promise<ClipJob[]> {
    return prisma.clipJob.findMany({
      where: { status: ClipJobStatus.QUEUED, createdAt: { lt: before } },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /** RUNNING jobs that have not written anything since `before`, quietest first. */
  staleRunning(before: Date, take: number): Promise<ClipJob[]> {
    return prisma.clipJob.findMany({
      where: { status: ClipJobStatus.RUNNING, updatedAt: { lt: before } },
      orderBy: { updatedAt: 'asc' },
      take,
    });
  }

  /**
   * Marks an open job FAILED with our error, conditional on it still being
   * open, so it never overwrites the worker's own last word. True when this
   * call changed the row.
   */
  async failOpen(jobId: string, error: Prisma.InputJsonValue, now: Date): Promise<boolean> {
    const result = await prisma.clipJob.updateMany({
      where: { id: jobId, status: { in: [...OPEN_JOB_STATUSES] } },
      data: { status: ClipJobStatus.FAILED, error, finishedAt: now },
    });
    return result.count > 0;
  }
}

/** Waiting jobs looked at per claim: far more than any cap, so the priority order holds. */
const WAITING_SCAN_LIMIT = 500;

export interface ClaimedJob {
  id: string;
  organizationId: string;
  kind: ClipJobKind;
}

/** Highest priority first, then the oldest: the order waiting imports start in. */
export function pickNext<T extends { id: string; priority: string; createdAt: Date }>(
  waiting: readonly T[],
  count: number,
): T[] {
  if (count <= 0) return [];
  return [...waiting]
    .sort(
      (a, b) =>
        priorityRank(b.priority) - priorityRank(a.priority) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, count);
}
