/**
 * Export All's one notice (Sprint 13, Module 11).
 *
 * The exports of a batch (`input.batchId`) ring no bell of their own: the
 * API's finish-export skips the clip's "Your clip is ready", and the worker
 * and the reconcile skip "Your clip could not be exported". When the
 * batch's last job ends (DONE, FAILED or CANCELLED), `settle` writes one
 * row instead:
 *
 * - some ready: `clip_export_ready`, "8 clips are ready." or "6 clips are
 *   ready, 2 could not be exported." (a cancelled export counts as not
 *   exported);
 * - none ready but some failed: `clip_export_failed`, "8 clips could not be
 *   exported.";
 * - every one cancelled: no notice (the person stopped it themselves).
 *
 * It counts only the batch's own jobs: a clip that was already exported and
 * current, or whose earlier export was still running, made no job here.
 *
 * **Exactly once.** The check (every job ended, no notice yet) and the
 * write happen in one serializable transaction, so two jobs ending at the
 * same moment cannot both write it: Postgres aborts one side, the retry
 * sees the other's row and stops. It is called from the worker's `settled`
 * call, from a cancel the API closes itself and from the reconcile (which
 * also sweeps recent batches, in case a `settled` call was lost). Every
 * caller is best effort: a failure here is logged and never fails theirs.
 * The row is pushed to open bell streams once the transaction committed.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type ClipJob, ClipJobKind, ClipJobStatus, prisma } from '@postgear/db';
import { CLIP_NOTIFICATION_TYPES } from '@postgear/scheduling';
import { type NotifyInput, NotificationsService } from '../../notifications/notifications.service';
import type { NotificationRecord } from '../../notifications/notifications.repository';
import { isUuid } from '../clips.ids';
import { serializable } from '../clips.tx';

/** The bell's title for a batch: a sentence, like the other Clips titles. */
export const BATCH_READY_TITLE = 'Your clips are ready';
export const BATCH_FAILED_TITLE = 'Your clips could not be exported';

/** How far back the reconcile's sweep looks for batches that ended without a notice. */
export const BATCH_SWEEP_WINDOW_MS = 6 * 60 * 60_000;
/** Batches looked at per sweep: keeps one reconcile pass short. */
export const BATCH_SWEEP_LIMIT = 50;

/** The batch id a job carries, or null (any job that is not an export of a batch). */
export function batchIdOf(job: Pick<ClipJob, 'kind'> & { input?: unknown }): string | null {
  if (job.kind !== ClipJobKind.RENDER) return null;
  const input = job.input;
  if (!input || typeof input !== 'object') return null;
  const value = (input as { batchId?: unknown }).batchId;
  return isUuid(value) ? value : null;
}

function clips(count: number): string {
  return count === 1 ? '1 clip' : `${count} clips`;
}

/**
 * The line under the title: "8 clips are ready.", "6 clips are ready, 2
 * could not be exported." or "8 clips could not be exported.".
 */
export function batchNoticeLine(ready: number, notExported: number): string {
  if (ready === 0) return `${clips(notExported)} could not be exported.`;
  const head = `${clips(ready)} ${ready === 1 ? 'is' : 'are'} ready`;
  return notExported === 0 ? `${head}.` : `${head}, ${notExported} could not be exported.`;
}

/** The Clips tab: where a batch notice leads (each clip has its own row there). */
export function clipsTabPath(orgId: string): string {
  return `/${orgId}/clips?tab=clips`;
}

/** The row, or null when no notice is due (every export was cancelled). */
export function batchNotice(
  orgId: string,
  batchId: string,
  counts: { done: number; failed: number; cancelled: number },
): NotifyInput | null {
  const notExported = counts.failed + counts.cancelled;
  if (counts.done === 0 && counts.failed === 0) return null;
  const ready = counts.done > 0;
  return {
    organizationId: orgId,
    type: ready ? CLIP_NOTIFICATION_TYPES.exportReady : CLIP_NOTIFICATION_TYPES.exportFailed,
    title: ready ? BATCH_READY_TITLE : BATCH_FAILED_TITLE,
    content: batchNoticeLine(counts.done, notExported),
    link: clipsTabPath(orgId),
    meta: { batchId, done: counts.done, failed: notExported },
    email: false,
  };
}

const BATCH_NOTICE_TYPES = [
  CLIP_NOTIFICATION_TYPES.exportReady,
  CLIP_NOTIFICATION_TYPES.exportFailed,
];

@Injectable()
export class ClipBatchNoticeService {
  private readonly logger = new Logger(ClipBatchNoticeService.name);

  constructor(private readonly notifications: NotificationsService) {}

  /** The batch notice for a job that just ended, when it belongs to a batch. Never throws. */
  async settleJob(
    job: Pick<ClipJob, 'kind' | 'organizationId'> & { input?: unknown },
  ): Promise<boolean> {
    const batchId = batchIdOf(job);
    if (!batchId) return false;
    return this.settle(job.organizationId, batchId);
  }

  /**
   * Writes the batch's notice when every one of its jobs has ended and none
   * was written yet. True when this call wrote it. Never throws.
   */
  async settle(orgId: string, batchId: string): Promise<boolean> {
    let row: NotificationRecord | null = null;
    try {
      row = await serializable(async (tx) => {
        const jobs = await tx.clipJob.findMany({
          where: {
            organizationId: orgId,
            kind: ClipJobKind.RENDER,
            input: { path: ['batchId'], equals: batchId },
          },
          select: { status: true },
        });
        if (jobs.length === 0) return null;
        if (jobs.some((job) => !ENDED.has(job.status))) return null;

        const sent = await tx.notifications.findFirst({
          where: {
            organizationId: orgId,
            type: { in: BATCH_NOTICE_TYPES },
            meta: { path: ['batchId'], equals: batchId },
          },
          select: { id: true },
        });
        if (sent) return null;

        const notice = batchNotice(orgId, batchId, {
          done: jobs.filter((job) => job.status === ClipJobStatus.DONE).length,
          failed: jobs.filter((job) => job.status === ClipJobStatus.FAILED).length,
          cancelled: jobs.filter((job) => job.status === ClipJobStatus.CANCELLED).length,
        });
        return notice ? this.notifications.write(notice, tx) : null;
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.batch.notice_failed',
          batchId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
    if (!row) return false;
    this.notifications.announce(row);
    this.logger.log(JSON.stringify({ event: 'clips.batch.noticed', batchId }));
    return true;
  }

  /**
   * The reconcile's mend: batches with an export that ended in the last few
   * hours, settled again (a no-op for a batch already noticed or still
   * running). Answers how many notices this pass wrote.
   */
  async sweep(now: Date): Promise<number> {
    const since = new Date(now.getTime() - BATCH_SWEEP_WINDOW_MS);
    const rows = await prisma.$queryRaw<Array<{ organizationId: string; batchId: string }>>`
      SELECT j."organizationId", j.input->>'batchId' AS "batchId"
      FROM "ClipJob" j
      WHERE j.kind = 'RENDER'
        AND j.status IN ('DONE', 'FAILED', 'CANCELLED')
        AND j."finishedAt" >= ${since}
        AND j.input->>'batchId' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "Notifications" n
          WHERE n."organizationId" = j."organizationId"
            AND n.meta->>'batchId' = j.input->>'batchId'
        )
      GROUP BY j."organizationId", j.input->>'batchId'
      -- A batch where every export was cancelled gets no notice: never sweep it again.
      HAVING bool_or(j.status <> 'CANCELLED')
      ORDER BY max(j."finishedAt") DESC
      LIMIT ${BATCH_SWEEP_LIMIT}
    `;
    let written = 0;
    for (const row of rows) {
      if (!isUuid(row.batchId)) continue;
      if (await this.settle(row.organizationId, row.batchId)) written += 1;
    }
    return written;
  }
}

const ENDED = new Set<ClipJob['status']>([
  ClipJobStatus.DONE,
  ClipJobStatus.FAILED,
  ClipJobStatus.CANCELLED,
]);
