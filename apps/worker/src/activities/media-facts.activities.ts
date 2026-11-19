/**
 * The Media posters backfill (Sprint 12, Module 19), one step of the
 * maintenance pass on the publishing worker.
 *
 * Picks at most `MEDIA_VIDEO_FACTS_BATCH` videos in the library that have no
 * poster or no length and were never checked, newest first, and starts
 * `mediaVideoFactsWorkflow` for each on `postgear-media`. The work itself
 * (FFmpeg) happens on the media worker; this only asks for it.
 *
 * Idempotent by the workflow id: a row whose run is still going (just
 * uploaded, or picked by the last pass and waiting for a slot) answers
 * "already started" and is counted as running. Every run ends by setting
 * `factsCheckedAt`, even for a file it cannot read, so each pass moves on to
 * rows not yet seen until none are left. Never throws: a pass that cannot
 * reach Temporal is tried again in fifteen minutes.
 */
import { type Prisma, prisma } from '@postgear/db';
import {
  MEDIA_VIDEO_FACTS_BATCH,
  MEDIA_VIDEO_FACTS_TASK_QUEUE,
  MEDIA_VIDEO_FACTS_TIMEOUT_MS,
  MEDIA_VIDEO_FACTS_WORKFLOW,
  type MediaVideoFactsInput,
  mediaVideoFactsWorkflowId,
} from '@postgear/scheduling';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type { ActivityDeps } from './deps';

/** The `prisma.media` call the backfill makes. */
export type MediaBackfillDb = Pick<typeof prisma, 'media'>;

export interface MediaFactsBackfillReport {
  /** Rows the pass picked. */
  picked: number;
  /** Workflows this pass started. */
  started: number;
  /** Rows whose workflow was already running. */
  running: number;
  /** Starts that failed; the next pass picks the rows again. */
  failed: number;
}

/** A video in the library, still there, never checked, missing its poster or its length. */
export const MEDIA_FACTS_BACKFILL_WHERE = {
  type: 'video',
  deletedAt: null,
  factsCheckedAt: null,
  OR: [{ thumbnail: null }, { durationMs: null }],
} satisfies Prisma.MediaWhereInput;

export interface MediaFactsBackfillOptions {
  db?: MediaBackfillDb;
  log?: (message: string, meta: Record<string, unknown>) => void;
}

function defaultLog(message: string, meta: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event: 'media.video_facts.backfill', message, ...meta }));
}

export function createMediaFactsBackfillActivities(
  deps: Pick<ActivityDeps, 'temporalClient'>,
  options: MediaFactsBackfillOptions = {},
) {
  const db = options.db ?? prisma;
  const log = options.log ?? defaultLog;

  return {
    async mediaVideoFactsBackfill(): Promise<MediaFactsBackfillReport> {
      const rows = await db.media.findMany({
        where: MEDIA_FACTS_BACKFILL_WHERE,
        select: { id: true, organizationId: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: MEDIA_VIDEO_FACTS_BATCH,
      });
      const picked = rows.slice(0, MEDIA_VIDEO_FACTS_BATCH);
      const report: MediaFactsBackfillReport = {
        picked: picked.length,
        started: 0,
        running: 0,
        failed: 0,
      };
      if (picked.length === 0) return report;

      let client: Client;
      try {
        client = await deps.temporalClient();
      } catch (error) {
        log('the scheduler was unreachable; the next pass tries again', {
          rows: picked.length,
          error: error instanceof Error ? error.message : String(error),
        });
        report.failed = picked.length;
        return report;
      }

      for (const row of picked) {
        const args: MediaVideoFactsInput = { mediaId: row.id, organizationId: row.organizationId };
        try {
          await client.workflow.start(MEDIA_VIDEO_FACTS_WORKFLOW, {
            workflowId: mediaVideoFactsWorkflowId(row.id),
            taskQueue: MEDIA_VIDEO_FACTS_TASK_QUEUE,
            args: [args],
            workflowExecutionTimeout: MEDIA_VIDEO_FACTS_TIMEOUT_MS,
          });
          report.started += 1;
        } catch (error) {
          if (error instanceof WorkflowExecutionAlreadyStartedError) {
            report.running += 1;
            continue;
          }
          report.failed += 1;
          log('could not start one row; the next pass tries again', {
            mediaId: row.id,
            organizationId: row.organizationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return report;
    },
  };
}
