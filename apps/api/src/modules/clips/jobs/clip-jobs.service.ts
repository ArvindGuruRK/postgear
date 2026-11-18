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
 * - **Imports wait their turn** (Module 04). `clips.concurrent_imports` is
 *   read when an IMPORT is started: at the cap the job stays QUEUED ("Waiting
 *   for its turn"), never refused. `startWaiting` hands the free slots to the
 *   waiting imports, highest priority first, then the oldest; it runs when a
 *   job is made, when any job ends (the worker's `settled` call) and in the
 *   reconcile. The claim is serializable, so two callers never overfill.
 */
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type ClipJob, ClipJobKind, type Prisma } from '@postgear/db';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  CLIP_JOB_INPUT_SCHEMAS,
  type ClipJobInputs,
  clipErrorMessage,
} from '@postgear/video-engine';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { UsageService } from '../../entitlements/usage.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import type { ClipsTx } from '../clips.tx';
import { type ClipJobView, median, TERMINAL_JOB_STATUSES, toJobView } from './clip-job-view';
import { ClipJobsRepository, type NewClipJob } from './clip-jobs.repository';

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
}

@Injectable()
export class ClipJobsService {
  private readonly logger = new Logger(ClipJobsService.name);

  constructor(
    private readonly repository: ClipJobsRepository,
    private readonly scheduling: SchedulingService,
    private readonly resolver: EntitlementResolver,
    private readonly usage: UsageService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

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

    const priority = await this.resolver.get(params.orgId, 'clips.queue_priority');

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
   * Starts the job's workflow. An IMPORT goes through the workspace's cap
   * (`startWaiting`), so it may stay QUEUED behind others; any other kind is
   * started at once. False means it stays QUEUED for later.
   */
  async start(job: Pick<ClipJob, 'id' | 'organizationId' | 'kind'>): Promise<boolean> {
    if (job.kind === ClipJobKind.IMPORT) {
      const started = await this.startWaiting(job.organizationId);
      return started.includes(job.id);
    }
    return this.dispatch(job);
  }

  /** `create` then `start`. */
  async createAndStart<K extends ClipJobKind>(params: CreateClipJob<K>): Promise<ClipJob> {
    const job = await this.create(params);
    await this.start(job);
    return job;
  }

  /**
   * Starts the workspace's waiting imports that fit under
   * `clips.concurrent_imports`, highest priority first, then the oldest.
   * Answers the ids started. A start Temporal refuses gives its claim back
   * and stops the pass (the reconcile tries again); never throws for that.
   */
  async startWaiting(orgId: string): Promise<string[]> {
    const cap = await this.resolver.get(orgId, 'clips.concurrent_imports');
    const claimed = await this.repository.claimWaitingImports(orgId, cap, new Date());
    const started: string[] = [];

    for (let index = 0; index < claimed.length; index += 1) {
      const job = claimed[index] as (typeof claimed)[number];
      if (await this.dispatch(job)) {
        started.push(job.id);
        continue;
      }
      // Temporal is out of reach: hand every remaining claim back.
      for (const rest of claimed.slice(index)) {
        await this.repository.releaseClaim(orgId, rest.id);
      }
      break;
    }
    return started;
  }

  /**
   * One job. A running job carries the estimate a single look allows: this
   * workspace's recent jobs of the kind, scaled by what is left (the live
   * stream refines it from the pace it watches). So the page's polling
   * fallback still shows "about 2 minutes left".
   */
  async view(orgId: string, jobId: string): Promise<ClipJobView> {
    const job = await this.require(orgId, jobId);
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
        if (job.kind === ClipJobKind.IMPORT && job.videoId) {
          await this.removeCancelledImport(orgId, job.videoId);
        }
        if (job.kind === ClipJobKind.IMPORT) {
          await this.startWaiting(orgId).catch((error: unknown) =>
            this.logStartFailure(orgId, error),
          );
        }
      }
    }

    return toJobView(await this.require(orgId, jobId));
  }

  /** The row, or a 404 that reads the same for "not yours" and "not there". */
  async require(orgId: string, jobId: string): Promise<ClipJob> {
    const job = isUuid(jobId) ? await this.repository.find(orgId, jobId) : null;
    if (!job)
      throw new NotFoundException({ message: CLIPS_MESSAGES.JOB_NOT_FOUND, code: 'job_not_found' });
    return job;
  }

  /**
   * The reconcile's start for a job whose earlier start was lost: straight
   * to Temporal (an IMPORT here already holds its slot). Duplicates are
   * rejected by workflow id, so a start that did land is never doubled.
   */
  restart(job: Pick<ClipJob, 'id' | 'organizationId' | 'kind'>): Promise<boolean> {
    return this.dispatch(job);
  }

  /** One workflow start; false leaves the row QUEUED (logged). */
  private async dispatch(job: Pick<ClipJob, 'id' | 'organizationId' | 'kind'>): Promise<boolean> {
    const started = await this.scheduling.startClipJob(job.id, job.organizationId, job.kind);
    if (!started) {
      this.logger.warn(
        JSON.stringify({ event: 'clips.job.start_deferred', jobId: job.id, kind: job.kind }),
      );
    }
    return started;
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

  private logStartFailure(orgId: string, error: unknown): void {
    this.logger.warn(
      JSON.stringify({
        event: 'clips.job.start_waiting_failed',
        orgId,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
