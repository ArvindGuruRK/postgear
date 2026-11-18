/**
 * The rows the sticker check and the export's sticker files read and write.
 * Every read and write is scoped to the workspace; the library rows are
 * shared, so they are read by id alone and only ACTIVE or HIDDEN ones count
 * (a HIDDEN sticker left search, but clips that use it keep working).
 */
import { Prisma, prisma } from '@postgear/db';
import type { StickerAssetRow, StickerCheckRows } from './check';

/** A library sticker's file and facts, as an export needs them. */
export interface LibraryStickerFile {
  fileKey: string;
  animated: boolean;
  width: number;
  height: number;
  fps: number | null;
  frames: number | null;
}

export interface StickerFileRows {
  /** An ACTIVE or HIDDEN library sticker; null for a removed, staged or unknown one. */
  librarySticker(stickerId: string): Promise<LibraryStickerFile | null>;
  stickerAsset(organizationId: string, assetId: string): Promise<StickerAssetRow | null>;
}

const STICKER_ASSET = { kind: 'STICKER' } as const;

async function stickerAsset(organizationId: string, assetId: string): Promise<StickerAssetRow | null> {
  return prisma.clipAsset.findFirst({
    where: { id: assetId, organizationId, ...STICKER_ASSET },
    select: { id: true, organizationId: true, key: true, meta: true },
  });
}

/** Only a row still being checked may change: a retry, or a delete meanwhile, writes nothing. */
const stillChecking = { path: ['status'], equals: 'checking' } satisfies Prisma.JsonNullableFilter<'ClipAsset'>;

export const prismaStickerCheckRows: StickerCheckRows = {
  stickerAsset,
  async markStickerReady(organizationId, assetId, made) {
    const result = await prisma.clipAsset.updateMany({
      where: { id: assetId, organizationId, ...STICKER_ASSET, meta: stillChecking },
      data: {
        key: made.key,
        bytes: BigInt(made.bytes),
        mimeType: made.mimeType,
        meta: made.meta as Prisma.InputJsonValue,
      },
    });
    return result.count === 1;
  },
  async markStickerFailed(organizationId, assetId, meta) {
    const result = await prisma.clipAsset.updateMany({
      where: { id: assetId, organizationId, ...STICKER_ASSET, meta: stillChecking },
      data: { bytes: BigInt(0), meta: meta as Prisma.InputJsonValue },
    });
    return result.count === 1;
  },
};

export const prismaStickerFileRows: StickerFileRows = {
  stickerAsset,
  async librarySticker(stickerId) {
    const row = await prisma.clipSticker.findFirst({
      where: { id: stickerId, status: { in: ['ACTIVE', 'HIDDEN'] } },
      select: { fileKey: true, kind: true, width: true, height: true, fps: true, frames: true },
    });
    if (!row) return null;
    return {
      fileKey: row.fileKey,
      animated: row.kind === 'ANIMATED',
      width: row.width,
      height: row.height,
      fps: row.fps,
      frames: row.frames,
    };
  },
};
