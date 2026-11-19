/**
 * DOWNLOAD job rows and their files' asset rows (Sprint 12, Module 18).
 * Every query names the workspace and the kind: a job id from the URL is
 * never enough on its own, and a RENDER or IMPORT id never reads as a
 * download.
 *
 * Writes that depend on the row's current state (Save To Media's start, a
 * delete) are conditional or run in a serializable transaction, so two
 * clicks at once never both win.
 */
import { Injectable } from '@nestjs/common';
import {
  ClipAssetKind,
  type ClipJob,
  ClipJobKind,
  ClipJobStatus,
  ClipPlatform,
  type Prisma,
  prisma,
} from '@postgear/db';
import { clipKeys } from '@postgear/storage';
import {
  DOWNLOAD_REMOVED_STAGE,
  type DownloadMedia,
  downloadOutputSchema,
} from '@postgear/video-engine';
import { type ClipsTx, serializable } from '../clips.tx';
import { OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';

/** More than any plan's day of downloads, so the two days the tab shows always fit. */
const LIST_LIMIT = 200;

export type StartSavingOutcome =
  | { outcome: 'started'; job: ClipJob }
  | { outcome: 'already'; job: ClipJob }
  | { outcome: 'not_ready' };

export interface UploadOriginal {
  title: string;
  key: string;
}

@Injectable()
export class ClipDownloadsRepository {
  /**
   * The workspace's downloads made since `since`, newest first. Deleted rows
   * (kept as the rights record) and cancelled ones are left out. Inside `tx`
   * when it guards a create (the same file asked for twice).
   */
  list(orgId: string, since: Date, tx: ClipsTx = prisma): Promise<ClipJob[]> {
    return tx.clipJob.findMany({
      where: {
        organizationId: orgId,
        kind: ClipJobKind.DOWNLOAD,
        createdAt: { gte: since },
        status: { not: ClipJobStatus.CANCELLED },
        OR: [{ stage: null }, { stage: { not: DOWNLOAD_REMOVED_STAGE } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    });
  }

  /** One download of this workspace that has not been deleted. */
  find(orgId: string, jobId: string): Promise<ClipJob | null> {
    return prisma.clipJob.findFirst({
      where: {
        id: jobId,
        organizationId: orgId,
        kind: ClipJobKind.DOWNLOAD,
        OR: [{ stage: null }, { stage: { not: DOWNLOAD_REMOVED_STAGE } }],
      },
    });
  }

  /** Downloads still being prepared (the busy cap), inside `tx` when it guards a create. */
  countOpen(orgId: string, tx: ClipsTx = prisma): Promise<number> {
    return tx.clipJob.count({
      where: {
        organizationId: orgId,
        kind: ClipJobKind.DOWNLOAD,
        status: { in: [...OPEN_JOB_STATUSES] },
      },
    });
  }

  /**
   * Marks Save To Media as started on a finished download, unless it is
   * already saving or saved (answered as `already`, so a second click is
   * harmless). Serializable: two clicks at once start one copy.
   */
  startSaving(orgId: string, jobId: string): Promise<StartSavingOutcome> {
    return serializable(async (tx) => {
      const job = await tx.clipJob.findFirst({
        where: { id: jobId, organizationId: orgId, kind: ClipJobKind.DOWNLOAD },
      });
      if (!job || job.status !== ClipJobStatus.DONE) return { outcome: 'not_ready' as const };
      const output = downloadOutputSchema.safeParse(job.output);
      if (!output.success) return { outcome: 'not_ready' as const };
      const media = output.data.media;
      if (media && media.status !== 'failed') return { outcome: 'already' as const, job };

      const saving: DownloadMedia = { status: 'saving', mediaId: null };
      const updated = await tx.clipJob.update({
        where: { id: job.id },
        data: { output: { ...output.data, media: saving } as Prisma.InputJsonValue },
      });
      return { outcome: 'started' as const, job: updated };
    });
  }

  /** Save To Media could not be started: the button comes back. Only while still `saving`. */
  async saveNotStarted(orgId: string, jobId: string): Promise<void> {
    await serializable(async (tx) => {
      const job = await tx.clipJob.findFirst({
        where: { id: jobId, organizationId: orgId, kind: ClipJobKind.DOWNLOAD },
      });
      const output = downloadOutputSchema.safeParse(job?.output);
      if (!job || !output.success || output.data.media?.status !== 'saving') return;
      const failed: DownloadMedia = { status: 'failed', mediaId: null };
      await tx.clipJob.update({
        where: { id: job.id },
        data: { output: { ...output.data, media: failed } as Prisma.InputJsonValue },
      });
    });
  }

  /** Drops the asset row of a prepared file (the file itself goes through storage). */
  async removeFileRow(orgId: string, key: string): Promise<void> {
    await prisma.clipAsset.deleteMany({
      where: { organizationId: orgId, kind: ClipAssetKind.DOWNLOAD, key },
    });
  }

  /**
   * A finished, failed or expired download is deleted: its asset row goes
   * and the job row is marked removed (it stays as the rights record). Only
   * while it is not being prepared; true when this call changed it.
   */
  markRemoved(orgId: string, jobId: string, now: Date): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const changed = await tx.clipJob.updateMany({
        where: {
          id: jobId,
          organizationId: orgId,
          kind: ClipJobKind.DOWNLOAD,
          status: { notIn: [...OPEN_JOB_STATUSES] },
        },
        data: { stage: DOWNLOAD_REMOVED_STAGE, expiresAt: now },
      });
      if (changed.count === 0) return false;
      await tx.clipAsset.deleteMany({
        where: {
          organizationId: orgId,
          kind: ClipAssetKind.DOWNLOAD,
          key: { startsWith: clipKeys.downloadPrefix(orgId, jobId) },
        },
      });
      return true;
    });
  }

  /**
   * An uploaded video's original (Download Original): the live video of this
   * workspace, only when it came from an upload, with its ORIGINAL file.
   * `not_an_upload` for a link import; `missing` when the file row is gone.
   */
  async uploadOriginal(
    orgId: string,
    videoId: string,
  ): Promise<
    | { outcome: 'found'; original: UploadOriginal }
    | { outcome: 'not_found' | 'not_an_upload' | 'missing' }
  > {
    const video = await prisma.clipVideo.findFirst({
      where: { id: videoId, organizationId: orgId, deletedAt: null },
      select: { id: true, title: true, platform: true },
    });
    if (!video) return { outcome: 'not_found' };
    if (video.platform !== ClipPlatform.UPLOAD) return { outcome: 'not_an_upload' };
    const asset = await prisma.clipAsset.findFirst({
      where: { organizationId: orgId, videoId: video.id, kind: ClipAssetKind.ORIGINAL },
      orderBy: { createdAt: 'desc' },
      select: { key: true },
    });
    if (!asset) return { outcome: 'missing' };
    return { outcome: 'found', original: { title: video.title, key: asset.key } };
  }
}
