/**
 * The one query the link probe makes: does this workspace already have the
 * video? Same platform and external id, files not deleted, not removed after
 * a rights request. Every `where` carries the workspace.
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
}
