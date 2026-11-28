/**
 * Clip jobs (Sprint 12, Module 02): the API's side of every long task.
 *
 * The API never touches a video. It writes a `ClipJob` row, starts its
 * workflow and reads the row back; the worker does the work and writes the
 * status. The rules:
 *
 * - **The id comes first.** `newJobId()` is called before any meter charge,
 *   so the charge's idempotency key (`clips.import:<jobId>`) is the same on
 *   a double click, a retried request or a replayed activity.
 * - **The input is checked twice.** Here, with the engine's schema for the
 *   kind, before the row exists; and again by the worker before it starts.
 *   A row that one side cannot read never runs.
 * - **Plan values are copied, not resolved later.** `priority` comes from
 *   `clips.queue_priority` now; quality, the mark and limits are already in
 *   the input. A plan change mid-job never alters a running job.
 * - **Starting is best-effort.** A start that cannot reach Temporal leaves
 *   the row QUEUED; the maintenance reconcile starts it within minutes.
 * - **Every job waits its turn** (Sprint 13, Module 15, one scheduler for
 *   what Module 04's import cap and Module 11's fair render queue did). A job
 *   is made QUEUED ("Waiting for our turn") and `ClipSchedulerService`
 *   starts it when its class (`media`, `media-py`, `render`) and its
 *   workspace have room: `clips.concurrent_imports` imports, 2 other media
 *   jobs, 1 export and 1 Python job per workspace, the class's global slots
 *   across all, the highest priority first and equal priorities taking
 *   turns. A pass runs when a job is made (`start`), when any job ends (the
 *   worker's `settled` call) and in the reconcile. The claim is
 *   serializable, so two callers never overfill. A Preview Export skips the
 *   queue: it is small, always `low`, and the editor waits on it, so it is
 *   started at once and holds no slot. `view` says where a waiting job
 *   stands (`ClipQueueService`).
 * - **An Auto-Edit takes its listening with it** (Sprint 13, Module 10).
 *   Cancelling an AUTO_EDIT job also cancels the listen job it started
 *   (`listenStarted`) while that one is still open, through the listen job's
 *   own cancel, which gives its AI minutes back. A listen job it only joined
 *   belongs to someone else and is left alone.
 */
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ClipJob, ClipJobKind, type Prisma } from '@postgear/db';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  CLIP_JOB_INPUT_SCHEMAS,
  type ClipJobInputs,
  clipErrorMessage,
  type JobPriority,
} from '@postgear/video-engine';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { UsageService } from '../../entitlements/usage.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import type { ClipsTx } from '../clips.tx';
import { ClipBatchNoticeService } from '../exports/clip-batch-notice.service';
import {
  type ClipJobView,
  type ClipJobWaiting,
  isWaitingTurn,
  median,
  TERMINAL_JOB_STATUSES,
  toJobView,
} from './clip-job-view';
import { ClipJobsRepository, type NewClipJob } from './clip-jobs.repository';
import { ClipQueueService } from './clip-queue.service';
import { schedulerClassOf } from './clip-scheduler.rules';
import { ClipSchedulerService } from './clip-scheduler.service';

export interface CreateClipJob<K extends ClipJobKind> {
  /** From `newJobId()`, made before any charge. */
  id: string;
  orgId: string;
  userId: string | null;
  kind: K;
  input: ClipJobInputs[K];
  videoId?: string | null;
  clipId?: string | null;
  highlightRunId?: string | null;
  /** Downloads and previews only. */
  expiresAt?: Date | null;
  /**
   * Overrides the plan's `clips.queue_priority` (Module 15): a Preview Export
   * is always `low`, and an export passes the value it already read.
   */
  priority?: JobPriority;
}

/** An export the scheduler starts in the `render` class: a RENDER that is not a Preview Export. */
export function isQueuedRender(job: Pick<ClipJob, 'kind'> & { input?: unknown }): boolean {
  return job.kind === ClipJobKind.RENDER && schedulerClassOf(job) === 'render';
}

@Injectable()
export class ClipJobsService {
  private readonly logger = new Logger(ClipJobsService.name);
  private readonly scheduler: ClipSchedulerService;
  private readonly queue: ClipQueueService;

  constructor(
    private readonly repository: ClipJobsRepository,
    private readonly scheduling: SchedulingService,
    private readonly resolver: EntitlementResolver,
    private readonly usage: UsageService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    // Module 11: the slots, and the batch notice when a cancel closes a batch's last job.
    @Optional() config?: ConfigService,
    @Optional() private readonly batchNotices?: ClipBatchNoticeService,
    // Module 15: the one scheduler and the estimate. A spec that builds this
    // service by hand gets both made from the same repository and Temporal.
    @Optional() scheduler?: ClipSchedulerService,
    @Optional() queue?: ClipQueueService,
  ) {
    this.scheduler =
      scheduler ?? new ClipSchedulerService(repository, scheduling, resolver, config);
    this.queue = queue ?? new ClipQueueService(repository, resolver, undefined, config);
  }

  /** A job id, made before the charge that names it. */
  newJobId(): string {
    return randomUUID();
  }

  /**
   * The row to write, checked: the input against the kind's schema and the
   * priority copied from the plan. Since the API itself builds every input,
   * a refusal here is a bug, logged with the issue paths (never the values)
   * and answered as a plain failure.
   */
  async build<K extends ClipJobKind>(params: CreateClipJob<K>): Promise<NewClipJob> {
    const parsed = CLIP_JOB_INPUT_SCHEMAS[params.kind].safeParse(params.input);
    if (!parsed.success) {
      this.logger.error(
        JSON.stringify({
          event: 'clips.job.input_invalid',
          kind: params.kind,
          orgId: params.orgId,
          issues: parsed.error.issues.map((issue) => issue.path.join('.')),
        }),
      );
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed');
    }

    const priority =
      params.priority ?? (await this.resolver.get(params.orgId, 'clips.queue_priority'));

    return {
      id: params.id,
      organizationId: params.orgId,
      kind: params.kind,
      priority: String(priority),
      input: parsed.data as Prisma.InputJsonValue,
      videoId: params.videoId ?? null,
      clipId: params.clipId ?? null,
      highlightRunId: params.highlightRunId ?? null,
      createdById: params.userId,
      expiresAt: params.expiresAt ?? null,
    };
  }

  /** Writes the QUEUED row (inside `tx` when it lands with other rows). */
  async create<K extends ClipJobKind>(params: CreateClipJob<K>, tx?: ClipsTx): Promise<ClipJob> {
    return this.repository.create(await this.build(params), tx);
  }

  /**
   * Starts the job's workflow through the scheduler (Module 15): a pass runs
   * and the job starts when its class and its workspace have room, so it may
   * stay QUEUED behind others; a Preview Export is started at once. False
   * means it stays QUEUED for later. The scheduler's claim never fails the
   * request that made the job: a busy database leaves it QUEUED for the next
   * pass.
   */
  async start(
    job: Pick<ClipJob, 'id' | 'organizationId' | 'kind'> & { input?: unknown },
  ): Promise<boolean> {
    return this.scheduler.start(job);
  }

  /** `create` then `start`. */
  async createAndStart<K extends ClipJobKind>(params: CreateClipJob<K>): Promise<ClipJob> {
    const job = await this.create(params);
    await this.start(job);
    return job;
  }

  /**
   * One scheduler pass across every class and workspace (Module 15): starts
   * what may start now and answers the ids. Never throws; a busy database
   * or an unreachable Temporal leaves the jobs QUEUED for the next pass.
   */
  startNext(orgId?: string): Promise<string[]> {
    return this.scheduler.startNext(orgId);
  }

  /**
   * Module 04's name for a pass (it started the waiting imports); now one
   * pass of every class. Throws when the claim fails, as it always did.
   */
  startWaiting(_orgId: string): Promise<string[]> {
    return this.scheduler.pass();
  }

  /** Module 11's name for a pass (it started the waiting exports); now one pass of every class. */
  startWaitingRenders(): Promise<string[]> {
    return this.scheduler.pass();
  }

  /** Module 11's quiet pass: `startNext`. */
  startRendersQuietly(orgId: string): Promise<string[]> {
    return this.scheduler.startNext(orgId);
  }

  /**
   * Counts a finished job in its kind's pace (Module 15), for the estimate
   * of the jobs behind it. Never throws.
   */
  recordDuration(job: ClipJob): Promise<void> {
    return this.queue.recordDuration(job);
  }

  /**
   * Where each job given stands while it waits for its turn (Module 15);
   * a job not waiting is left out. Never throws.
   */
  waitingFor(jobs: readonly ClipJob[]): Promise<Map<string, ClipJobWaiting>> {
    return this.queue.waitingFor(jobs.filter(isWaitingTurn));
  }

  /**
   * One job. A running job carries the estimate a single look allows: this
   * workspace's recent jobs of the kind, scaled by what is left (the live
   * stream refines it from the pace it watches). So the page's polling
   * fallback still shows "about 2 minutes left". A job waiting for its turn
   * carries its place in the queue (Module 15).
   */
  async view(orgId: string, jobId: string): Promise<ClipJobView> {
    const job = await this.require(orgId, jobId);
    if (isWaitingTurn(job)) {
      return toJobView(job, null, (await this.waitingFor([job])).get(job.id) ?? null);
    }
    if (job.status !== 'RUNNING') return toJobView(job);
    const priorSeconds = median(await this.repository.recentDurations(orgId, job.kind));
    return toJobView(job, { samples: [{ at: Date.now(), progress: job.progress }], priorSeconds });
  }

  /**
   * Stops a job. A running workflow is signalled and writes CANCELLED itself
   * (it also cleans its scratch folder, deletes what it stored and gives
   * back what it charged). A job whose workflow never started, or is gone,
   * is marked here, its charges are given back here, and a cancelled import
   * takes its video row and files with it. 409 when it already ended; 503
   * when Temporal cannot be reached, so the button can say to try again.
   */
  async cancel(orgId: string, jobId: string): Promise<ClipJobView> {
    const job = await this.require(orgId, jobId);
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      throw new ConflictException({ message: CLIPS_MESSAGES.JOB_FINISHED, code: 'job_finished' });
    }

    const outcome = await this.scheduling.cancelClipJob(job.id);
    if (outcome === 'unavailable') {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'tools_offline', {
        message: CLIPS_MESSAGES.CANCEL_UNREACHABLE,
      });
    }

    if (outcome === 'notFound') {
      const changed = await this.repository.cancelOpen(orgId, job.id, {
        code: 'cancelled',
        message: clipErrorMessage('cancelled'),
      });
      if (changed) {
        await this.usage.reverseAllFor(orgId, job.id);
        if (job.kind === ClipJobKind.HIGHLIGHTS) {
          await this.repository.closeHighlightRun(
            orgId,
            job.highlightRunId,
            'CANCELLED',
            new Date(),
          );
        }
        if (job.kind === ClipJobKind.IMPORT && job.videoId) {
          await this.removeCancelledImport(orgId, job.videoId);
        }
        // Module 15: a claimed job gave its slot back (the next one may start).
        await this.startNext(orgId);
        if (job.kind === ClipJobKind.RENDER) {
          // Module 11: it may have been the last open job of its batch.
          await this.batchNotices?.settleJob(job);
        }
      }
    }

    if (job.kind === ClipJobKind.AUTO_EDIT) await this.cancelListenOf(orgId, job);

    return toJobView(await this.require(orgId, jobId));
  }

  /**
   * Module 10: the listen job an AUTO_EDIT started, cancelled through its own
   * path (the minutes come back there). Best-effort: a listen job that ended
   * meanwhile, or a Temporal hiccup, is logged and never fails the cancel the
   * person asked for.
   */
  private async cancelListenOf(orgId: string, job: ClipJob): Promise<void> {
    const parsed = CLIP_JOB_INPUT_SCHEMAS.AUTO_EDIT.safeParse(job.input);
    if (!parsed.success || !parsed.data.listenStarted || !parsed.data.listenJobId) return;
    const listenJobId = parsed.data.listenJobId;
    const listen = await this.repository.find(orgId, listenJobId);
    if (!listen || listen.kind !== ClipJobKind.TRANSCRIBE) return;
    if (TERMINAL_JOB_STATUSES.has(listen.status)) return;
    try {
      await this.cancel(orgId, listenJobId);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.auto_edit.listen_cancel_failed',
          jobId: job.id,
          listenJobId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  /** The row, or a 404 that reads the same for "not yours" and "not there". */
  async require(orgId: string, jobId: string): Promise<ClipJob> {
    const job = isUuid(jobId) ? await this.repository.find(orgId, jobId) : null;
    if (!job)
      throw new NotFoundException({ message: CLIPS_MESSAGES.JOB_NOT_FOUND, code: 'job_not_found' });
    return job;
  }

  /**
   * The reconcile's start for a Preview Export whose earlier start was lost:
   * straight to Temporal (it holds no slot). Duplicates are rejected by
   * workflow id, so a start that did land is never doubled.
   */
  restart(job: Pick<ClipJob, 'id' | 'organizationId' | 'kind'>): Promise<boolean> {
    return this.scheduler.dispatch(job);
  }

  /**
   * A cancelled import that never ran: the video row is soft deleted (its
   * rights record stays) and anything stored under it, such as an uploaded
   * original, is removed. Best-effort on the files: a storage hiccup is
   * logged and left to the cleanup sweep.
   */
  private async removeCancelledImport(orgId: string, videoId: string): Promise<void> {
    await this.repository.removeCancelledVideo(orgId, videoId, new Date());
    try {
      await this.storage.deletePrefix(clipKeys.videoPrefix(orgId, videoId));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.video.files_left',
          videoId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
