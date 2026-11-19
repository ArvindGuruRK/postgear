/**
 * Every database read and write the clip activities make, behind one
 * interface so the steps can be tested with an in-memory fake.
 *
 * Rules every method keeps:
 * - Scoped by `organizationId` as well as the id, always.
 * - A job is closed only while it is still open (QUEUED or RUNNING), so a
 *   late writer never overwrites a cancel or a finish that landed first; the
 *   rows a close implies (the video, the assets, the notification) are
 *   written in the same transaction, and only when the close happened, so a
 *   retried activity never writes a second notification.
 * - Stored errors are `{ code, message }` with our sentence.
 */
import {
  ClipAssetKind,
  ClipJobKind,
  ClipJobStatus,
  ClipOrigin,
  ClipStatus,
  ClipVideoStatus,
  Prisma,
  prisma,
} from '@postgear/db';
import type { ClipJobKindName } from '@postgear/scheduling';
import { storedRange, withoutKept } from './highlights/kept';
import type { ClipNotificationRow } from './notifications';

const OPEN: ClipJobStatus[] = [ClipJobStatus.QUEUED, ClipJobStatus.RUNNING];

export type AssetKindName = keyof typeof ClipAssetKind;

export interface JobRow {
  id: string;
  organizationId: string;
  kind: ClipJobKindName;
  status: keyof typeof ClipJobStatus;
  input: unknown;
  videoId: string | null;
  clipId: string | null;
  createdAt: Date;
}

export interface VideoRow {
  id: string;
  organizationId: string;
  title: string;
  durationMs: number | null;
  fps: number | null;
  hasAudio: boolean;
  status: keyof typeof ClipVideoStatus;
  deletedAt: Date | null;
}

export interface ClipRow {
  id: string;
  title: string;
  videoId: string;
}

export interface AssetRow {
  id: string;
  kind: AssetKindName;
  key: string;
  bytes: number;
  videoId: string | null;
  clipId: string | null;
  meta: unknown;
  createdAt: Date;
}

export interface NewAsset {
  id?: string;
  /** Null only for a prepared download (Module 18), which belongs to no video. */
  videoId: string | null;
  clipId?: string | null;
  kind: AssetKindName;
  key: string;
  bytes: number;
  mimeType: string;
  meta: Record<string, unknown>;
}

export interface VideoFacts {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export interface StoredError {
  code: string;
  message: string;
}

export interface FinishImportArgs {
  jobId: string;
  organizationId: string;
  videoId: string;
  assets: NewAsset[];
  output: Record<string, unknown>;
  expiresAt: Date;
  notification: ClipNotificationRow;
  now: Date;
}

export interface FinishSegmentArgs {
  jobId: string;
  organizationId: string;
  videoId: string;
  /** Null when the platform copy is gone. */
  asset: NewAsset | null;
  output: Record<string, unknown>;
  now: Date;
}

/** Module 16: a highlights run, as its job reads it. */
export interface HighlightRunRow {
  id: string;
  organizationId: string;
  videoId: string;
  status: keyof typeof ClipJobStatus;
  createdById: string | null;
}

/** Where a video came from, for the chat step (Module 16). */
export interface VideoLinkRow {
  platform: 'youtube' | 'twitch' | 'kick' | 'upload';
  kind: 'video' | 'past_stream' | 'clip' | 'short' | 'upload';
  externalId: string | null;
  /** The light copy's size, for a new clip's framing; null before the import read it. */
  width: number | null;
  height: number | null;
}

/** One clip a highlights run makes (Module 16). */
export interface NewHighlightClip {
  id: string;
  title: string;
  /** The part of the video it plays, to leave out a pick a kept clip already covers. */
  range: { fromMs: number; toMs: number };
  document: Record<string, unknown>;
  ratio: string;
  durationMs: number;
  score: number;
  reasons: string[];
}

export interface FinishHighlightsArgs {
  jobId: string;
  organizationId: string;
  videoId: string;
  runId: string;
  /** Best first; inserted in this order. */
  clips: NewHighlightClip[];
  /** The tracks the scorer used. */
  tracks: string[];
  /** The video's new SIGNALS file, replacing the old one; null when no track was measured. */
  signals: NewAsset | null;
  output: Record<string, unknown>;
  createdById: string | null;
  now: Date;
}

export interface FinishHighlightsResult {
  /** False when the job was closed meanwhile: nothing was written. */
  finished: boolean;
  /** The storage keys of the SIGNALS files this one replaced (to delete after). */
  replacedKeys: string[];
  /** Unopened AI clips of older runs that were taken out. */
  replaced: number;
  /** Picks left out because an AI clip somebody kept already covers them. */
  covered: number;
}

/** Module 18: a prepared download, its job DONE and its DOWNLOAD asset row in one go. */
export interface FinishDownloadArgs {
  jobId: string;
  organizationId: string;
  asset: NewAsset;
  output: Record<string, unknown>;
  /** 24 hours from now: when the file goes. */
  expiresAt: Date;
  now: Date;
}

/** Module 18: a download as Save To Media reads it. */
export interface DownloadRow {
  id: string;
  organizationId: string;
  status: keyof typeof ClipJobStatus;
  output: unknown;
  createdAt: Date;
}

export interface CloseJobArgs {
  jobId: string;
  organizationId: string;
  status: 'FAILED' | 'CANCELLED';
  error: StoredError;
  /** What happens to the job's video (imports only). */
  video?: {
    id: string;
    /** `failed`: FAILED with the error. `removed`: soft deleted, its asset rows dropped. */
    mark: 'failed' | 'removed';
  };
  notification?: ClipNotificationRow;
  /** Module 16: the job's highlights run takes the same end, in the same transaction. */
  highlightRunId?: string | null;
  now: Date;
}

export interface ClipRows {
  job(organizationId: string, jobId: string): Promise<JobRow | null>;
  video(organizationId: string, videoId: string): Promise<VideoRow | null>;
  /** A clip's name and video, for its bell row. Null when it is gone. */
  clip(organizationId: string, clipId: string): Promise<ClipRow | null>;
  writeVideoFacts(organizationId: string, videoId: string, facts: VideoFacts): Promise<void>;
  /** Every asset row of a video, any kind. */
  videoAssets(organizationId: string, videoId: string): Promise<AssetRow[]>;
  /** SEGMENT assets made for a clip. */
  segmentAssets(organizationId: string, clipId: string): Promise<AssetRow[]>;
  deleteAssets(organizationId: string, ids: string[]): Promise<void>;
  /** The storage gauge: `SUM(ClipAsset.bytes)` over the workspace's live videos and clips. */
  storageUsedBytes(organizationId: string): Promise<number>;
  /** QUEUED or RUNNING jobs of this kind for a clip. */
  openClipJobs(organizationId: string, clipId: string, kind: ClipJobKindName): Promise<number>;
  /** True when a live Media row of the workspace points at this public key. */
  mediaUsesKey(organizationId: string, key: string): Promise<boolean>;
  /** Job DONE, the assets written, the video READY, the notification: one transaction. False when the job or video was closed meanwhile. */
  finishImport(args: FinishImportArgs): Promise<boolean>;
  /** Job DONE and the SEGMENT asset (or `hdAvailable = false`): one transaction. */
  finishSegment(args: FinishSegmentArgs): Promise<boolean>;
  /** Job FAILED or CANCELLED and what goes with it. False when it was already closed. */
  closeJob(args: CloseJobArgs): Promise<boolean>;
  /** Module 18: job DONE with its output and `expiresAt`, and the DOWNLOAD asset row. False when it was closed meanwhile. */
  finishDownload(args: FinishDownloadArgs): Promise<boolean>;
  /** Module 18: a DOWNLOAD job of the workspace, with its output. */
  downloadRow(organizationId: string, jobId: string): Promise<DownloadRow | null>;
  /** Module 18: Save To Media did not finish; `output.media` reads `failed` (only while it read `saving`). */
  markSaveFailed(organizationId: string, jobId: string): Promise<void>;
  /**
   * A Preview Export's file (Module 15): one PROOF row, its `meta.expiresAt`
   * 24 hours ahead for the sweep. Keyed by the storage key, so a retried job
   * updates its row instead of failing on the unique key.
   */
  recordProof(organizationId: string, asset: NewAsset): Promise<void>;
  /** Module 16: a highlights run of the workspace. */
  highlightRun(organizationId: string, runId: string): Promise<HighlightRunRow | null>;
  /** Module 16: QUEUED to RUNNING (only while open). */
  markRunRunning(organizationId: string, runId: string): Promise<void>;
  /** Module 16: the video's platform, kind and id on it, for the chat step. */
  videoLink(organizationId: string, videoId: string): Promise<VideoLinkRow | null>;
  /**
   * Module 16, one transaction: the job DONE, the run DONE with what it found,
   * this video's unopened AI clips from older runs taken out (status NEW,
   * never exported, never sent), the new clips in, and the SIGNALS file row
   * replaced. Nothing is written when the job was closed meanwhile.
   */
  finishHighlights(args: FinishHighlightsArgs): Promise<FinishHighlightsResult>;
}

/** Unopened AI clips: what a new run may replace (Module 16 section 4). */
export function replaceableAiClips(organizationId: string, videoId: string): Prisma.ClipWhereInput {
  return {
    organizationId,
    videoId,
    origin: ClipOrigin.AI_SIGNALS,
    status: ClipStatus.NEW,
    lastExportedRevision: null,
    posts: { none: {} },
  };
}

/** Thrown inside a transaction to roll it back when a conditional write found nothing. */
class RowClosed extends Error {}

export const prismaClipRows: ClipRows = {
  async job(organizationId, jobId) {
    const row = await prisma.clipJob.findFirst({
      where: { id: jobId, organizationId },
      select: {
        id: true,
        organizationId: true,
        kind: true,
        status: true,
        input: true,
        videoId: true,
        clipId: true,
        createdAt: true,
      },
    });
    return row;
  },

  async video(organizationId, videoId) {
    return prisma.clipVideo.findFirst({
      where: { id: videoId, organizationId },
      select: {
        id: true,
        organizationId: true,
        title: true,
        durationMs: true,
        fps: true,
        hasAudio: true,
        status: true,
        deletedAt: true,
      },
    });
  },

  async clip(organizationId, clipId) {
    return prisma.clip.findFirst({
      where: { id: clipId, organizationId },
      select: { id: true, title: true, videoId: true },
    });
  },

  async writeVideoFacts(organizationId, videoId, facts) {
    await prisma.clipVideo.updateMany({
      where: { id: videoId, organizationId, deletedAt: null },
      data: {
        durationMs: facts.durationMs,
        width: facts.width,
        height: facts.height,
        fps: facts.fps,
        hasAudio: facts.hasAudio,
      },
    });
  },

  async videoAssets(organizationId, videoId) {
    const rows = await prisma.clipAsset.findMany({
      where: { organizationId, videoId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toAssetRow);
  },

  async segmentAssets(organizationId, clipId) {
    const rows = await prisma.clipAsset.findMany({
      where: { organizationId, clipId, kind: ClipAssetKind.SEGMENT },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toAssetRow);
  },

  async deleteAssets(organizationId, ids) {
    if (ids.length === 0) return;
    await prisma.clipAsset.deleteMany({ where: { organizationId, id: { in: ids } } });
  },

  async storageUsedBytes(organizationId) {
    const sum = await prisma.clipAsset.aggregate({
      where: {
        organizationId,
        // Preview Export files (gone within 24 hours) never count (Module 15).
        kind: { not: 'PROOF' },
        OR: [{ videoId: null }, { video: { deletedAt: null } }],
      },
      _sum: { bytes: true },
    });
    return Number(sum._sum.bytes ?? 0n);
  },

  async openClipJobs(organizationId, clipId, kind) {
    return prisma.clipJob.count({
      where: { organizationId, clipId, kind, status: { in: OPEN } },
    });
  },

  async mediaUsesKey(organizationId, key) {
    const found = await prisma.media.findFirst({
      where: { organizationId, deletedAt: null, OR: [{ path: key }, { thumbnail: key }] },
      select: { id: true },
    });
    return found !== null;
  },

  async finishImport(args) {
    try {
      await prisma.$transaction(async (tx) => {
        const job = await tx.clipJob.updateMany({
          where: { id: args.jobId, organizationId: args.organizationId, status: { in: OPEN } },
          data: {
            status: ClipJobStatus.DONE,
            progress: 100,
            finishedAt: args.now,
            output: args.output as Prisma.InputJsonValue,
            error: Prisma.DbNull,
          },
        });
        if (job.count === 0) throw new RowClosed();
        const video = await tx.clipVideo.updateMany({
          where: { id: args.videoId, organizationId: args.organizationId, deletedAt: null },
          data: {
            status: ClipVideoStatus.READY,
            error: Prisma.DbNull,
            expiresAt: args.expiresAt,
            lastUsedAt: args.now,
          },
        });
        if (video.count === 0) throw new RowClosed();
        await tx.clipAsset.createMany({
          data: args.assets.map((asset) => toAssetCreate(args.organizationId, asset)),
        });
        await tx.notifications.create({ data: notificationData(args.notification) });
      });
      return true;
    } catch (error) {
      if (error instanceof RowClosed) return false;
      throw error;
    }
  },

  async finishSegment(args) {
    try {
      await prisma.$transaction(async (tx) => {
        const job = await tx.clipJob.updateMany({
          where: { id: args.jobId, organizationId: args.organizationId, status: { in: OPEN } },
          data: {
            status: ClipJobStatus.DONE,
            progress: 100,
            finishedAt: args.now,
            output: args.output as Prisma.InputJsonValue,
          },
        });
        if (job.count === 0) throw new RowClosed();
        if (args.asset) {
          await tx.clipAsset.create({ data: toAssetCreate(args.organizationId, args.asset) });
        } else {
          await tx.clipVideo.updateMany({
            where: { id: args.videoId, organizationId: args.organizationId },
            data: { hdAvailable: false },
          });
        }
      });
      return true;
    } catch (error) {
      if (error instanceof RowClosed) return false;
      throw error;
    }
  },

  async closeJob(args) {
    try {
      await prisma.$transaction(async (tx) => {
        const job = await tx.clipJob.updateMany({
          where: { id: args.jobId, organizationId: args.organizationId, status: { in: OPEN } },
          data: {
            status: args.status,
            finishedAt: args.now,
            error: args.error as unknown as Prisma.InputJsonValue,
          },
        });
        if (job.count === 0) throw new RowClosed();
        if (args.highlightRunId) {
          await tx.clipHighlightRun.updateMany({
            where: {
              id: args.highlightRunId,
              organizationId: args.organizationId,
              status: { in: OPEN },
            },
            data: { status: args.status, finishedAt: args.now },
          });
        }
        if (args.video?.mark === 'failed') {
          await tx.clipVideo.updateMany({
            where: {
              id: args.video.id,
              organizationId: args.organizationId,
              status: ClipVideoStatus.IMPORTING,
              deletedAt: null,
            },
            data: {
              status: ClipVideoStatus.FAILED,
              error: args.error as unknown as Prisma.InputJsonValue,
            },
          });
        } else if (args.video?.mark === 'removed') {
          await tx.clipAsset.deleteMany({
            where: { organizationId: args.organizationId, videoId: args.video.id },
          });
          await tx.clipVideo.updateMany({
            where: { id: args.video.id, organizationId: args.organizationId, deletedAt: null },
            data: {
              status: ClipVideoStatus.REMOVED,
              removedReason: 'deleted',
              deletedAt: args.now,
            },
          });
        }
        if (args.notification) {
          await tx.notifications.create({ data: notificationData(args.notification) });
        }
      });
      return true;
    } catch (error) {
      if (error instanceof RowClosed) return false;
      throw error;
    }
  },

  async finishDownload(args) {
    try {
      await prisma.$transaction(async (tx) => {
        const job = await tx.clipJob.updateMany({
          where: {
            id: args.jobId,
            organizationId: args.organizationId,
            kind: ClipJobKind.DOWNLOAD,
            status: { in: OPEN },
          },
          data: {
            status: ClipJobStatus.DONE,
            progress: 100,
            finishedAt: args.now,
            expiresAt: args.expiresAt,
            output: args.output as Prisma.InputJsonValue,
          },
        });
        if (job.count === 0) throw new RowClosed();
        await tx.clipAsset.create({ data: toAssetCreate(args.organizationId, args.asset) });
      });
      return true;
    } catch (error) {
      if (error instanceof RowClosed) return false;
      throw error;
    }
  },

  async downloadRow(organizationId, jobId) {
    return prisma.clipJob.findFirst({
      where: { id: jobId, organizationId, kind: ClipJobKind.DOWNLOAD },
      select: { id: true, organizationId: true, status: true, output: true, createdAt: true },
    });
  },

  async markSaveFailed(organizationId, jobId) {
    await prisma.$transaction(async (tx) => {
      const job = await tx.clipJob.findFirst({
        where: { id: jobId, organizationId, kind: ClipJobKind.DOWNLOAD },
        select: { id: true, output: true },
      });
      const output = job?.output;
      if (!job || !output || typeof output !== 'object' || Array.isArray(output)) return;
      const media = (output as { media?: { status?: unknown } }).media;
      if (media?.status !== 'saving') return;
      await tx.clipJob.update({
        where: { id: job.id },
        data: {
          output: {
            ...(output as Record<string, unknown>),
            media: { status: 'failed', mediaId: null },
          } as Prisma.InputJsonValue,
        },
      });
    });
  },

  async recordProof(organizationId, asset) {
    await prisma.clipAsset.upsert({
      where: { key: asset.key },
      create: toAssetCreate(organizationId, asset),
      update: { bytes: BigInt(asset.bytes), meta: asset.meta as Prisma.InputJsonValue },
    });
  },

  async highlightRun(organizationId, runId) {
    return prisma.clipHighlightRun.findFirst({
      where: { id: runId, organizationId },
      select: { id: true, organizationId: true, videoId: true, status: true, createdById: true },
    });
  },

  async markRunRunning(organizationId, runId) {
    await prisma.clipHighlightRun.updateMany({
      where: { id: runId, organizationId, status: { in: OPEN } },
      data: { status: ClipJobStatus.RUNNING },
    });
  },

  async videoLink(organizationId, videoId) {
    const row = await prisma.clipVideo.findFirst({
      where: { id: videoId, organizationId },
      select: { platform: true, kind: true, externalId: true, width: true, height: true },
    });
    if (!row) return null;
    return {
      platform: row.platform.toLowerCase() as VideoLinkRow['platform'],
      kind: row.kind.toLowerCase() as VideoLinkRow['kind'],
      externalId: row.externalId,
      width: row.width,
      height: row.height,
    };
  },

  async finishHighlights(args) {
    try {
      return await prisma.$transaction(async (tx) => {
        const job = await tx.clipJob.updateMany({
          where: { id: args.jobId, organizationId: args.organizationId, status: { in: OPEN } },
          data: {
            status: ClipJobStatus.DONE,
            progress: 100,
            finishedAt: args.now,
            output: args.output as Prisma.InputJsonValue,
            error: Prisma.DbNull,
          },
        });
        if (job.count === 0) throw new RowClosed();
        await tx.clipHighlightRun.updateMany({
          where: { id: args.runId, organizationId: args.organizationId },
          data: {
            status: ClipJobStatus.DONE,
            found: args.clips.length,
            tracks: args.tracks,
            finishedAt: args.now,
          },
        });

        const removed = await tx.clip.deleteMany({
          where: replaceableAiClips(args.organizationId, args.videoId),
        });
        // What is left of this video's AI clips is what somebody kept: no twins of those.
        const kept = await tx.clip.findMany({
          where: {
            organizationId: args.organizationId,
            videoId: args.videoId,
            origin: ClipOrigin.AI_SIGNALS,
          },
          select: { document: true },
        });
        const fresh = withoutKept(
          args.clips,
          kept.map((clip) => storedRange(clip.document)),
        );
        if (fresh.length > 0) {
          await tx.clip.createMany({
            data: fresh.map((clip, index) => ({
              id: clip.id,
              organizationId: args.organizationId,
              videoId: args.videoId,
              title: clip.title,
              status: ClipStatus.NEW,
              origin: ClipOrigin.AI_SIGNALS,
              score: clip.score,
              reasons: clip.reasons,
              highlightRunId: args.runId,
              document: clip.document as Prisma.InputJsonValue,
              revision: 1,
              ratio: clip.ratio,
              durationMs: clip.durationMs,
              createdById: args.createdById,
              // A millisecond apart, best first, so a newest-first list keeps the run's order.
              createdAt: new Date(args.now.getTime() - index),
            })),
          });
        }

        let replacedKeys: string[] = [];
        if (args.signals) {
          const old = await tx.clipAsset.findMany({
            where: {
              organizationId: args.organizationId,
              videoId: args.videoId,
              kind: ClipAssetKind.SIGNALS,
              key: { not: args.signals.key },
            },
            select: { id: true, key: true },
          });
          if (old.length > 0) {
            await tx.clipAsset.deleteMany({
              where: { organizationId: args.organizationId, id: { in: old.map((row) => row.id) } },
            });
          }
          await tx.clipAsset.create({ data: toAssetCreate(args.organizationId, args.signals) });
          replacedKeys = old.map((row) => row.key);
        }
        await tx.clipVideo.updateMany({
          where: { id: args.videoId, organizationId: args.organizationId, deletedAt: null },
          data: { lastUsedAt: args.now },
        });
        return {
          finished: true,
          replacedKeys,
          replaced: removed.count,
          covered: args.clips.length - fresh.length,
        };
      });
    } catch (error) {
      if (error instanceof RowClosed)
        return { finished: false, replacedKeys: [], replaced: 0, covered: 0 };
      throw error;
    }
  },
};

function toAssetRow(row: {
  id: string;
  kind: ClipAssetKind;
  key: string;
  bytes: bigint;
  videoId: string | null;
  clipId: string | null;
  meta: Prisma.JsonValue;
  createdAt: Date;
}): AssetRow {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    bytes: Number(row.bytes),
    videoId: row.videoId,
    clipId: row.clipId,
    meta: row.meta,
    createdAt: row.createdAt,
  };
}

function toAssetCreate(organizationId: string, asset: NewAsset): Prisma.ClipAssetCreateManyInput {
  return {
    ...(asset.id ? { id: asset.id } : {}),
    organizationId,
    videoId: asset.videoId,
    clipId: asset.clipId ?? null,
    kind: asset.kind,
    key: asset.key,
    bytes: BigInt(asset.bytes),
    mimeType: asset.mimeType,
    meta: asset.meta as Prisma.InputJsonValue,
  };
}

function notificationData(row: ClipNotificationRow): Prisma.NotificationsUncheckedCreateInput {
  return {
    organizationId: row.organizationId,
    type: row.type,
    title: row.title,
    content: row.content,
    link: row.link,
    meta: row.meta,
  };
}
