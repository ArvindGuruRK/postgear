/**
 * `ClipJob` rows (Sprint 12, Module 02). Every read and write is scoped to
 * the workspace: an id from the URL is never enough on its own. The
 * exceptions are the scheduler's claim and the estimate's reads (Sprint 13,
 * Module 15: `claimNext`, `queueSnapshot`, `inputsOf`, `lengths`) and the
 * reconcile's lists, which look across workspaces on purpose: slots and
 * turns are shared between them.
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
import { type ClipsTx, serializable } from '../clips.tx';
import {
  CLASS_KINDS,
  type HeldJob,
  JOB_CLASSES,
  nextJobs,
  PAID_AI_KINDS,
  SCHEDULER_CLASSES,
  type SchedulerClass,
  type SchedulerJob,
  schedulerClassOf,
  servedKey,
} from './clip-scheduler.rules';

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
    if (result.count > 0) await this.wipeDriveToken(jobId);
    return result.count > 0;
  }

  /**
   * Module 16: an import from Google Drive carries its sealed access token in
   * the job's input until the file is stored. The worker wipes it on its own
   * failure and cancel paths; `cancelOpen` and `failOpen` close a job the
   * worker never finished, so they wipe it too. The job is closed by then,
   * so nothing else writes its input.
   */
  private async wipeDriveToken(jobId: string): Promise<void> {
    const job = await prisma.clipJob.findFirst({
      where: { id: jobId, kind: ClipJobKind.IMPORT },
      select: { input: true },
    });
    const input = job?.input as { origin?: { drive?: { token?: string | null } } } | null;
    if (!input?.origin?.drive || input.origin.drive.token == null) return;
    const wiped = {
      ...input,
      origin: { ...input.origin, drive: { ...input.origin.drive, token: null } },
    };
    await prisma.clipJob.updateMany({
      where: { id: jobId, kind: ClipJobKind.IMPORT },
      data: { input: wiped as Prisma.InputJsonValue },
    });
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
   * Claims the jobs one scheduler pass may start now (Sprint 13, Module 15;
   * it replaces Module 04's import claim and Module 11's render claim). The
   * rules are `nextJobs` in `clip-scheduler.rules.ts`; this reads the rows:
   *
   * - the jobs holding a slot: RUNNING, or QUEUED and already handed to
   *   Temporal (`startedAt` set by this claim; the worker sets it again when
   *   it really starts);
   * - for each class with a free slot, its waiting jobs (QUEUED, not
   *   claimed), oldest first;
   * - each waiting workspace's `clips.concurrent_imports` (`importCap`, read
   *   through the resolver by the caller) and when it was last served in the
   *   class.
   *
   * A job `mayStart` refuses (a paid AI job whose charge is not standing
   * yet) is left waiting and the pick is made again without it, so only the
   * jobs a pick would start are checked, each at most once a pass.
   *
   * A Preview Export is never read here: it starts at once and holds no
   * slot. Serializable, so two passes at once (a `settled` call and a new
   * job) can never both fill the last slot: one is aborted, retried, and
   * sees the other's claim.
   */
  claimNext(
    slots: Readonly<Record<SchedulerClass, number>>,
    importCap: (orgId: string) => Promise<number>,
    now: Date,
    mayStart: (job: SchedulerJob) => Promise<boolean>,
  ): Promise<ClaimedJob[]> {
    return serializable(async (tx) => {
      const holding = await this.holding(tx);
      const held = countByClass(holding);

      const waiting: SchedulerRow[] = [];
      for (const cls of SCHEDULER_CLASSES) {
        if (Math.floor(slots[cls]) - (held.get(cls) ?? 0) <= 0) continue;
        waiting.push(...(await this.waitingIn(tx, cls)));
      }
      if (waiting.length === 0) return [];

      const importsPerWorkspace = new Map<string, number>();
      for (const orgId of new Set(
        waiting.filter((job) => job.kind === ClipJobKind.IMPORT).map((job) => job.organizationId),
      )) {
        importsPerWorkspace.set(orgId, await importCap(orgId));
      }

      const lastServed = await this.lastServed(tx, waiting);
      const limits = { slots, importsPerWorkspace, lastServed };
      const allowed = new Set<string>();
      let candidates = waiting;
      let picked = nextJobs(candidates, holding, limits, now);
      for (;;) {
        const unchecked = picked.filter((job) => !allowed.has(job.id));
        if (unchecked.length === 0) break;
        const refused = new Set<string>();
        for (const job of unchecked) {
          if (await mayStart(job)) allowed.add(job.id);
          else refused.add(job.id);
        }
        if (refused.size === 0) break;
        candidates = candidates.filter((job) => !refused.has(job.id));
        picked = nextJobs(candidates, holding, limits, now);
      }
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
   * One class as the estimate sees it (Module 15): its waiting jobs, the
   * ones holding a slot with their progress, and the workspaces' last turns.
   * Read without a transaction: an estimate is about, never a claim.
   */
  async queueSnapshot(cls: SchedulerClass): Promise<QueueSnapshot> {
    const [waiting, holding] = await Promise.all([
      prisma.clipJob.findMany({
        where: {
          status: ClipJobStatus.QUEUED,
          startedAt: null,
          kind: { in: [...CLASS_KINDS[cls]] },
          NOT: PREVIEW_EXPORT,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: WAITING_SCAN_LIMIT,
        select: QUEUE_ROW_SELECT,
      }),
      prisma.clipJob.findMany({
        where: { ...HOLDING_SLOT, kind: { in: [...CLASS_KINDS[cls]] } },
        take: WAITING_SCAN_LIMIT,
        select: { ...QUEUE_ROW_SELECT, status: true, progress: true },
      }),
    ]);
    return {
      waiting,
      holding,
      lastServed: await this.lastServed(prisma, waiting),
      clipped: waiting.length >= WAITING_SCAN_LIMIT,
    };
  }

  /**
   * The inputs of the jobs an estimate sizes from their input (every kind
   * but an import, Find Clips and an export, whose size comes from the video
   * or the clip row; an export's input holds its whole document).
   */
  async inputsOf(jobIds: readonly string[]): Promise<Map<string, unknown>> {
    if (jobIds.length === 0) return new Map();
    const rows = await prisma.clipJob.findMany({
      where: {
        id: { in: [...jobIds] },
        NOT: { kind: { in: [ClipJobKind.IMPORT, ClipJobKind.HIGHLIGHTS, ClipJobKind.RENDER] } },
      },
      select: { id: true, input: true },
    });
    return new Map(rows.map((row) => [row.id, row.input]));
  }

  /**
   * Lengths of videos and clips named by job rows, in ms (null when not
   * known yet). Across workspaces on purpose, like the claim: the ids come
   * from job rows, and only a length is read, checked against the job's own
   * workspace by the caller.
   */
  async lengths(
    videoIds: readonly string[],
    clipIds: readonly string[],
  ): Promise<{
    videos: Map<string, { organizationId: string; durationMs: number | null }>;
    clips: Map<string, { organizationId: string; durationMs: number }>;
  }> {
    const [videos, clips] = await Promise.all([
      videoIds.length === 0
        ? []
        : prisma.clipVideo.findMany({
            where: { id: { in: [...new Set(videoIds)] } },
            select: { id: true, organizationId: true, durationMs: true },
          }),
      clipIds.length === 0
        ? []
        : prisma.clip.findMany({
            where: { id: { in: [...new Set(clipIds)] } },
            select: { id: true, organizationId: true, durationMs: true },
          }),
    ]);
    return {
      videos: new Map(videos.map(({ id, ...rest }) => [id, rest])),
      clips: new Map(clips.map(({ id, ...rest }) => [id, rest])),
    };
  }

  /** The jobs holding a slot, every class (a Preview Export never holds one). */
  private holding(tx: ClipsTx): Promise<HeldRow[]> {
    return tx.clipJob.findMany({
      where: HOLDING_SLOT,
      select: { organizationId: true, kind: true },
      take: WAITING_SCAN_LIMIT,
    });
  }

  /** One class's waiting jobs, oldest first. */
  private waitingIn(tx: ClipsTx, cls: SchedulerClass): Promise<SchedulerRow[]> {
    return tx.clipJob.findMany({
      where: {
        status: ClipJobStatus.QUEUED,
        startedAt: null,
        kind: { in: [...CLASS_KINDS[cls]] },
        NOT: PREVIEW_EXPORT,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: WAITING_SCAN_LIMIT,
      select: { id: true, organizationId: true, kind: true, priority: true, createdAt: true },
    });
  }

  /**
   * When each waiting workspace last had a job of the class started (the
   * newest `startedAt`), keyed by `servedKey`. A workspace never served is
   * left out, which ranks it first among equals.
   */
  private async lastServed(
    tx: ClipsTx,
    waiting: readonly Pick<SchedulerRow, 'organizationId' | 'kind'>[],
  ): Promise<Map<string, number>> {
    const served = new Map<string, number>();
    const wanted = new Map<string, { cls: SchedulerClass; orgId: string }>();
    for (const job of waiting) {
      const cls = JOB_CLASSES[job.kind];
      if (cls) wanted.set(servedKey(cls, job.organizationId), { cls, orgId: job.organizationId });
    }
    for (const [key, { cls, orgId }] of wanted) {
      const last = await tx.clipJob.findFirst({
        where: {
          organizationId: orgId,
          kind: { in: [...CLASS_KINDS[cls]] },
          startedAt: { not: null },
          NOT: PREVIEW_EXPORT,
        },
        orderBy: [{ startedAt: 'desc' }],
        select: { startedAt: true },
      });
      if (last?.startedAt) served.set(key, last.startedAt.getTime());
    }
    return served;
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
   * The reconcile's QUEUED candidates in every workspace, oldest first,
   * bounded so one pass stays short: the starts that may have been lost.
   *
   * - A job a pass claimed before `before` (`startedAt` is the claim) and
   *   that is still QUEUED.
   * - A Preview Export made before `before` and never started (it is
   *   started at once, outside the scheduler).
   *
   * A job still waiting for its turn (QUEUED, not claimed) is the
   * scheduler's, not the reconcile's, and is left out (Module 11's rule for
   * exports, now for every kind), so a long queue never fills the window
   * and hides a claimed job whose start was lost.
   */
  staleQueued(before: Date, take: number): Promise<ClipJob[]> {
    return prisma.clipJob.findMany({
      where: {
        status: ClipJobStatus.QUEUED,
        OR: [
          { startedAt: { lt: before } },
          { ...PREVIEW_EXPORT, startedAt: null, createdAt: { lt: before } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /**
   * Paid AI jobs (`PAID_AI_KINDS`) still waiting for their turn that were
   * made before `before`, oldest first: the reconcile fails the ones whose
   * charge never landed (Module 15). A list of its own, so a long queue of
   * charged ones never hides a claimed job whose start was lost.
   */
  staleWaitingPaid(before: Date, take: number): Promise<ClipJob[]> {
    return prisma.clipJob.findMany({
      where: {
        status: ClipJobStatus.QUEUED,
        startedAt: null,
        kind: { in: [...PAID_AI_KINDS] },
        createdAt: { lt: before },
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
    if (result.count > 0) await this.wipeDriveToken(jobId);
    return result.count > 0;
  }
}

/**
 * Rows looked at per class per claim: far more than any slot count, so the
 * order holds. The global `CLIPS_QUEUE_CEILING` (500 waiting jobs of every
 * kind) keeps each class under it.
 */
const WAITING_SCAN_LIMIT = 500;

/** A Preview Export: started at once, outside the scheduler (Module 11). */
const PREVIEW_EXPORT = {
  kind: ClipJobKind.RENDER,
  input: { path: ['proof'], equals: true },
} satisfies Prisma.ClipJobWhereInput;

/**
 * A job holding a slot: RUNNING, or QUEUED and claimed by a pass. A Preview
 * Export never holds one. Every RENDER input has `proof`, so the JSON path
 * is never missing on a RENDER row (a missing path would read as NULL).
 */
const HOLDING_SLOT = {
  OR: [
    { status: ClipJobStatus.RUNNING },
    { status: ClipJobStatus.QUEUED, startedAt: { not: null } },
  ],
  NOT: PREVIEW_EXPORT,
} satisfies Prisma.ClipJobWhereInput;

const QUEUE_ROW_SELECT = {
  id: true,
  organizationId: true,
  kind: true,
  priority: true,
  createdAt: true,
  videoId: true,
  clipId: true,
} as const;

export interface ClaimedJob {
  id: string;
  organizationId: string;
  kind: ClipJobKind;
}

interface SchedulerRow extends SchedulerJob {
  kind: ClipJobKind;
}

interface HeldRow extends HeldJob {
  kind: ClipJobKind;
}

/** A waiting job as the estimate reads it. */
export interface QueueRow {
  id: string;
  organizationId: string;
  kind: ClipJobKind;
  priority: string;
  createdAt: Date;
  videoId: string | null;
  clipId: string | null;
}

export interface QueueSnapshot {
  /** Waiting (QUEUED, not claimed), oldest first. */
  waiting: QueueRow[];
  /** Holding a slot, with how far each has got. */
  holding: Array<QueueRow & { status: ClipJobStatus; progress: number }>;
  lastServed: Map<string, number>;
  /** True when more were waiting than one read takes: a position past it is not known. */
  clipped: boolean;
}

function countByClass(holding: readonly HeldJob[]): Map<SchedulerClass, number> {
  const counts = new Map<SchedulerClass, number>();
  for (const job of holding) {
    const cls = schedulerClassOf(job);
    if (cls) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return counts;
}
