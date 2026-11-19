/**
 * `ClipVideo` and its `ClipAsset` rows (Sprint 12, Module 04). Every read
 * and write is scoped to the workspace; an id from the URL is never enough.
 *
 * "Live" means not deleted and not removed: the row of a deleted video stays
 * with its rights record, and the same link may be imported again later.
 * Dedup is decided inside the caller's serializable transaction, not by a
 * unique index, for exactly that reason.
 */
import { Injectable } from '@nestjs/common';
import {
  type ClipAsset,
  ClipAssetKind,
  type ClipJob,
  ClipJobKind,
  type ClipPlatform,
  ClipStatus,
  type ClipVideo,
  ClipVideoStatus,
  Prisma,
  prisma,
} from '@postgear/db';
import type { ClipsTx } from '../clips.tx';

const LIVE = { deletedAt: null, status: { not: ClipVideoStatus.REMOVED } } as const;

/**
 * A video row with the files a card needs (its poster), its newest import
 * and (Module 06) how many of its clips are not hidden.
 */
export type VideoWithCard = ClipVideo & {
  assets: ClipAsset[];
  jobs: ClipJob[];
  _count?: { clips: number };
};

export interface VideoCursor {
  createdAt: Date;
  id: string;
}

/** Module 19: where a biggest-first page ended. */
export interface SizeCursor {
  bytes: number;
  id: string;
}

/**
 * The fields of a clip a video page lists. `document` is read only to work
 * out the clip's range (Module 07); the summary never carries it.
 */
export const CLIP_SUMMARY_SELECT = {
  id: true,
  videoId: true,
  document: true,
  title: true,
  status: true,
  origin: true,
  ratio: true,
  durationMs: true,
  score: true,
  reasons: true,
  revision: true,
  lastExportedRevision: true,
  exportedMediaId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ClipSummaryRow = Prisma.ClipGetPayload<{ select: typeof CLIP_SUMMARY_SELECT }>;

/** What `findUpload` binds an upload id to. */
export interface UploadBinding {
  asset: ClipAsset;
  video: ClipVideo;
}

@Injectable()
export class ClipVideosRepository {
  /** A live video of the workspace. */
  findLive(orgId: string, videoId: string, tx: ClipsTx = prisma): Promise<ClipVideo | null> {
    return tx.clipVideo.findFirst({ where: { id: videoId, organizationId: orgId, ...LIVE } });
  }

  /** The workspace's live video for a platform's video id, oldest first, if any. */
  findLiveByLink(
    orgId: string,
    platform: ClipPlatform,
    externalId: string,
    tx: ClipsTx = prisma,
  ): Promise<ClipVideo | null> {
    return tx.clipVideo.findFirst({
      where: { organizationId: orgId, platform, externalId, ...LIVE },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** One page of live videos with their poster and newest import job. */
  list(
    orgId: string,
    params: { sort: 'newest' | 'oldest'; cursor: VideoCursor | null; take: number },
  ) {
    const direction = params.sort === 'newest' ? 'desc' : 'asc';
    const after = params.cursor
      ? params.sort === 'newest'
        ? {
            OR: [
              { createdAt: { lt: params.cursor.createdAt } },
              { createdAt: params.cursor.createdAt, id: { lt: params.cursor.id } },
            ],
          }
        : {
            OR: [
              { createdAt: { gt: params.cursor.createdAt } },
              { createdAt: params.cursor.createdAt, id: { gt: params.cursor.id } },
            ],
          }
      : {};

    return prisma.clipVideo.findMany({
      where: { organizationId: orgId, ...LIVE, ...after },
      orderBy: [{ createdAt: direction }, { id: direction }],
      take: params.take,
      include: cardInclude(),
    }) as Promise<VideoWithCard[]>;
  }

  /**
   * Module 19 (See What Uses Space): one page of live video ids, biggest
   * first, with the bytes each keeps (every file of the video except Preview
   * Exports, the same rule as the space gauge). Keyset paging on (bytes, id).
   */
  async listIdsBySize(
    orgId: string,
    params: { cursor: SizeCursor | null; take: number },
  ): Promise<Array<{ id: string; bytes: number }>> {
    const kept = Prisma.sql`COALESCE(SUM(a.bytes) FILTER (WHERE a.kind <> 'PROOF'), 0)`;
    const after = params.cursor
      ? Prisma.sql`HAVING (${kept}, v.id) < (${BigInt(params.cursor.bytes)}, ${params.cursor.id})`
      : Prisma.empty;
    const rows = await prisma.$queryRaw<Array<{ id: string; bytes: bigint }>>`
      SELECT v.id, ${kept}::bigint AS bytes
      FROM "ClipVideo" v
      LEFT JOIN "ClipAsset" a ON a."videoId" = v.id AND a."organizationId" = v."organizationId"
      WHERE v."organizationId" = ${orgId} AND v."deletedAt" IS NULL AND v.status <> 'REMOVED'
      GROUP BY v.id
      ${after}
      ORDER BY bytes DESC, v.id DESC
      LIMIT ${params.take}`;
    return rows.map((row) => ({ id: row.id, bytes: Number(row.bytes) }));
  }

  /** Cards for ids, in the order given (another workspace's ids are simply not found). */
  async cardsByIds(orgId: string, ids: readonly string[]): Promise<VideoWithCard[]> {
    if (ids.length === 0) return [];
    const rows = (await prisma.clipVideo.findMany({
      where: { id: { in: [...ids] }, organizationId: orgId, ...LIVE },
      include: cardInclude(),
    })) as VideoWithCard[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  /** Module 19: the bytes each video keeps (Preview Exports left out), for the cards' size. */
  async storedBytesOf(orgId: string, videoIds: readonly string[]): Promise<Map<string, number>> {
    if (videoIds.length === 0) return new Map();
    const rows = await prisma.clipAsset.groupBy({
      by: ['videoId'],
      where: { organizationId: orgId, videoId: { in: [...videoIds] }, kind: { not: 'PROOF' } },
      _sum: { bytes: true },
    });
    return new Map(
      rows.flatMap((row) =>
        row.videoId ? [[row.videoId, Number(row._sum.bytes ?? 0n)] as const] : [],
      ),
    );
  }

  countLive(orgId: string): Promise<number> {
    return prisma.clipVideo.count({ where: { organizationId: orgId, ...LIVE } });
  }

  /** A live video with its card data (poster, newest import). */
  async findCard(orgId: string, videoId: string): Promise<VideoWithCard | null> {
    return (await prisma.clipVideo.findFirst({
      where: { id: videoId, organizationId: orgId, ...LIVE },
      include: cardInclude(),
    })) as VideoWithCard | null;
  }

  /** Every asset of a video (the detail page signs the ones it shows). */
  assetsOf(orgId: string, videoId: string): Promise<ClipAsset[]> {
    return prisma.clipAsset.findMany({
      where: { organizationId: orgId, videoId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** The clips of a video, newest first (a long video can hold many). */
  clipsOf(orgId: string, videoId: string, take = 200): Promise<ClipSummaryRow[]> {
    return prisma.clip.findMany({
      where: { organizationId: orgId, videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: CLIP_SUMMARY_SELECT,
    });
  }

  /**
   * The upload an id belongs to: the ORIGINAL asset whose `meta.uploadId`
   * matches, in this workspace, on a live video still coming in. The browser
   * names only the upload id; the video and the key come from here.
   */
  async findUpload(orgId: string, uploadId: string): Promise<UploadBinding | null> {
    const asset = await prisma.clipAsset.findFirst({
      where: {
        organizationId: orgId,
        kind: ClipAssetKind.ORIGINAL,
        meta: { path: ['uploadId'], equals: uploadId },
        video: { deletedAt: null, platform: 'UPLOAD' },
      },
      include: { video: true },
    });
    if (!asset?.video) return null;
    const { video, ...row } = asset;
    return { asset: row, video };
  }

  /** The newest IMPORT job of a video. */
  latestImport(orgId: string, videoId: string): Promise<ClipJob | null> {
    return prisma.clipJob.findFirst({
      where: { organizationId: orgId, videoId, kind: ClipJobKind.IMPORT },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}

function cardInclude() {
  return {
    assets: {
      where: { kind: ClipAssetKind.POSTER },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
    },
    jobs: {
      where: { kind: ClipJobKind.IMPORT },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 1,
    },
    // Module 06: the card's clip count, the same clips the Clips tab's All counts.
    _count: { select: { clips: { where: { status: { not: ClipStatus.HIDDEN } } } } },
  };
}
