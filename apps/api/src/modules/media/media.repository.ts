/**
 * Persistence for the media library.
 *
 * Follows the pattern `channels.repository.ts` set: `orgId` in every signature
 * and every `where`, `deletedAt: null` on every read, and an explicit `select`
 * so what reaches a caller is decided here once.
 */
import { Injectable } from '@nestjs/common';
import { prisma, State } from '@postgear/db';

export type MediaKind = 'image' | 'video';

/** A media row as the rest of the API sees it. Keys, not URLs — the service builds those. */
export interface MediaRecord {
  id: string;
  name: string;
  type: MediaKind;
  mimeType: string | null;
  fileSize: number;
  width: number | null;
  height: number | null;
  /** Storage key of the file. */
  path: string;
  /** Storage key of the thumbnail, for images. */
  thumbnail: string | null;
  createdAt: Date;
}

export interface CreateMediaInput {
  orgId: string;
  name: string;
  originalName: string;
  path: string;
  thumbnail: string | null;
  type: MediaKind;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
}

const MEDIA_SELECT = {
  id: true,
  name: true,
  type: true,
  mimeType: true,
  fileSize: true,
  width: true,
  height: true,
  path: true,
  thumbnail: true,
  createdAt: true,
} as const;

@Injectable()
export class MediaRepository {
  async create(input: CreateMediaInput): Promise<MediaRecord> {
    const row = await prisma.media.create({
      data: {
        organizationId: input.orgId,
        name: input.name,
        originalName: input.originalName,
        path: input.path,
        thumbnail: input.thumbnail,
        type: input.type,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        width: input.width,
        height: input.height,
      },
      select: MEDIA_SELECT,
    });

    return toRecord(row);
  }

  /** Newest first. Search matches the display name, case-insensitively. */
  async list(params: {
    orgId: string;
    search?: string;
    type?: MediaKind;
    page: number;
    pageSize: number;
  }): Promise<{ items: MediaRecord[]; total: number }> {
    const where = {
      organizationId: params.orgId,
      deletedAt: null,
      ...(params.type ? { type: params.type } : {}),
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.media.findMany({
        where,
        // `id` breaks ties, so a page boundary between two uploads made in the
        // same millisecond is stable and nothing is shown twice or skipped.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: MEDIA_SELECT,
      }),
      prisma.media.count({ where }),
    ]);

    return { items: rows.map(toRecord), total };
  }

  async findById(orgId: string, id: string): Promise<MediaRecord | null> {
    const row = await prisma.media.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: MEDIA_SELECT,
    });

    return row ? toRecord(row) : null;
  }

  /**
   * Several rows at once, for resolving a post's attachments.
   *
   * Scoped to the organization, so a media id copied from another workspace
   * resolves to nothing rather than to that workspace's file.
   */
  async findByIds(orgId: string, ids: string[]): Promise<MediaRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await prisma.media.findMany({
      where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
      select: MEDIA_SELECT,
    });

    return rows.map(toRecord);
  }

  /**
   * Soft-deletes a row and returns it, so the caller can remove the stored files.
   *
   * The `updateMany` repeats `deletedAt: null`, which makes two concurrent
   * deletes safe: exactly one sees a count of 1 and removes the files.
   */
  async softDelete(orgId: string, id: string): Promise<MediaRecord | null> {
    const existing = await this.findById(orgId, id);

    if (!existing) {
      return null;
    }

    const { count } = await prisma.media.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return count === 1 ? existing : null;
  }

  /**
   * How many unpublished posts attach this media — the number the delete
   * confirmation states.
   *
   * Counted in groups, because that is what a user calls "a post": one image
   * shared across three channels is three rows and one post. `Post.image` is a
   * JSON string of `[{"id": …}]`, so this matches the quoted id; media ids are
   * UUIDs, which contain nothing a `LIKE` pattern would treat as a wildcard.
   */
  async countUnpublishedUsage(orgId: string, id: string): Promise<number> {
    const groups = await prisma.post.groupBy({
      by: ['group'],
      where: {
        organizationId: orgId,
        deletedAt: null,
        state: { in: [State.DRAFT, State.QUEUE] },
        image: { contains: `"${id}"` },
      },
    });

    return groups.length;
  }
}

function toRecord(row: {
  id: string;
  name: string;
  type: string;
  mimeType: string | null;
  fileSize: number;
  width: number | null;
  height: number | null;
  path: string;
  thumbnail: string | null;
  createdAt: Date;
}): MediaRecord {
  return {
    ...row,
    // The column is a free string with an "image" default inherited from the
    // reference; anything that is not video is treated as an image.
    type: row.type === 'video' ? 'video' : 'image',
  };
}
