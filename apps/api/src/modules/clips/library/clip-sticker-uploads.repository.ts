/**
 * A workspace's own stickers (Module 12): `ClipAsset` rows of kind STICKER,
 * with no video and no clip. Every read and write is scoped to the
 * workspace; an id from the URL is never enough.
 */
import { Injectable } from '@nestjs/common';
import { type ClipAsset, Prisma, prisma } from '@postgear/db';

/** The most stickers the Uploaded tab lists. */
export const STICKER_UPLOADS_LIST_MAX = 200;

const STICKER = { kind: 'STICKER' } as const;

@Injectable()
export class ClipStickerUploadsRepository {
  create(
    orgId: string,
    data: { key: string; bytes: number; mimeType: string; meta: Prisma.InputJsonValue },
  ): Promise<ClipAsset> {
    return prisma.clipAsset.create({
      data: {
        organizationId: orgId,
        ...STICKER,
        key: data.key,
        bytes: BigInt(data.bytes),
        mimeType: data.mimeType,
        meta: data.meta,
      },
    });
  }

  /** Newest first. */
  list(orgId: string): Promise<ClipAsset[]> {
    return prisma.clipAsset.findMany({
      where: { organizationId: orgId, ...STICKER },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: STICKER_UPLOADS_LIST_MAX,
    });
  }

  find(orgId: string, id: string): Promise<ClipAsset | null> {
    return prisma.clipAsset.findFirst({ where: { id, organizationId: orgId, ...STICKER } });
  }

  findMany(orgId: string, ids: string[]): Promise<ClipAsset[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.clipAsset.findMany({
      where: { id: { in: ids }, organizationId: orgId, ...STICKER },
    });
  }

  /** True when the row was there to delete. */
  async remove(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.clipAsset.deleteMany({
      where: { id, organizationId: orgId, ...STICKER },
    });
    return result.count === 1;
  }

  /** How many of the workspace's clips draw this sticker, read from their documents. */
  async clipsUsing(orgId: string, assetId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "Clip"
      WHERE "organizationId" = ${orgId}
        AND jsonb_path_exists(
          document,
          '$.tracks[*].items[*].ref.asset ? (@ == $id)',
          jsonb_build_object('id', ${assetId}::text)
        )`;
    return rows[0]?.count ?? 0;
  }
}
