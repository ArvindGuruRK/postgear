/**
 * Keeping and removing videos (Sprint 12, Module 19 section 1).
 *
 * - **`touchVideo`**: a video was used (its page opened, a clip made from it,
 *   one of its clips opened in the editor or exported). Moves `lastUsedAt` and
 *   `expiresAt` forward, at most once a day per video, with the plan's
 *   `clips.retention_days` read through the resolver. A new date clears the
 *   notice, so the next expiry gets its own.
 * - **`removeVideo`**: the one way a video goes, for every reason (a person's
 *   delete, the sweep's expiry, an operator's rights request). Its open jobs
 *   are stopped, then in one transaction: the row is marked (`deletedAt`,
 *   `removedReason`, and `status: REMOVED` for expiry and rights requests),
 *   its asset rows go, its clips never exported go, and its exported clips
 *   are kept but marked `removedAt` (their Media rows are not touched). The
 *   row stays: it holds the rights record. Then its private files go. A
 *   removal never gives import minutes back.
 * - **Montages** (Sprint 13, Module 11): a montage is a clip of EVERY video
 *   it plays (`videoId` and `meta.videoIds`), so removing any of them
 *   deletes the montage when it was never exported and marks it `removedAt`
 *   when it was (its Media file stays), and stops its open jobs, exactly as
 *   for the video's own clips (`clipsPlayingVideo`).
 * - **Files outside the prefix** (Sprint 13, Module 15): every row the
 *   removal deletes takes its file, wherever it lives (a Preview Export of
 *   one of its clips sits under `proofs/<jobId>/`), and the video's emotes
 *   (`exports/<jobId>/`, which no row points at) go too. What AI made from
 *   the video (transcripts with their word fixes, face files, stills, motion
 *   and heard files) are rows or job files under its prefix.
 *
 * A person's delete keeps `status` as it was, so an import that failed and
 * was deleted still reads as such in the rights record; every list already
 * hides a row with `deletedAt`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClipJobKind, ClipOrigin, ClipVideoStatus, type Prisma, prisma } from '@postgear/db';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { clipsPlayingVideo } from '../montages/montage-videos';
import { expiryFrom, needsTouch, nextExpiry, retentionDaysOf } from './clip-retention.rules';

/** Why a video went: stored in `ClipVideo.removedReason`. */
export type RemoveReason = 'deleted' | 'expired' | 'rights_request';

export interface RemovedVideo {
  id: string;
  organizationId: string;
  title: string;
  platform: string;
  externalId: string | null;
  createdById: string | null;
}

@Injectable()
export class ClipRetentionService {
  private readonly logger = new Logger(ClipRetentionService.name);

  constructor(
    private readonly resolver: EntitlementResolver,
    private readonly jobs: ClipJobsService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

  /** The plan's days, through the resolver (never a constant). */
  async retentionDays(orgId: string): Promise<number> {
    return retentionDaysOf(await this.resolver.get(orgId, 'clips.retention_days'));
  }

  /**
   * Marks a live, READY video used. At most one write a day; never throws
   * (a read that fails to touch is still a good read). True when it wrote.
   */
  async touchVideo(orgId: string, videoId: string, now = new Date()): Promise<boolean> {
    try {
      const video = await prisma.clipVideo.findFirst({
        where: {
          id: videoId,
          organizationId: orgId,
          deletedAt: null,
          status: ClipVideoStatus.READY,
        },
        select: { id: true, lastUsedAt: true, expiresAt: true },
      });
      if (!video || !needsTouch(video, now)) return false;

      const wanted = expiryFrom(now, await this.retentionDays(orgId));
      const expiresAt = nextExpiry(video.expiresAt, wanted, now);
      // Conditional on the row still being what was read: two tabs at once write once.
      const changed = await prisma.clipVideo.updateMany({
        where: {
          id: video.id,
          organizationId: orgId,
          deletedAt: null,
          lastUsedAt: video.lastUsedAt,
        },
        data: {
          lastUsedAt: now,
          expiresAt,
          ...(expiresAt.getTime() !== video.expiresAt?.getTime() ? { expiryNoticeAt: null } : {}),
        },
      });
      return changed.count > 0;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.retention.touch_failed',
          videoId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  /**
   * Removes a video for `reason`. Null when there was nothing live to remove
   * (already gone, or another workspace's). Safe to call twice.
   */
  async removeVideo(
    orgId: string,
    videoId: string,
    reason: RemoveReason,
    now = new Date(),
  ): Promise<RemovedVideo | null> {
    const video = await prisma.clipVideo.findFirst({
      where: { id: videoId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        title: true,
        platform: true,
        externalId: true,
        createdById: true,
      },
    });
    if (!video) return null;

    await this.stopOpenJobs(orgId, videoId);

    const removed = await prisma.$transaction(async (tx) => {
      const marked = await tx.clipVideo.updateMany({
        where: { id: videoId, organizationId: orgId, deletedAt: null },
        data: {
          deletedAt: now,
          removedReason: reason,
          ...(reason === 'deleted' ? {} : { status: ClipVideoStatus.REMOVED }),
        } satisfies Prisma.ClipVideoUpdateManyMutationInput,
      });
      if (marked.count === 0) return null;
      // Module 15: a row of the video whose file sits outside its prefix (a Preview
      // Export of one of its clips, under `proofs/<jobId>/`) takes that file with it.
      const elsewhere = await tx.clipAsset.findMany({
        where: {
          organizationId: orgId,
          videoId,
          NOT: { key: { startsWith: clipKeys.videoPrefix(orgId, videoId) } },
        },
        select: { key: true },
      });
      await tx.clipAsset.deleteMany({ where: { organizationId: orgId, videoId } });
      const ofVideo = clipsPlayingVideo(orgId, videoId);
      // Module 11: a montage that goes takes the files of its own it holds on its OTHER
      // videos (a translation of their captions), which the prefix below does not reach.
      // Left behind, their rows would fall to `clipId: null` and pass for a video's own.
      const goingMontages = await tx.clip.findMany({
        where: { ...ofVideo, origin: ClipOrigin.MONTAGE, lastExportedRevision: null },
        select: { id: true },
      });
      const montageFiles =
        goingMontages.length > 0
          ? await tx.clipAsset.findMany({
              where: {
                organizationId: orgId,
                clipId: { in: goingMontages.map((clip) => clip.id) },
              },
              select: { id: true, key: true },
            })
          : [];
      if (montageFiles.length > 0) {
        await tx.clipAsset.deleteMany({
          where: { organizationId: orgId, id: { in: montageFiles.map((file) => file.id) } },
        });
      }
      await tx.clip.deleteMany({ where: { ...ofVideo, lastExportedRevision: null } });
      await tx.clip.updateMany({
        where: { ...ofVideo, removedAt: null },
        data: { removedAt: now },
      });
      return { fileKeys: [...elsewhere, ...montageFiles].map((file) => file.key) };
    });
    if (!removed) return null;

    await this.deleteFiles(orgId, videoId);
    for (const key of removed.fileKeys) await this.deleteFile(key);
    await this.deleteEmotes(orgId, videoId);
    this.logger.log(JSON.stringify({ event: 'clips.video.removed', videoId, reason }));
    return video;
  }

  /**
   * Module 14 and 15: the video's emotes (`exports/<jobId>/`, kept 24 hours
   * and pointed at by no row) go with it, whatever their job's status. The
   * read route answers them without addresses once the video is gone.
   */
  private async deleteEmotes(orgId: string, videoId: string): Promise<void> {
    const emotes = await prisma.clipJob.findMany({
      where: { organizationId: orgId, videoId, kind: ClipJobKind.EMOTE },
      select: { id: true },
    });
    for (const job of emotes) {
      try {
        await this.storage.deletePrefix(clipKeys.exportPrefix(orgId, job.id));
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.video.emote_files_left',
            jobId: job.id,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  /**
   * Stops every open job of the video and of its clips, montages that play
   * it included (imports, sharp ranges, exports, Find Clips). A job that
   * already ended or a Temporal that is away is logged: its workflow then
   * finds the video gone.
   */
  private async stopOpenJobs(orgId: string, videoId: string): Promise<void> {
    const clipIds = (
      await prisma.clip.findMany({
        where: clipsPlayingVideo(orgId, videoId),
        select: { id: true },
      })
    ).map((clip) => clip.id);
    const open = await prisma.clipJob.findMany({
      where: {
        organizationId: orgId,
        status: { in: [...OPEN_JOB_STATUSES] },
        OR: [{ videoId }, ...(clipIds.length > 0 ? [{ clipId: { in: clipIds } }] : [])],
      },
      select: { id: true },
    });
    for (const job of open) {
      try {
        await this.jobs.cancel(orgId, job.id);
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'clips.video.remove_cancel_skipped',
            jobId: job.id,
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
      }
    }
  }

  /** One file, best effort, as `deleteFiles`. */
  private async deleteFile(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.video.file_left',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  /** Best-effort: a storage hiccup is logged and left to the orphan sweep. */
  async deleteFiles(orgId: string, videoId: string): Promise<void> {
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
