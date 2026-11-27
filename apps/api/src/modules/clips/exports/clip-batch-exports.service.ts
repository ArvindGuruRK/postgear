/**
 * Export All (Sprint 13, Module 11): many clips exported in one go.
 *
 * `POST /clips/exports` `{ clipIds (1..30), quality }` answers 202
 * `{ batchId, jobs: [{ clipId, jobId, quality, note }] }`:
 *
 * - **All or nothing on the clips.** Every id must be a live clip (not
 *   removed with its video) of this workspace, or the whole request is a 404
 *   `clip_not_found` and nothing is made. A clip the single export would
 *   refuse (its video not ready, a document that no longer reads, another
 *   video it plays gone) refuses the whole request the same way, so the
 *   dialog shows one sentence and nothing half started. The one exception
 *   is a montage whose videos include a removed one: it is skipped with the
 *   note `removed` (Module 11, with builder D), and the rest go ahead.
 * - **Each clip is frozen as the single export freezes it**
 *   (`freezeClipForExport`: the document, its revision and fingerprint, the
 *   plan's mark and queue priority, read once for the batch), into a RENDER
 *   job carrying the batch id (`input.batchId`). Notes per clip:
 *   - `queued`: a new export at the quality asked for;
 *   - `lowered`: the plan does not allow that quality, so it is exported at
 *     the best one it allows (`quality` is the one used). The single route
 *     keeps its 402 `clips_quality_requires_plan`; a plan that allows no
 *     quality at all refuses the batch with that 402;
 *   - `current`: already exported with this very document (the fingerprint
 *     of its last finished export) at this quality, so no job (`jobId` null);
 *   - `running`: an export of it is already QUEUED or RUNNING, so it is left
 *     alone (`jobId` is that job);
 *   - `removed`: a montage that plays a removed video ("One of the videos in
 *     this montage was removed."), skipped (`jobId` null); the list counts it
 *     with the ones that could not be exported.
 *   Decided in one serializable transaction, so a single export racing the
 *   batch can never make two open exports of one clip.
 * - **The fair queue starts them** (`ClipJobsService.startWaitingRenders`):
 *   one export of the workspace at a time, others' batches taking turns.
 *   One failure never stops the rest: each job is its own workflow.
 * - **One notice** when the batch's last job ends (`ClipBatchNoticeService`).
 *
 * `GET /clips/exports/batches/:batchId` is the list the dialog shows. The
 * batch's rows (with their notes, also the clips that made no job) are kept
 * in Redis for a week; without them (Redis flushed) the list is rebuilt from
 * the batch's own jobs, each noted `queued`. `GET /clips/exports/batches`
 * lists the person's batches still running (so the page's chip survives a
 * reload). Another workspace's batch is a 404, never a different answer.
 *
 * Logs carry ids and counts only, never a title or a document.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type ClipJob, ClipJobKind, ClipOrigin, prisma } from '@postgear/db';
import {
  allowedQualities,
  documentFingerprint,
  EXPORT_QUALITIES,
  type ExportQuality,
  qualityLockedSentence,
} from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { RedisService } from '../../redis/redis.service';
import {
  EXPORT_PLAN_KEYS,
  type FrozenClip,
  fingerprintOf,
  freezeClipForExport,
  priorityOf,
  qualityOf,
} from '../clip/clip-exports.service';
import { clipNotFound, exportFileName } from '../clip/clip-item.service';
import { proofIs } from '../clip/export-progress';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { serializable } from '../clips.tx';
import { type ClipJobView, TERMINAL_JOB_STATUSES, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { videosOfClip } from '../montages/montage-videos';
import { ClipRetentionService } from '../retention/clip-retention.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { CLIP_BATCH_MESSAGES } from './clip-batch-exports.messages';
import type { BatchExportInput } from './clip-batch-exports.schema';

export const BATCH_NOTES = ['queued', 'lowered', 'current', 'running', 'removed'] as const;
export type BatchNote = (typeof BATCH_NOTES)[number];

export interface BatchEntry {
  clipId: string;
  /** The batch's own job, the running export (`running`), or null (`current`). */
  jobId: string | null;
  quality: ExportQuality;
  note: BatchNote;
}

export interface BatchStartAnswer {
  batchId: string;
  jobs: BatchEntry[];
}

export interface BatchRowView extends BatchEntry {
  clipTitle: string;
  job: ClipJobView | null;
}

export interface BatchView {
  batchId: string;
  total: number;
  /** Rows finished well: an export DONE, or a clip already current. */
  done: number;
  /** Rows that ended without a file: FAILED or CANCELLED. */
  failed: number;
  /** True when no row is still waiting or running. */
  finished: boolean;
  jobs: BatchRowView[];
}

export interface BatchSummary {
  batchId: string;
  total: number;
  done: number;
  failed: number;
}

/** How long a batch's rows are kept for its list. */
export const BATCH_MANIFEST_TTL_SECONDS = 7 * 24 * 60 * 60;
/** The open batches `GET /clips/exports/batches` answers at most. */
export const OPEN_BATCHES_LIMIT = 10;

interface Manifest {
  userId: string;
  createdAt: string;
  entries: BatchEntry[];
}

export function manifestKey(orgId: string, batchId: string): string {
  return `clips:export-batch:${orgId}:${batchId}`;
}

export function batchNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIP_BATCH_MESSAGES.BATCH_NOT_FOUND,
    code: 'batch_not_found',
  });
}

/** The quality a batch exports at: the one asked for, else the best the plan allows. */
export function batchQuality(
  asked: ExportQuality,
  max: unknown,
): { quality: ExportQuality; lowered: boolean } | null {
  const allowed = allowedQualities(typeof max === 'string' ? max : null);
  if (allowed.length === 0) return null;
  if (allowed.includes(asked)) return { quality: asked, lowered: false };
  return { quality: allowed[allowed.length - 1] as ExportQuality, lowered: true };
}

@Injectable()
export class ClipBatchExportsService {
  private readonly logger = new Logger(ClipBatchExportsService.name);

  constructor(
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly videos: ClipVideosRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly resolver: EntitlementResolver,
    private readonly retention: ClipRetentionService,
    private readonly redis: RedisService,
  ) {}

  /** 202 `{ batchId, jobs }`. */
  async start(orgId: string, userId: string, body: BatchExportInput): Promise<BatchStartAnswer> {
    await this.limits.assertEnabled(orgId);
    const live = await prisma.clip.findMany({
      where: {
        id: { in: body.clipIds },
        organizationId: orgId,
        // A montage marked removed is still found, so it answers montage_video_removed below.
        OR: [{ removedAt: null }, { origin: ClipOrigin.MONTAGE }],
      },
      select: { id: true },
    });
    if (live.length !== body.clipIds.length) throw clipNotFound();

    const plan = await this.resolver.getMany(orgId, EXPORT_PLAN_KEYS);
    const chosen = batchQuality(body.quality, plan['clips.export_max_quality']);
    if (!chosen) {
      throw new EntitlementRefusedException(
        'clips_quality_requires_plan',
        qualityLockedSentence(body.quality),
      );
    }
    const { quality, lowered } = chosen;
    const priority = priorityOf(plan['clips.queue_priority']);
    const watermark = plan['clips.export_watermark'] === true;
    const batchId = randomUUID();

    const { entries, created, exported } = await serializable(async (tx) => {
      const entries: BatchEntry[] = [];
      const created: ClipJob[] = [];
      const exported: FrozenClip['clip'][] = [];
      for (const clipId of body.clipIds) {
        let frozen: FrozenClip;
        try {
          frozen = await freezeClipForExport(tx, this.videos, orgId, clipId, undefined);
        } catch (error) {
          // A montage that plays a removed video is skipped, not the whole batch.
          if (error instanceof ClipErrorException && error.clipCode === 'montage_video_removed') {
            entries.push({ clipId, jobId: null, quality, note: 'removed' });
            continue;
          }
          throw error;
        }
        const { clip, video, doc } = frozen;
        const open = await tx.clipJob.findFirst({
          where: {
            organizationId: orgId,
            clipId: clip.id,
            kind: ClipJobKind.RENDER,
            status: { in: [...OPEN_JOB_STATUSES] },
            input: proofIs(false),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (open) {
          entries.push({
            clipId: clip.id,
            jobId: open.id,
            quality: qualityOf(open),
            note: 'running',
          });
          continue;
        }

        const fingerprint = documentFingerprint(doc);
        const last = await tx.clipJob.findFirst({
          where: {
            organizationId: orgId,
            clipId: clip.id,
            kind: ClipJobKind.RENDER,
            status: 'DONE',
            input: proofIs(false),
          },
          orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        });
        if (last && fingerprintOf(last) === fingerprint && qualityOf(last) === quality) {
          entries.push({ clipId: clip.id, jobId: null, quality, note: 'current' });
          continue;
        }

        const row = await this.jobs.build({
          id: this.jobs.newJobId(),
          orgId,
          userId,
          kind: 'RENDER',
          videoId: video.id,
          clipId: clip.id,
          priority,
          input: {
            clipId: clip.id,
            videoId: video.id,
            revision: clip.revision,
            document: doc,
            quality,
            proof: false,
            watermark,
            name: exportFileName(clip.title),
            fingerprint,
            batchId,
          },
        });
        const job = await this.jobsRepository.create(row, tx);
        created.push(job);
        exported.push(clip);
        entries.push({
          clipId: clip.id,
          jobId: job.id,
          quality,
          note: lowered ? 'lowered' : 'queued',
        });
      }
      return { entries, created, exported };
    });

    // Module 19: an export counts as using the clip's video (a montage's: every one it plays).
    const used = new Set(exported.flatMap((clip) => videosOfClip(clip)));
    for (const videoId of used) await this.retention.touchVideo(orgId, videoId);
    await this.saveManifest(orgId, batchId, {
      userId,
      createdAt: new Date().toISOString(),
      entries,
    });
    if (created.length > 0) await this.jobs.startRendersQuietly(orgId);

    this.logger.log(
      JSON.stringify({
        event: 'clips.batch.started',
        batchId,
        clips: entries.length,
        jobs: created.length,
        lowered,
      }),
    );
    return { batchId, jobs: entries };
  }

  /** `{ batchId, total, done, failed, finished, jobs }`; 404 for an unknown or another workspace's batch. */
  async view(orgId: string, batchId: string): Promise<BatchView> {
    if (!isUuid(batchId)) throw batchNotFound();
    const manifest = await this.readManifest(orgId, batchId);
    const own = await prisma.clipJob.findMany({
      where: {
        organizationId: orgId,
        kind: ClipJobKind.RENDER,
        input: { path: ['batchId'], equals: batchId },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!manifest && own.length === 0) throw batchNotFound();

    const entries: BatchEntry[] =
      manifest?.entries ??
      own
        .filter((job) => job.clipId !== null)
        .map((job) => ({
          clipId: job.clipId as string,
          jobId: job.id,
          quality: qualityOf(job),
          note: 'queued' as const,
        }));

    const ownIds = new Set(own.map((job) => job.id));
    const otherIds = entries
      .map((entry) => entry.jobId)
      .filter((id): id is string => typeof id === 'string' && !ownIds.has(id));
    const others =
      otherIds.length > 0
        ? await prisma.clipJob.findMany({ where: { organizationId: orgId, id: { in: otherIds } } })
        : [];
    const jobsById = new Map([...own, ...others].map((job) => [job.id, job]));

    const clipIds = [...new Set(entries.map((entry) => entry.clipId))];
    const clips = await prisma.clip.findMany({
      where: { organizationId: orgId, id: { in: clipIds } },
      select: { id: true, title: true },
    });
    const titles = new Map(clips.map((clip) => [clip.id, clip.title]));

    let done = 0;
    let failed = 0;
    let finished = true;
    const rows = entries.map((entry): BatchRowView => {
      const job = entry.jobId ? (jobsById.get(entry.jobId) ?? null) : null;
      if (entry.note === 'current' || job?.status === 'DONE') done += 1;
      else if (entry.note === 'removed') failed += 1;
      else if (job && (job.status === 'FAILED' || job.status === 'CANCELLED')) failed += 1;
      if (job && !TERMINAL_JOB_STATUSES.has(job.status)) finished = false;
      return {
        ...entry,
        clipTitle: titles.get(entry.clipId) ?? '',
        job: job ? toJobView(job) : null,
      };
    });

    return { batchId, total: rows.length, done, failed, finished, jobs: rows };
  }

  /** The job ids a batch's live stream follows (the batch's own and any running one it noted). */
  async jobIdsOf(orgId: string, batchId: string): Promise<string[]> {
    const view = await this.view(orgId, batchId);
    return view.jobs.map((row) => row.jobId).filter((id): id is string => typeof id === 'string');
  }

  /** `{ batches }`: this person's batches with an export still waiting or running, newest first. */
  async open(orgId: string, userId: string): Promise<{ batches: BatchSummary[] }> {
    const rows = await prisma.$queryRaw<Array<{ batchId: string }>>`
      SELECT input->>'batchId' AS "batchId", MIN("createdAt") AS "createdAt"
      FROM "ClipJob"
      WHERE "organizationId" = ${orgId}
        AND "createdById" = ${userId}
        AND kind = 'RENDER'
        AND status IN ('QUEUED', 'RUNNING')
        AND input->>'batchId' IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT ${OPEN_BATCHES_LIMIT}
    `;
    const batches: BatchSummary[] = [];
    for (const row of rows) {
      if (!isUuid(row.batchId)) continue;
      try {
        const view = await this.view(orgId, row.batchId);
        batches.push({
          batchId: view.batchId,
          total: view.total,
          done: view.done,
          failed: view.failed,
        });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return { batches };
  }

  private async saveManifest(orgId: string, batchId: string, manifest: Manifest): Promise<void> {
    try {
      await this.redis.set(
        manifestKey(orgId, batchId),
        JSON.stringify(manifest),
        BATCH_MANIFEST_TTL_SECONDS,
      );
    } catch (error) {
      // The list falls back to the batch's own jobs; nothing else depends on it.
      this.logger.warn(
        JSON.stringify({
          event: 'clips.batch.manifest_not_saved',
          batchId,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }

  private async readManifest(orgId: string, batchId: string): Promise<Manifest | null> {
    let raw: string | null = null;
    try {
      raw = await this.redis.get(manifestKey(orgId, batchId));
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      return parseManifest(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}

/** A stored manifest, field by field; anything that does not read is ignored (null). */
export function parseManifest(value: unknown): Manifest | null {
  if (!value || typeof value !== 'object') return null;
  const { userId, createdAt, entries } = value as Record<string, unknown>;
  if (typeof userId !== 'string' || typeof createdAt !== 'string' || !Array.isArray(entries)) {
    return null;
  }
  const parsed: BatchEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return null;
    const { clipId, jobId, quality, note } = entry as Record<string, unknown>;
    if (!isUuid(clipId)) return null;
    if (jobId !== null && !isUuid(jobId)) return null;
    if (!(EXPORT_QUALITIES as readonly unknown[]).includes(quality)) return null;
    if (!(BATCH_NOTES as readonly unknown[]).includes(note)) return null;
    parsed.push({
      clipId,
      jobId: jobId as string | null,
      quality: quality as ExportQuality,
      note: note as BatchNote,
    });
  }
  return { userId, createdAt, entries: parsed };
}
