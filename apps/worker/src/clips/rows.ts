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
import { ClipAssetKind, ClipJobStatus, ClipVideoStatus, Prisma, prisma } from '@postgear/db';
import type { ClipJobKindName } from '@postgear/scheduling';
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
  videoId: string;
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
