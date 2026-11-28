/**
 * How long a queued Clips job waits (Sprint 13, Module 15): the number
 * behind "Waiting for our turn, about 4 minutes". The rules are in
 * `clip-queue.rules.ts`; this reads the queue and keeps the paces.
 *
 * - **`estimate(kind, orgId)`** answers `{ position, aboutSeconds }`: the
 *   jobs of the same class ahead in the scheduler's order (`startOrder`) and
 *   the ones holding a slot, each sized in minutes of work and timed with its
 *   kind's pace, laid onto the class's slots. `aboutSeconds` is whole minutes
 *   (0 is "less than a minute"), or null when a job in the way has no honest
 *   number (an import whose length is not known yet) or the queue is longer
 *   than one read takes. With a job id, that job's place; without, where a
 *   job made now would stand.
 * - **The paces** are kept in Redis (`clips:queue:pace:<kind>`, 30 days),
 *   one rolling average per kind, updated by `recordDuration` from the
 *   worker's `settled` call (`finishedAt - startedAt` over the job's minutes
 *   of work). Two jobs ending at the same moment may count as one sample:
 *   an estimate, not a ledger. Without Redis (a spec), in memory.
 * - **Cheap to ask often**: a class's queue is read at most every 5 seconds
 *   and the paces every 30, shared by every view and stream of this process.
 *
 * Never shown: other workspaces' jobs, ids or counts beyond the position.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClipJob } from '@postgear/db';
import { CLIP_JOB_KINDS, type ClipJobKind } from '@postgear/video-engine';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { RedisService } from '../../redis/redis.service';
import type { ClipJobWaiting } from './clip-job-view';
import { ClipJobsRepository, type QueueRow, type QueueSnapshot } from './clip-jobs.repository';
import {
  expectedSeconds,
  nextPace,
  type Pace,
  paceSample,
  roundToMinutes,
  secondsLeft,
  waitSeconds,
  type WorkLengths,
  workMinutes,
} from './clip-queue.rules';
import {
  PER_WORKSPACE_SLOTS,
  type SchedulerClass,
  schedulerClassOf,
  startOrder,
} from './clip-scheduler.rules';
import { schedulerSlots } from './clip-scheduler.service';

export interface QueueEstimate {
  /** Jobs that start before this one (0: it is next). */
  position: number;
  /** Seconds until its turn in whole minutes, or null when there is no honest number. */
  aboutSeconds: number | null;
}

const PACE_PREFIX = 'clips:queue:pace:';
const PACE_TTL_SECONDS = 30 * 24 * 60 * 60;
const SNAPSHOT_MS = 5_000;
const PACES_MS = 30_000;
/** The id a job that does not exist yet stands under in `estimate`. */
const NEW_JOB_ID = 'new-job';

interface Snapshot extends QueueSnapshot {
  at: number;
  /** Seconds each job (waiting or holding) is expected to hold its slot; null when not known. */
  expected: Map<string, number | null>;
}

type Store = Pick<RedisService, 'get' | 'set'>;

@Injectable()
export class ClipQueueService {
  private readonly logger = new Logger(ClipQueueService.name);
  private readonly slots: Readonly<Record<SchedulerClass, number>>;
  private readonly store: Store;
  private readonly snapshots = new Map<SchedulerClass, Promise<Snapshot>>();
  private paces: { at: number; values: Promise<Map<ClipJobKind, Pace | null>> } | null = null;

  constructor(
    private readonly repository: ClipJobsRepository,
    private readonly resolver: EntitlementResolver,
    @Optional() redis?: RedisService,
    @Optional() config?: ConfigService,
  ) {
    this.slots = schedulerSlots(config);
    this.store = redis ?? memoryStore();
  }

  /** Where a job of `kind` stands in the workspace's queue (`jobId`), or would stand if made now. */
  async estimate(
    kind: ClipJobKind,
    orgId: string,
    options: { jobId?: string; priority?: string; now?: Date } = {},
  ): Promise<QueueEstimate | null> {
    const cls = schedulerClassOf({ kind });
    if (!cls) return null;
    const now = options.now ?? new Date();
    const target: QueueRow = {
      id: options.jobId ?? NEW_JOB_ID,
      organizationId: orgId,
      kind,
      priority: options.priority ?? 'normal',
      createdAt: now,
      videoId: null,
      clipId: null,
    };
    return this.place(cls, target, options.jobId === undefined, now);
  }

  /**
   * The `waiting` of each job given that is still waiting for its turn
   * (QUEUED, not claimed, not a Preview Export). A job gone from the queue
   * meanwhile is left out. Never throws: a failed read answers no time.
   */
  async waitingFor(
    jobs: readonly Pick<ClipJob, 'id' | 'organizationId' | 'kind' | 'priority' | 'createdAt'>[],
    now: Date = new Date(),
  ): Promise<Map<string, ClipJobWaiting>> {
    const answers = new Map<string, ClipJobWaiting>();
    for (const job of jobs) {
      const lowPriority = job.priority === 'low';
      const cls = schedulerClassOf(job);
      if (!cls) continue;
      try {
        const target = { ...job, videoId: null, clipId: null };
        const placed = await this.place(cls, target, false, now);
        if (placed) answers.set(job.id, { ...placed, lowPriority });
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.queue.estimate_failed',
            jobId: job.id,
            reason: reason(error),
          }),
        );
        answers.set(job.id, { aboutSeconds: null, position: 0, lowPriority });
      }
    }
    return answers;
  }

  /**
   * Counts one finished job in its kind's pace: the seconds it held its slot
   * per minute of work. Only a DONE job of the scheduler with both times;
   * never throws (a lost sample only leaves the average as it was).
   */
  async recordDuration(job: ClipJob): Promise<void> {
    try {
      if (job.status !== 'DONE' || !job.startedAt || !job.finishedAt) return;
      if (!schedulerClassOf(job)) return;
      const lengths = await this.lengthsOf([job]);
      const work = workMinutes(job, lengths.get(job.id) ?? NO_LENGTHS);
      const held = (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000;
      const sample = paceSample(held, work);
      if (sample === null) return;
      const pace = nextPace(await this.readPace(job.kind), sample);
      await this.store.set(PACE_PREFIX + job.kind, JSON.stringify(pace), PACE_TTL_SECONDS);
      this.paces = null;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({ event: 'clips.queue.pace_failed', jobId: job.id, reason: reason(error) }),
      );
    }
  }

  /** The target's place in its class, reading the queue again once when the cached copy does not have it. */
  private async place(
    cls: SchedulerClass,
    target: QueueRow,
    hypothetical: boolean,
    now: Date,
  ): Promise<QueueEstimate | null> {
    let snapshot = await this.snapshot(cls, false);
    if (!hypothetical && !snapshot.waiting.some((job) => job.id === target.id)) {
      snapshot = await this.snapshot(cls, true);
      if (!snapshot.waiting.some((job) => job.id === target.id)) {
        // Claimed (or gone) meanwhile; past a long queue's read, its place is not known.
        return snapshot.clipped ? { position: snapshot.waiting.length, aboutSeconds: null } : null;
      }
    }

    const waiting = hypothetical ? [...snapshot.waiting, target] : snapshot.waiting;
    const order = startOrder(waiting, cls, snapshot.lastServed, now, target.id);
    const position = Math.max(0, order.length - 1);
    if (snapshot.clipped) return { position, aboutSeconds: null };

    const ahead = order.slice(0, position).map((job) => snapshot.expected.get(job.id) ?? null);
    const running = snapshot.holding.map((job) =>
      secondsLeft(
        snapshot.expected.get(job.id) ?? null,
        job.status === 'RUNNING' ? job.progress : 0,
      ),
    );
    const seconds = waitSeconds({
      ahead,
      running,
      ownFull: await this.ownFull(cls, target, snapshot),
      slots: this.slots[cls],
    });
    return { position, aboutSeconds: seconds === null ? null : roundToMinutes(seconds) };
  }

  /**
   * When the target's own workspace already holds all it may in the same
   * count, the seconds left of those jobs (its turn comes only after one
   * ends); otherwise null.
   */
  private async ownFull(
    cls: SchedulerClass,
    target: QueueRow,
    snapshot: Snapshot,
  ): Promise<Array<number | null> | null> {
    const importing = target.kind === 'IMPORT';
    const own = snapshot.holding.filter(
      (job) =>
        job.organizationId === target.organizationId && (job.kind === 'IMPORT') === importing,
    );
    if (own.length === 0) return null;
    const cap = importing
      ? Number(await this.resolver.get(target.organizationId, 'clips.concurrent_imports'))
      : PER_WORKSPACE_SLOTS[cls];
    if (!Number.isFinite(cap) || own.length < cap) return null;
    return own.map((job) =>
      secondsLeft(
        snapshot.expected.get(job.id) ?? null,
        job.status === 'RUNNING' ? job.progress : 0,
      ),
    );
  }

  private snapshot(cls: SchedulerClass, fresh: boolean): Promise<Snapshot> {
    const cached = this.snapshots.get(cls);
    if (cached && !fresh) {
      return cached.then((value) =>
        Date.now() - value.at < SNAPSHOT_MS ? value : this.snapshot(cls, true),
      );
    }
    const next = this.readSnapshot(cls);
    this.snapshots.set(cls, next);
    next.catch(() => this.snapshots.delete(cls));
    return next;
  }

  private async readSnapshot(cls: SchedulerClass): Promise<Snapshot> {
    const base = await this.repository.queueSnapshot(cls);
    const rows = [...base.waiting, ...base.holding];
    const [lengths, paces] = await Promise.all([this.lengthsOf(rows), this.readPaces()]);
    const inputs = await this.repository.inputsOf(rows.map((row) => row.id));
    const expected = new Map<string, number | null>();
    for (const row of rows) {
      const work = workMinutes(
        { kind: row.kind, input: inputs.get(row.id) },
        lengths.get(row.id) ?? NO_LENGTHS,
      );
      expected.set(row.id, expectedSeconds(row.kind, work, paces.get(row.kind) ?? null));
    }
    return { ...base, at: Date.now(), expected };
  }

  /** The video and clip lengths each job is sized by, checked against the job's workspace. */
  private async lengthsOf(
    jobs: readonly Pick<ClipJob, 'id' | 'organizationId' | 'kind' | 'videoId' | 'clipId'>[],
  ): Promise<Map<string, WorkLengths>> {
    const videoIds = jobs
      .filter((job) => job.kind === 'IMPORT' || job.kind === 'HIGHLIGHTS')
      .map((job) => job.videoId)
      .filter((id): id is string => Boolean(id));
    const clipIds = jobs
      .filter((job) => job.kind === 'RENDER')
      .map((job) => job.clipId)
      .filter((id): id is string => Boolean(id));
    const found = await this.repository.lengths(videoIds, clipIds);
    const answer = new Map<string, WorkLengths>();
    for (const job of jobs) {
      const video = job.videoId ? found.videos.get(job.videoId) : undefined;
      const clip = job.clipId ? found.clips.get(job.clipId) : undefined;
      answer.set(job.id, {
        videoMs: video && video.organizationId === job.organizationId ? video.durationMs : null,
        clipMs: clip && clip.organizationId === job.organizationId ? clip.durationMs : null,
      });
    }
    return answer;
  }

  private readPaces(): Promise<Map<ClipJobKind, Pace | null>> {
    if (this.paces && Date.now() - this.paces.at < PACES_MS) return this.paces.values;
    const values = (async () => {
      const entries = await Promise.all(
        CLIP_JOB_KINDS.map(async (kind) => [kind, await this.readPace(kind)] as const),
      );
      return new Map<ClipJobKind, Pace | null>(entries);
    })();
    this.paces = { at: Date.now(), values };
    values.catch(() => {
      this.paces = null;
    });
    return values;
  }

  private async readPace(kind: ClipJobKind): Promise<Pace | null> {
    const raw = await this.store.get(PACE_PREFIX + kind);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<Pace>;
      return typeof value.secondsPerMinute === 'number' &&
        Number.isFinite(value.secondsPerMinute) &&
        value.secondsPerMinute >= 0 &&
        typeof value.samples === 'number' &&
        value.samples >= 1
        ? { secondsPerMinute: value.secondsPerMinute, samples: Math.floor(value.samples) }
        : null;
    } catch {
      return null;
    }
  }
}

const NO_LENGTHS: WorkLengths = { videoMs: null, clipMs: null };

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The paces in this process only, when no Redis was given (specs). */
function memoryStore(): Store {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
