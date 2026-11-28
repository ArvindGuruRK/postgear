/**
 * The Clips maintenance pass (Sprint 12, Module 04), called by the worker's
 * maintenance workflow on `/internal/clips/reconcile`. It mends what a lost
 * message left behind, in every workspace, a bounded batch per pass:
 *
 * - **QUEUED, waiting for its turn** (not claimed): the scheduler's, never
 *   the reconcile's (Sprint 13, Module 15, Module 11's rule for exports now
 *   for every kind). The pass runs one scheduler pass at the end; it never
 *   restarts such a job itself.
 * - **QUEUED, claimed longer than `CLIP_RECONCILE_START_AFTER_MS` ago**, or
 *   a Preview Export made that long ago: a start that may have been lost,
 *   looked up in Temporal. Running is left alone; closed without writing its
 *   row is failed; never started gives its slot back and waits for its turn
 *   again (a Preview Export, outside the scheduler, is started again).
 * - **RUNNING with no write for the same time**: failed only when Temporal
 *   says its workflow is closed or gone; a quiet running one is left.
 * - **A paid AI job never started with no charge left** (Sprint 13, Module
 *   15: a listen, a Find Clips run or a voice whose charge was refused or
 *   lost after its row was written) is failed, never started: a claimed one
 *   whose start was lost, and one still waiting for its turn (the scheduler
 *   never starts it) made longer than `CLIP_RECONCILE_START_AFTER_MS` ago.
 *   The waiting one is failed even while Temporal is out of reach: it was
 *   never handed to it.
 * - A failed job gets our sentence, its charges reversed, and an IMPORT's
 *   video goes FAILED with the bell saying so. A DOWNLOAD's folder is
 *   emptied (both its charges come back with the rest).
 * - **Temporal unreachable**: the pass stops and changes nothing more, so a
 *   network blip never fails healthy jobs.
 * - **Exports** (Sprint 13, Module 11): a failed export of a batch rings
 *   no bell of its own; the batch's one
 *   notice is written when it was the last to end, and recent batches are
 *   settled again in case a `settled` call was lost.
 *
 * Answers `{ started, failed }`.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type ClipJob,
  ClipJobKind,
  ClipJobStatus,
  ClipVideoStatus,
  type Prisma,
  prisma,
} from '@postgear/db';
import { CLIP_RECONCILE_START_AFTER_MS, type ClipReconcileAnswer } from '@postgear/scheduling';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import { clipErrorMessage } from '@postgear/video-engine';
import { UsageService } from '../../entitlements/usage.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { NotificationsService } from '../../notifications/notifications.service';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { isWaitingTurn } from '../jobs/clip-job-view';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { PAID_AI_KINDS, schedulerClassOf } from '../jobs/clip-scheduler.rules';
import { liveChargeFor } from '../clips-ai-charges';
import { ClipCostService } from '../costs/clip-cost.service';
import { batchIdOf, ClipBatchNoticeService } from '../exports/clip-batch-notice.service';
import { exportFailedNotice, videoFailedNotice } from './clip-notices';

/**
 * Sprint 13, Module 15: the kinds whose own job is charged AI minutes at the
 * press (listening, Find Clips, a made voice). Neither the scheduler nor the
 * reconcile starts one whose charge is gone. Kept with the scheduler's rules
 * (`clip-scheduler.rules.ts`), which use it too.
 */
export { PAID_AI_KINDS };

/** Jobs looked at per pass, per list: keeps one pass well inside its activity timeout. */
export const RECONCILE_QUEUED_BATCH = 100;
export const RECONCILE_RUNNING_BATCH = 50;
/** Paid AI jobs waiting for their turn looked at per pass, for a charge that never landed. */
export const RECONCILE_UNCHARGED_BATCH = 50;

/**
 * The engine code a job that was lost fails with. A run Temporal stopped at
 * its time limit (Module 19) says so ("This took too long and was
 * stopped."), whatever its kind.
 */
export function lostJobCode(job: Pick<ClipJob, 'kind' | 'input'>, timedOut = false): string {
  if (timedOut) return 'timed_out';
  if (job.kind === ClipJobKind.IMPORT) return 'import_failed';
  if (job.kind === ClipJobKind.HIGHLIGHTS) return 'highlights_failed';
  if (job.kind === ClipJobKind.DOWNLOAD) return 'download_failed';
  // Sprint 13, Module 10: "We could not finish the edit."
  if (job.kind === ClipJobKind.AUTO_EDIT) return 'auto_edit_failed';
  if (job.kind === ClipJobKind.RENDER) {
    const proof = (job.input as { proof?: unknown } | null)?.proof === true;
    return proof ? 'preview_failed' : 'export_failed';
  }
  return 'tool_failed';
}

/** How far back the reconcile mends a missing job cost. */
const COST_MEND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ClipReconcileService {
  private readonly logger = new Logger(ClipReconcileService.name);

  constructor(
    private readonly jobs: ClipJobsService,
    private readonly repository: ClipJobsRepository,
    private readonly scheduling: SchedulingService,
    private readonly usage: UsageService,
    private readonly notifications: NotificationsService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    // Module 11: Export All's one notice (optional only for older specs).
    @Optional() private readonly batchNotices?: ClipBatchNoticeService,
    // Module 15: mends the cost of a job whose `settled` call was lost (optional only for older specs).
    @Optional() private readonly costs?: ClipCostService,
  ) {}

  async reconcile(now = new Date()): Promise<ClipReconcileAnswer> {
    const before = new Date(now.getTime() - CLIP_RECONCILE_START_AFTER_MS);
    let started = 0;
    let failed = 0;
    let reachable = true;

    for (const job of await this.repository.staleQueued(before, RECONCILE_QUEUED_BATCH)) {
      // Module 15: waiting for its turn is the scheduler's (the pass below), never restarted here.
      if (isWaitingTurn(job)) continue;
      const state = await this.scheduling.describeClipJob(job.id);
      if (state === 'unavailable') {
        reachable = false;
        break;
      }
      if (state === 'running') continue;
      if (state === 'closed' || state === 'timedOut') {
        if (await this.failJob(job, now, state === 'timedOut')) failed += 1;
        continue;
      }
      // Sprint 13, Module 15: a paid AI job is never started without its charge (a row can
      // outlive a refused or lost charge). It fails instead; nothing is held, nothing is given.
      if (PAID_AI_KINDS.has(job.kind) && (await liveChargeFor(job.organizationId, job.id)) <= 0) {
        this.logger.warn(
          JSON.stringify({ event: 'clips.reconcile.uncharged', jobId: job.id, kind: job.kind }),
        );
        if (await this.failJob(job, now)) failed += 1;
        continue;
      }
      // Never started: a claimed job gives its slot back and waits for its turn again (the
      // pass below may hand it the next one); a Preview Export, outside the queue, starts now.
      if (schedulerClassOf(job) !== null) {
        await this.repository.releaseClaim(job.organizationId, job.id);
        continue;
      }
      if (await this.jobs.restart(job)) {
        started += 1;
      } else {
        reachable = false;
        break;
      }
    }

    // Waiting paid AI jobs whose charge never landed: the scheduler never starts them, so they
    // would wait for ever. Never handed to Temporal, so this needs no answer from it.
    for (const job of await this.repository.staleWaitingPaid(before, RECONCILE_UNCHARGED_BATCH)) {
      if (!isWaitingTurn(job) || !PAID_AI_KINDS.has(job.kind)) continue;
      if ((await liveChargeFor(job.organizationId, job.id)) > 0) continue;
      this.logger.warn(
        JSON.stringify({ event: 'clips.reconcile.uncharged', jobId: job.id, kind: job.kind }),
      );
      if (await this.failJob(job, now)) failed += 1;
    }

    if (reachable) {
      for (const job of await this.repository.staleRunning(before, RECONCILE_RUNNING_BATCH)) {
        const state = await this.scheduling.describeClipJob(job.id);
        if (state === 'unavailable') {
          reachable = false;
          break;
        }
        if (state === 'running') continue;
        if (await this.failJob(job, now, state === 'timedOut')) failed += 1;
      }
    }

    // Module 15: one scheduler pass across every class and workspace (it never throws).
    if (reachable) started += (await this.jobs.startNext('reconcile')).length;

    if (this.batchNotices) {
      try {
        await this.batchNotices.sweep(now);
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.reconcile.batch_sweep_failed',
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    // Module 15: a cost a lost `settled` call never wrote, for the last week (never throws).
    await this.costs?.recordMissing(new Date(now.getTime() - COST_MEND_WINDOW_MS));

    if (started > 0 || failed > 0 || !reachable) {
      this.logger.log(JSON.stringify({ event: 'clips.reconcile', started, failed, reachable }));
    }
    return { started, failed };
  }

  /**
   * Fails a lost job, conditional on it still being open (the worker's own
   * last word always wins). True when this pass changed it.
   */
  private async failJob(job: ClipJob, now: Date, timedOut = false): Promise<boolean> {
    const code = lostJobCode(job, timedOut);
    const was = job.status === ClipJobStatus.RUNNING ? 'running' : 'queued';
    const error = { code, message: clipErrorMessage(code) } satisfies Prisma.InputJsonValue;
    if (!(await this.repository.failOpen(job.id, error, now))) return false;

    await this.usage.reverseAllFor(job.organizationId, job.id);

    if (job.kind === ClipJobKind.HIGHLIGHTS) {
      await this.repository.closeHighlightRun(
        job.organizationId,
        job.highlightRunId,
        'FAILED',
        now,
      );
    }

    if (job.kind === ClipJobKind.DOWNLOAD) {
      // What it fetched so far goes, as the worker's own failure does (no asset row yet: that comes with DONE).
      await this.removeDownloadFiles(job);
    }

    if (job.kind === ClipJobKind.IMPORT && job.videoId) {
      const changed = await prisma.clipVideo.updateMany({
        where: {
          id: job.videoId,
          organizationId: job.organizationId,
          status: ClipVideoStatus.IMPORTING,
          deletedAt: null,
        },
        data: { status: ClipVideoStatus.FAILED, error },
      });
      if (changed.count > 0) {
        const video = await prisma.clipVideo.findFirst({
          where: { id: job.videoId, organizationId: job.organizationId },
          select: { id: true, title: true },
        });
        if (video) await this.notify(videoFailedNotice(job.organizationId, video), job.id);
      }
    }

    const batched = batchIdOf(job) !== null;
    if (
      job.kind === ClipJobKind.RENDER &&
      lostJobCode(job) === 'export_failed' &&
      job.clipId &&
      !batched
    ) {
      const clip = await prisma.clip.findFirst({
        where: { id: job.clipId, organizationId: job.organizationId },
        select: { id: true, title: true },
      });
      if (clip) await this.notify(exportFailedNotice(job.organizationId, clip), job.id);
    }
    // Module 11: a batch's export is counted in its one notice instead.
    if (batched) await this.batchNotices?.settleJob(job);

    this.logger.warn(
      JSON.stringify({
        event: 'clips.reconcile.job_failed',
        jobId: job.id,
        kind: job.kind,
        was,
      }),
    );
    return true;
  }

  /** Best-effort: a storage hiccup is logged and left to the cleanup sweep. */
  private async removeDownloadFiles(job: ClipJob): Promise<void> {
    try {
      await this.storage.deletePrefix(clipKeys.downloadPrefix(job.organizationId, job.id));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.reconcile.download_files_left',
          jobId: job.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private async notify(
    input: Parameters<NotificationsService['notify']>[0],
    jobId: string,
  ): Promise<void> {
    try {
      await this.notifications.notify(input);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.reconcile.notice_failed',
          jobId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
