/**
 * The Clips maintenance pass (Sprint 12, Module 04), called by the worker's
 * maintenance workflow on `/internal/clips/reconcile`. It mends what a lost
 * message left behind, in every workspace, a bounded batch per pass:
 *
 * - **QUEUED, older than `CLIP_RECONCILE_START_AFTER_MS`**: an IMPORT that
 *   never held a slot just waits for `startWaiting` below. One that holds a
 *   slot, or any other kind, is looked up in Temporal: running is left
 *   alone, never started is started again (an IMPORT gives its slot back
 *   and queues like the rest), closed without writing its row is failed.
 * - **RUNNING with no write for the same time**: failed only when Temporal
 *   says its workflow is closed or gone; a quiet running one is left.
 * - A failed job gets our sentence, its charges reversed, and an IMPORT's
 *   video goes FAILED with the bell saying so. A DOWNLOAD's folder is
 *   emptied (both its charges come back with the rest).
 * - **Temporal unreachable**: the pass stops and changes nothing more, so a
 *   network blip never fails healthy jobs.
 * - **Exports** (Sprint 13, Module 11, the fair render queue): an export
 *   that never held a slot is waiting for its turn and is left to
 *   `startWaitingRenders` at the end of the pass; one that held a slot but
 *   never started gives the slot back and queues again, as an IMPORT does.
 *   A failed export of a batch rings no bell of its own; the batch's one
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
import { ClipJobsService, isQueuedRender } from '../jobs/clip-jobs.service';
import { batchIdOf, ClipBatchNoticeService } from '../exports/clip-batch-notice.service';
import { exportFailedNotice, videoFailedNotice } from './clip-notices';

/** Jobs looked at per pass, per list: keeps one pass well inside its activity timeout. */
export const RECONCILE_QUEUED_BATCH = 100;
export const RECONCILE_RUNNING_BATCH = 50;

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
  ) {}

  async reconcile(now = new Date()): Promise<ClipReconcileAnswer> {
    const before = new Date(now.getTime() - CLIP_RECONCILE_START_AFTER_MS);
    const orgs = new Set<string>();
    let started = 0;
    let failed = 0;
    let reachable = true;

    for (const job of await this.repository.staleQueued(before, RECONCILE_QUEUED_BATCH)) {
      if (job.kind === ClipJobKind.IMPORT && job.startedAt === null) {
        orgs.add(job.organizationId);
        continue;
      }
      // Module 11: an export waiting for its turn is the render queue's, below.
      if (isQueuedRender(job) && job.startedAt === null) continue;
      const state = await this.scheduling.describeClipJob(job.id);
      if (state === 'unavailable') {
        reachable = false;
        break;
      }
      if (state === 'running') continue;
      if (state === 'closed' || state === 'timedOut') {
        if (await this.failJob(job, now, state === 'timedOut')) failed += 1;
        orgs.add(job.organizationId);
        continue;
      }
      // Never started: an IMPORT or an export queues again for its slot, the rest start now.
      if (job.kind === ClipJobKind.IMPORT || isQueuedRender(job)) {
        await this.repository.releaseClaim(job.organizationId, job.id);
        orgs.add(job.organizationId);
        continue;
      }
      if (await this.jobs.restart(job)) {
        started += 1;
      } else {
        reachable = false;
        break;
      }
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
        orgs.add(job.organizationId);
      }
    }

    if (reachable) {
      for (const orgId of orgs) {
        try {
          started += (await this.jobs.startWaiting(orgId)).length;
        } catch (error) {
          this.logger.warn(
            JSON.stringify({
              event: 'clips.reconcile.start_waiting_failed',
              orgId,
              reason: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      // Module 11: the fair render queue looks across every workspace at once.
      started += (await this.jobs.startRendersQuietly('reconcile')).length;
    }

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
