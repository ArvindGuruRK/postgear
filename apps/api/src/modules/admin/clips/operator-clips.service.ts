/**
 * Rights requests (Sprint 12, Module 19 section 5): an owner asked for their
 * video to be taken down, and an operator removes every copy.
 *
 * One removal:
 * 1. `ClipRetentionService.removeVideo(..., 'rights_request')`, the same path
 *    as a person's delete and the expiry sweep: open jobs stopped, files and
 *    unexported clips gone, exported clips kept in Media (marked), the row
 *    kept as `REMOVED` with its reason.
 * 2. For a video that came from a link, a `ClipBlockedVideo` row for its
 *    platform and id, so the probe refuses it for every workspace from now on
 *    ("This video was removed after a request from its owner.").
 * 3. A `clip_video_removed` notification to the workspace: the same sentence.
 * 4. The operator record: a security event and the owner mail.
 *
 * The video is found by its id alone (any workspace): operator routes never
 * read the org cookie. `removeByLink` is the script's way in, for an operator
 * who has only the link: it finds every workspace's live copy.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ClipPlatform, prisma } from '@postgear/db';
import { isLinkRefusal, recogniseLink } from '@postgear/video-engine';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { isUuid } from '../../clips/clips.ids';
import { videoRightsRemovedNotice } from '../../clips/internal/clip-notices';
import { toDbPlatform } from '../../clips/links/clip-links.repository';
import { ClipRetentionService } from '../../clips/retention/clip-retention.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { OPERATOR_MESSAGES } from '../operator.messages';
import { OperatorAuditService } from '../operator-audit.service';

export interface RemovedVideoView {
  videoId: string;
  organizationId: string;
  /** True when the video came from a link and is now on the blocked list. */
  blocked: boolean;
}

type Actor = Pick<AuthenticatedUser, 'id' | 'email'>;

@Injectable()
export class OperatorClipsService {
  constructor(
    private readonly retention: ClipRetentionService,
    private readonly notifications: NotificationsService,
    private readonly audit: OperatorAuditService,
  ) {}

  /** `DELETE /operator/clips/videos/:videoId`. 404 when there is no live video with this id. */
  async removeVideo(videoId: string, reason: string, actor: Actor): Promise<RemovedVideoView> {
    if (!isUuid(videoId)) throw new NotFoundException(OPERATOR_MESSAGES.VIDEO_NOT_FOUND);
    const video = await prisma.clipVideo.findFirst({
      where: { id: videoId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!video) throw new NotFoundException(OPERATOR_MESSAGES.VIDEO_NOT_FOUND);
    const removed = await this.removeOne(video.organizationId, video.id, reason, actor);
    if (!removed) throw new NotFoundException(OPERATOR_MESSAGES.VIDEO_NOT_FOUND);
    return removed;
  }

  /**
   * `npm run clips:remove -- --url <link>`: every workspace's live copy of the
   * video at this link, then the blocked row even when no workspace has it
   * (so nobody can bring it in later).
   */
  async removeByLink(url: string, reason: string, actor: Actor): Promise<RemovedVideoView[]> {
    const link = recogniseLink(url);
    if (isLinkRefusal(link)) {
      throw new UnprocessableEntityException({
        message: OPERATOR_MESSAGES.NO_LINK_MATCH,
        code: link.code,
      });
    }
    const platform = toDbPlatform(link.platform);
    const copies = await prisma.clipVideo.findMany({
      where: { platform, externalId: link.externalId, deletedAt: null },
      select: { id: true, organizationId: true },
      orderBy: { createdAt: 'asc' },
    });
    const removed: RemovedVideoView[] = [];
    for (const copy of copies) {
      const one = await this.removeOne(copy.organizationId, copy.id, reason, actor);
      if (one) removed.push(one);
    }
    await this.block(platform, link.externalId, reason, actor);
    return removed;
  }

  private async removeOne(
    orgId: string,
    videoId: string,
    reason: string,
    actor: Actor,
  ): Promise<RemovedVideoView | null> {
    const removed = await this.retention.removeVideo(orgId, videoId, 'rights_request');
    if (!removed) return null;

    const fromLink = removed.platform !== ClipPlatform.UPLOAD && removed.externalId !== null;
    if (fromLink && removed.externalId) {
      await this.block(removed.platform as ClipPlatform, removed.externalId, reason, actor);
    }
    await this.notifications.notify(videoRightsRemovedNotice(orgId, videoId));
    await this.audit.record(actor, {
      action: 'clips.video_removed',
      summary: 'a video was removed after a rights request',
      lines: [
        `Video: ${removed.title} (${videoId})`,
        `Workspace: ${orgId}`,
        fromLink
          ? `Blocked for every workspace: ${removed.platform} ${removed.externalId}`
          : 'An upload: nothing to block.',
      ],
      reason,
      target: { orgId, videoId, blocked: fromLink },
    });
    return { videoId, organizationId: orgId, blocked: fromLink };
  }

  /** The platform-wide blocked row; a second removal of the same video keeps the first reason. */
  private async block(platform: ClipPlatform, externalId: string, reason: string, actor: Actor) {
    await prisma.clipBlockedVideo.upsert({
      where: { platform_externalId: { platform, externalId } },
      create: { platform, externalId, reason, createdBy: actor.email },
      update: {},
    });
  }
}
