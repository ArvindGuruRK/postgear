/**
 * The rows the sound check and the export's sound files read and write
 * (Module 14). Every read and write of an upload is scoped to the
 * workspace; the library rows are shared, so they are read by id alone and
 * only ACTIVE or HIDDEN ones count (a HIDDEN sound left search, but clips
 * that use it keep working).
 */
import { type Prisma, prisma } from '@postgear/db';
import type { SoundAssetRow, SoundCheckRows } from './check';

export type { SoundAssetRow } from './check';

/** A library sound's file and length, as an export needs them. */
export interface LibrarySoundFile {
  fileKey: string;
  durationMs: number;
}

export interface SoundFileRows {
  /** An ACTIVE or HIDDEN library sound; null for a removed, staged or unknown one. */
  librarySound(soundId: string): Promise<LibrarySoundFile | null>;
  soundAsset(organizationId: string, assetId: string): Promise<SoundAssetRow | null>;
}

/** An uploaded sound: an AUDIO asset whose meta says so (a video's analysis audio is ANALYSIS_AUDIO). */
const SOUND_ASSET = {
  kind: 'AUDIO',
  meta: { path: ['purpose'], equals: 'sound' },
} as const satisfies Prisma.ClipAssetWhereInput;

async function soundAsset(organizationId: string, assetId: string): Promise<SoundAssetRow | null> {
  return prisma.clipAsset.findFirst({
    where: { id: assetId, organizationId, ...SOUND_ASSET },
    select: { id: true, organizationId: true, key: true, meta: true },
  });
}

/** Only a row still being checked may change: a retry, or a delete meanwhile, writes nothing. */
const stillChecking = {
  path: ['status'],
  equals: 'checking',
} satisfies Prisma.JsonNullableFilter<'ClipAsset'>;

export const prismaSoundCheckRows: SoundCheckRows = {
  soundAsset,
  async markSoundReady(organizationId, assetId, made) {
    const result = await prisma.clipAsset.updateMany({
      where: {
        id: assetId,
        organizationId,
        kind: 'AUDIO',
        AND: [{ meta: SOUND_ASSET.meta }, { meta: stillChecking }],
      },
      data: {
        key: made.key,
        bytes: BigInt(made.bytes),
        mimeType: made.mimeType,
        meta: made.meta as Prisma.InputJsonValue,
      },
    });
    return result.count === 1;
  },
  async markSoundFailed(organizationId, assetId, meta) {
    const result = await prisma.clipAsset.updateMany({
      where: {
        id: assetId,
        organizationId,
        kind: 'AUDIO',
        AND: [{ meta: SOUND_ASSET.meta }, { meta: stillChecking }],
      },
      data: { bytes: BigInt(0), meta: meta as Prisma.InputJsonValue },
    });
    return result.count === 1;
  },
};

export const prismaSoundFileRows: SoundFileRows = {
  soundAsset,
  async librarySound(soundId) {
    const row = await prisma.clipSound.findFirst({
      where: { id: soundId, status: { in: ['ACTIVE', 'HIDDEN'] } },
      select: { fileKey: true, durationMs: true },
    });
    return row ? { fileKey: row.fileKey, durationMs: row.durationMs } : null;
  },
};
