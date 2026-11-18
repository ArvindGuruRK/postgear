/**
 * What the ingest and the operator's commands read and write in the
 * database, behind one interface so the engine is tested without one. The
 * Prisma version is the only real one.
 */
import { ClipLibraryStatus, ClipSoundKind, ClipStickerKind, Prisma, prisma } from '@postgear/db';
import type {
  LibrarySourceMeta,
  SoundCategory,
  SoundKind,
  SoundLicence,
  StickerCategory,
  StickerLicence,
} from './types';

export interface NewStickerRow {
  sourceId: string;
  runId: string;
  animated: boolean;
  name: string;
  tags: string[];
  category: StickerCategory;
  width: number;
  height: number;
  durationMs: number | null;
  frames: number | null;
  fps: number | null;
  fileKey: string;
  previewKey: string;
  bytes: number;
  licence: StickerLicence;
  licenceUrl: string;
  author: string;
  authorUrl: string | null;
  origin: string;
  originId: string;
  sourceUrl: string;
  originalWork: boolean;
  retrievedAt: Date;
  sourceChecksum: string;
  publish: boolean;
}

export interface StickerRowRef {
  id: string;
  name: string;
  status: 'STAGED' | 'ACTIVE' | 'HIDDEN' | 'REMOVED';
  fileKey: string;
  previewKey: string | null;
  origin: string;
  originId: string | null;
  sourceChecksum: string;
}

export interface LibraryStore {
  upsertSource(meta: LibrarySourceMeta): Promise<string>;
  createRun(origin: string, args: Record<string, unknown>): Promise<string>;
  finishRun(
    runId: string,
    result: {
      accepted: number;
      rejected: number;
      rejectionsByReason: Record<string, number>;
      reportKey: string;
    },
  ): Promise<void>;
  hasOrigin(origin: string, originId: string): Promise<boolean>;
  hasChecksum(sha256: string): Promise<boolean>;
  isDenied(origin: string, originId: string, sha256: string | null): Promise<boolean>;
  /** Writes the row; returns null when another row already holds its checksum or origin id. */
  createSticker(row: NewStickerRow): Promise<string | null>;
  /** STAGED to ACTIVE for one run; returns how many. */
  publishRun(runId: string, byId: string | null): Promise<number>;
  findSticker(id: string): Promise<StickerRowRef | null>;
  setStickerStatus(
    id: string,
    status: 'HIDDEN' | 'REMOVED' | 'ACTIVE',
    reason: string,
    byId: string | null,
  ): Promise<void>;
  deny(entry: {
    sourceChecksum: string;
    origin: string;
    originId: string | null;
    reason: string;
  }): Promise<void>;
}

/** One sound row as the sound ingest writes it (Module 14). */
export interface NewSoundRow {
  sourceId: string;
  runId: string;
  kind: SoundKind;
  name: string;
  tags: string[];
  category: SoundCategory;
  durationMs: number;
  bpm: number | null;
  loudnessLufs: number;
  truePeakDb: number;
  peaks: number[];
  fileKey: string;
  bytes: number;
  licence: SoundLicence;
  licenceUrl: string;
  author: string;
  authorUrl: string | null;
  origin: string;
  originId: string;
  sourceUrl: string;
  originalWork: boolean;
  retrievedAt: Date;
  sourceChecksum: string;
  publish: boolean;
}

export interface SoundRowRef {
  id: string;
  name: string;
  status: 'STAGED' | 'ACTIVE' | 'HIDDEN' | 'REMOVED';
  fileKey: string;
  origin: string;
  originId: string | null;
  sourceChecksum: string;
}

/**
 * The sound side of the store (Module 14). The source, run and deny-list
 * methods are the shared ones; `publishRun` publishes a run's sounds too.
 */
export interface SoundStore
  extends Pick<LibraryStore, 'upsertSource' | 'createRun' | 'finishRun' | 'isDenied' | 'deny' | 'publishRun'> {
  hasSoundOrigin(origin: string, originId: string): Promise<boolean>;
  hasSoundChecksum(sha256: string): Promise<boolean>;
  /** Writes the row; returns null when another row already holds its checksum, file or origin id. */
  createSound(row: NewSoundRow): Promise<string | null>;
  findSound(id: string): Promise<SoundRowRef | null>;
  setSoundStatus(
    id: string,
    status: 'HIDDEN' | 'REMOVED' | 'ACTIVE',
    reason: string,
    byId: string | null,
  ): Promise<void>;
}

const isUniqueClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export function prismaLibraryStore(): LibraryStore & SoundStore {
  return {
    async upsertSource(meta) {
      const data = {
        name: meta.name,
        author: meta.author,
        url: meta.url,
        licence: meta.licence,
        licenceUrl: meta.licenceUrl,
        creditLine: meta.creditLine,
        changeNote: meta.changeNote,
        noticeText: meta.noticeText,
        requiresCredit: meta.requiresCredit,
        creditPerItem: meta.creditPerItem,
      };
      const row = await prisma.clipLibrarySource.upsert({
        where: { code: meta.code },
        create: { code: meta.code, ...data },
        update: data,
        select: { id: true },
      });
      return row.id;
    },
    async createRun(origin, args) {
      const row = await prisma.clipLibraryRun.create({
        data: { origin, args: args as Prisma.InputJsonObject },
        select: { id: true },
      });
      return row.id;
    },
    async finishRun(runId, result) {
      await prisma.clipLibraryRun.update({
        where: { id: runId },
        data: {
          finishedAt: new Date(),
          accepted: result.accepted,
          rejected: result.rejected,
          rejectionsByReason: result.rejectionsByReason,
          reportKey: result.reportKey,
        },
      });
    },
    async hasOrigin(origin, originId) {
      return (await prisma.clipSticker.count({ where: { origin, originId } })) > 0;
    },
    async hasChecksum(sha256) {
      return (await prisma.clipSticker.count({ where: { sourceChecksum: sha256 } })) > 0;
    },
    async isDenied(origin, originId, sha256) {
      const or: Prisma.ClipLibraryDenyWhereInput[] = [{ origin, originId }];
      if (sha256) or.push({ sourceChecksum: sha256 });
      return (await prisma.clipLibraryDeny.count({ where: { OR: or } })) > 0;
    },
    async createSticker(row) {
      try {
        const created = await prisma.clipSticker.create({
          data: {
            sourceId: row.sourceId,
            runId: row.runId,
            kind: row.animated ? ClipStickerKind.ANIMATED : ClipStickerKind.STATIC,
            name: row.name,
            tags: row.tags,
            category: row.category,
            width: row.width,
            height: row.height,
            durationMs: row.durationMs,
            frames: row.frames,
            fps: row.fps,
            fileKey: row.fileKey,
            previewKey: row.previewKey,
            bytes: row.bytes,
            licence: row.licence,
            licenceUrl: row.licenceUrl,
            author: row.author,
            authorUrl: row.authorUrl,
            origin: row.origin,
            originId: row.originId,
            sourceUrl: row.sourceUrl,
            originalWork: row.originalWork,
            retrievedAt: row.retrievedAt,
            sourceChecksum: row.sourceChecksum,
            status: row.publish ? ClipLibraryStatus.ACTIVE : ClipLibraryStatus.STAGED,
            statusAt: row.publish ? new Date() : null,
          },
          select: { id: true },
        });
        return created.id;
      } catch (error) {
        if (isUniqueClash(error)) return null;
        throw error;
      }
    },
    async publishRun(runId, byId) {
      // A run is stickers or sounds; both tables are asked, the other one answers 0.
      const where = { runId, status: ClipLibraryStatus.STAGED };
      const data = {
        status: ClipLibraryStatus.ACTIVE,
        statusAt: new Date(),
        statusById: byId,
        statusReason: null,
      };
      const [stickers, sounds] = await prisma.$transaction([
        prisma.clipSticker.updateMany({ where, data }),
        prisma.clipSound.updateMany({ where, data }),
      ]);
      return stickers.count + sounds.count;
    },
    async findSticker(id) {
      return prisma.clipSticker.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          status: true,
          fileKey: true,
          previewKey: true,
          origin: true,
          originId: true,
          sourceChecksum: true,
        },
      });
    },
    async setStickerStatus(id, status, reason, byId) {
      await prisma.clipSticker.update({
        where: { id },
        data: {
          status: ClipLibraryStatus[status],
          statusReason: reason,
          statusById: byId,
          statusAt: new Date(),
        },
      });
    },
    async hasSoundOrigin(origin, originId) {
      return (await prisma.clipSound.count({ where: { origin, originId } })) > 0;
    },
    async hasSoundChecksum(sha256) {
      return (await prisma.clipSound.count({ where: { sourceChecksum: sha256 } })) > 0;
    },
    async createSound(row) {
      try {
        const created = await prisma.clipSound.create({
          data: {
            sourceId: row.sourceId,
            runId: row.runId,
            kind: row.kind === 'music' ? ClipSoundKind.MUSIC : ClipSoundKind.SFX,
            name: row.name,
            tags: row.tags,
            category: row.category,
            durationMs: row.durationMs,
            bpm: row.bpm,
            loudnessLufs: row.loudnessLufs,
            truePeakDb: row.truePeakDb,
            peaks: row.peaks,
            fileKey: row.fileKey,
            bytes: row.bytes,
            licence: row.licence,
            licenceUrl: row.licenceUrl,
            author: row.author,
            authorUrl: row.authorUrl,
            origin: row.origin,
            originId: row.originId,
            sourceUrl: row.sourceUrl,
            originalWork: row.originalWork,
            retrievedAt: row.retrievedAt,
            sourceChecksum: row.sourceChecksum,
            status: row.publish ? ClipLibraryStatus.ACTIVE : ClipLibraryStatus.STAGED,
            statusAt: row.publish ? new Date() : null,
          },
          select: { id: true },
        });
        return created.id;
      } catch (error) {
        if (isUniqueClash(error)) return null;
        throw error;
      }
    },
    async findSound(id) {
      return prisma.clipSound.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          status: true,
          fileKey: true,
          origin: true,
          originId: true,
          sourceChecksum: true,
        },
      });
    },
    async setSoundStatus(id, status, reason, byId) {
      await prisma.clipSound.update({
        where: { id },
        data: {
          status: ClipLibraryStatus[status],
          statusReason: reason,
          statusById: byId,
          statusAt: new Date(),
        },
      });
    },
    async deny(entry) {
      try {
        await prisma.clipLibraryDeny.upsert({
          where: { sourceChecksum: entry.sourceChecksum },
          create: entry,
          update: { reason: entry.reason },
        });
      } catch (error) {
        // The same origin id is already denied under another file: it is denied either way.
        if (!isUniqueClash(error)) throw error;
      }
    },
  };
}
