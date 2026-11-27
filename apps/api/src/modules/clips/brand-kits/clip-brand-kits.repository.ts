/**
 * Studio's `BrandKit` rows as Clips reads and writes them (Sprint 13, Module
 * 10): the workspace's live kits, their clip fields, and the logo copy's id.
 * Every query carries the workspace and skips deleted kits, so another
 * workspace's kit, or a deleted one, is simply not there.
 */
import { Injectable } from '@nestjs/common';
import { type BrandKit, type ClipAsset, type ClipVideo, type Prisma, prisma } from '@postgear/db';
import type { ClipBrandFieldsWrite } from './clip-brand-fields';

const LIVE_KIT = { deletedAt: null } as const;

@Injectable()
export class ClipBrandKitsRepository {
  /** Newest change first, like Studio's kit list. */
  list(orgId: string): Promise<BrandKit[]> {
    return prisma.brandKit.findMany({
      where: { organizationId: orgId, ...LIVE_KIT },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  find(orgId: string, id: string): Promise<BrandKit | null> {
    return prisma.brandKit.findFirst({ where: { id, organizationId: orgId, ...LIVE_KIT } });
  }

  /** The kit after the write, or null when the workspace has no such live kit. */
  async update(orgId: string, id: string, data: ClipBrandFieldsWrite): Promise<BrandKit | null> {
    const changed = await prisma.brandKit.updateMany({
      where: { id, organizationId: orgId, ...LIVE_KIT },
      data,
    });
    if (changed.count === 0) return null;
    return this.find(orgId, id);
  }

  /**
   * Records the logo copy, only while the kit still names `expected` (null
   * or a copy that is gone): of two first uses at once, one copy wins. True
   * when this write was the one kept.
   */
  async setLogoAsset(
    orgId: string,
    id: string,
    expected: string | null,
    assetId: string,
  ): Promise<boolean> {
    const changed = await prisma.brandKit.updateMany({
      where: { id, organizationId: orgId, ...LIVE_KIT, clipLogoAssetId: expected },
      data: { clipLogoAssetId: assetId },
    });
    return changed.count === 1;
  }

  /** The workspace's live videos among `ids`, any status. */
  videos(orgId: string, ids: readonly string[]): Promise<ClipVideo[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.clipVideo.findMany({
      where: {
        id: { in: [...new Set(ids)] },
        organizationId: orgId,
        deletedAt: null,
        status: { not: 'REMOVED' },
      },
    });
  }

  /** The light copies and posters of those videos, oldest first. */
  videoFiles(orgId: string, ids: readonly string[]): Promise<ClipAsset[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.clipAsset.findMany({
      where: {
        organizationId: orgId,
        videoId: { in: [...new Set(ids)] },
        kind: { in: ['PROXY', 'POSTER'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * The logo copy as one of the workspace's own stickers: a STICKER asset
   * with no video and no clip, exactly what Upload A Sticker writes, so the
   * Uploaded tab, the sticker files route, the export and the sweep treat it
   * like any own sticker.
   */
  createSticker(
    orgId: string,
    data: { key: string; bytes: number; meta: Prisma.InputJsonValue },
  ): Promise<ClipAsset> {
    return prisma.clipAsset.create({
      data: {
        organizationId: orgId,
        kind: 'STICKER',
        key: data.key,
        bytes: BigInt(data.bytes),
        mimeType: 'image/png',
        meta: data.meta,
      },
    });
  }

  /** Removes a copy that lost the race (its files are removed by the caller). */
  async removeSticker(orgId: string, assetId: string): Promise<void> {
    await prisma.clipAsset.deleteMany({
      where: { id: assetId, organizationId: orgId, kind: 'STICKER' },
    });
  }

  /** One of the workspace's own sticker assets (the logo copy), or null. */
  sticker(orgId: string, assetId: string): Promise<ClipAsset | null> {
    return prisma.clipAsset.findFirst({
      where: { id: assetId, organizationId: orgId, kind: 'STICKER' },
    });
  }
}
