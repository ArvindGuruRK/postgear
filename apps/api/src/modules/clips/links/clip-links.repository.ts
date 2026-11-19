/**
 * The queries the link probe makes: does this workspace already have the
 * video? Same platform and external id, files not deleted, not removed after
 * a rights request; every such `where` carries the workspace. And (Module 19)
 * is the video on the platform-wide blocked list?
 */
import { Injectable } from '@nestjs/common';
import { type ClipPlatform, prisma } from '@postgear/db';
import type { ClipPlatformId } from '@postgear/video-engine';

/** The engine's lower-case platform to the database enum. */
export function toDbPlatform(platform: ClipPlatformId): ClipPlatform {
  return platform.toUpperCase() as ClipPlatform;
}

@Injectable()
export class ClipLinksRepository {
  async existingVideoId(
    orgId: string,
    platform: ClipPlatformId,
    externalId: string,
  ): Promise<string | null> {
    const row = await prisma.clipVideo.findFirst({
      where: {
        organizationId: orgId,
        platform: toDbPlatform(platform),
        externalId,
        deletedAt: null,
        status: { not: 'REMOVED' },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Module 19: whether an operator removed this video after a rights request.
   * Platform-wide on purpose (not per workspace): once removed, no workspace
   * may bring it in again.
   */
  async isBlocked(platform: ClipPlatformId, externalIds: readonly string[]): Promise<boolean> {
    const ids = [...new Set(externalIds.filter((id) => id.length > 0))];
    if (ids.length === 0) return false;
    const row = await prisma.clipBlockedVideo.findFirst({
      where: { platform: toDbPlatform(platform), externalId: { in: ids } },
      select: { id: true },
    });
    return row !== null;
  }
}
