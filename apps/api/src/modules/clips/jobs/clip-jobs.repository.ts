/**
 * `ClipJob` rows (Sprint 12, Module 02). Every read and write is scoped to
 * the workspace: an id from the URL is never enough on its own. The two
 * exceptions are the queue claims below (`claimWaitingRenders` and the
 * reconcile's lists), which look across workspaces on purpose: turns are
 * shared between them.
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
import { JOB_PRIORITIES, priorityRank } from '@postgear/video-engine';
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

  /** Several jobs of the workspace (a batch's live stream, Module 11); ids of others are skipped. */
  findMany(orgId: string, jobIds: readonly string[]): Promise<ClipJob[]> {
    if (jobIds.length === 0) return Promise.resolve([]);
    return prisma.clipJob.findMany({ where: { id: { in: [...jobIds] }, organizationId: orgId } });
  }

  /** QUEUED or RUNNING jobs of a kind for a video. */
  countOpenForVideo(
    orgId: string,
    videoId: string,
    kind: ClipJobKind,
    tx: ClipsTx = prisma,
  ): Promise<number> {
    return tx.clipJob.count({
      where: { organizationId: orgId, videoId, kind, status: { in: [...OPEN_JOB_STATUSES] } },
    });
  }

  /**
   * Module 16: a highlights run whose job was just closed here (a cancel of a
   * job that never started, or the reconcile) takes the same end. Only while
   * the run is still open, so the worker's own last word stands.
   */
  async closeHighlightRun(
    orgId: string,
    runId: string | null,
    status: 'FAILED' | 'CANCELLED',
    now: Date,
  ): Promise<void> {
    if (!runId) return;
    await prisma.clipHighlightRun.updateMany({
      where: { id: runId, organizationId: orgId, status: { in: [...OPEN_JOB_STATUSES] } },
      data: { status, finishedAt: now },
    });
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
   * Claims the exports that may start now (Sprint 13, Module 11, the fair
   * render queue). Every export is made QUEUED; this hands out the free
   * render slots:
   *
   * - at most `slots` exports hold a slot across every workspace, and at
   *   most ONE per workspace. A slot is held by a RUNNING export or by a
   *   QUEUED one already handed to Temporal (`startedAt` set by this claim,
   *   as `claimWaitingImports` does);
   * - each waiting workspace offers its own next export (highest priority,
   *   then the oldest: `pickNext`); across workspaces the highest `priority`
   *   goes first (copied from `clips.queue_priority` when the job was made),
   *   and equal priorities take turns: the workspace served longest ago (or
   *   never) goes first, so a 30 clip batch never starves a later one.
   *
   * Preview Export (`proof: true`) is not queued here: it starts at once and
   * holds no slot. Serializable, so two callers at once (a `settled` call and
   * a new export) can never both fill the last slot or start two exports of
   * one workspace: one is aborted, retried, and sees the other's claim.
   */
  claimWaitingRenders(slots: number, now: Date): Promise<ClaimedJob[]> {
    return serializable(async (tx) => {
      const busy = await tx.clipJob.findMany({
        where: {
          kind: ClipJobKind.RENDER,
          input: { path: ['proof'], equals: false },
          OR: [
            { status: ClipJobStatus.RUNNING },
            { status: ClipJobStatus.QUEUED, startedAt: { not: null } },
          ],
        },
        select: { organizationId: true },
        take: WAITING_SCAN_LIMIT,
      });
      const free = Math.max(0, Math.floor(slots) - busy.length);
      if (free === 0) return [];
      const busyOrgs = new Set(busy.map((row) => row.organizationId));

      const waiting = await tx.clipJob.findMany({
        where: {
          kind: ClipJobKind.RENDER,
          status: ClipJobStatus.QUEUED,
          startedAt: null,
          input: { path: ['proof'], equals: false },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: WAITING_SCAN_LIMIT,
        select: { id: true, organizationId: true, kind: true, priority: true, createdAt: true },
      });
      const candidates = waiting.filter((job) => !busyOrgs.has(job.organizationId));
      if (candidates.length === 0) return [];

      const lastServed = new Map<string, Date>();
      for (const orgId of new Set(candidates.map((job) => job.organizationId))) {
        const last = await tx.clipJob.findFirst({
          where: {
            organizationId: orgId,
            kind: ClipJobKind.RENDER,
            startedAt: { not: null },
            input: { path: ['proof'], equals: false },
          },
          orderBy: [{ startedAt: 'desc' }],
          select: { startedAt: true },
        });
        if (last?.startedAt) lastServed.set(orgId, last.startedAt);
      }

      const picked = pickFairRenders(candidates, lastServed, free, now);
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
      where: {
        status: ClipJobStatus.QUEUED,
        createdAt: { lt: before },
        // Module 11: an export still waiting for its turn is the render queue's, not the
        // reconcile's; left out here so a long batch never fills the window and hides a
        // claimed export whose start was lost.
        NOT: {
          AND: [
            { kind: ClipJobKind.RENDER },
            { startedAt: null },
            { NOT: { input: { path: ['proof'], equals: true } } },
          ],
        },
      },
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

/**
 * Waiting jobs looked at per claim: far more than any cap, so the priority
 * order holds. The global `CLIPS_QUEUE_CEILING` (500 waiting jobs of every
 * kind) keeps the waiting renders under it.
 */
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

/**
 * The fair render order (Module 11): one export per waiting workspace (its
 * own next, by `pickNext`), then across workspaces the highest priority
 * first and, among equals, the workspace served longest ago (never served
 * counts as longest), then the oldest export. Answers at most `count`, never
 * two of one workspace.
 *
 * No workspace starves: every `RENDER_AGING_MS` an export has waited counts
 * as one priority step higher, up to the top one, so a low priority export
 * that keeps being overtaken soon ranks with the highest and, never served
 * lately, goes first.
 */
export function pickFairRenders<
  T extends { id: string; organizationId: string; priority: string; createdAt: Date },
>(
  waiting: readonly T[],
  lastServed: ReadonlyMap<string, Date>,
  count: number,
  now: Date = new Date(),
): T[] {
  if (count <= 0) return [];
  const heads = new Map<string, T>();
  for (const job of pickNext(waiting, waiting.length)) {
    if (!heads.has(job.organizationId)) heads.set(job.organizationId, job);
  }
  const served = (job: T) =>
    lastServed.get(job.organizationId)?.getTime() ?? Number.NEGATIVE_INFINITY;
  return [...heads.values()]
    .sort((a, b) => {
      const rank = agedRank(b, now) - agedRank(a, now);
      if (rank !== 0) return rank;
      const x = served(a);
      const y = served(b);
      if (x !== y) return x < y ? -1 : 1;
      return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    })
    .slice(0, count);
}

/** Module 11: an export waiting this long counts as one priority step higher (no starving). */
export const RENDER_AGING_MS = 10 * 60_000;

function agedRank(job: { priority: string; createdAt: Date }, now: Date): number {
  const waited = Math.max(0, now.getTime() - job.createdAt.getTime());
  return Math.min(
    TOP_PRIORITY_RANK,
    priorityRank(job.priority) + Math.floor(waited / RENDER_AGING_MS),
  );
}

const TOP_PRIORITY_RANK = priorityRank(JOB_PRIORITIES[JOB_PRIORITIES.length - 1] as string);
