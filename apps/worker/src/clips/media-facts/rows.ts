/**
 * The Media rows the video facts step reads and writes (Module 19). Every
 * read and write is scoped to the workspace and to a video that is not
 * deleted, so a row deleted while its poster was being made is never
 * written to.
 *
 * Built over a Prisma-shaped client (`mediaFactsRows(db)`) so the tests
 * hand it a small in-memory one instead of a database.
 */
import { prisma } from '@postgear/db';

/** The `prisma.media` calls these rows use. */
export type MediaFactsDb = Pick<typeof prisma, 'media'>;

/** A Media video as the facts step needs it. */
export interface MediaVideoRow {
  id: string;
  organizationId: string;
  /** The file's media key. */
  path: string;
  thumbnail: string | null;
  fileSize: number;
  factsCheckedAt: Date | null;
}

/** What one pass writes; a field left out keeps its value. */
export interface MediaFactsUpdate {
  factsCheckedAt: Date;
  thumbnail?: string;
  durationMs?: number;
  fps?: number;
  width?: number;
  height?: number;
}

export interface MediaFactsRows {
  /** The workspace's video, or null when it is gone, deleted or not a video. */
  video(organizationId: string, mediaId: string): Promise<MediaVideoRow | null>;
  /** Writes the facts; false when the row was deleted meanwhile. */
  writeFacts(organizationId: string, mediaId: string, update: MediaFactsUpdate): Promise<boolean>;
  /**
   * Marks a row checked without facts (the workflow gave up on it), unless
   * a pass already checked it; so it is not tried on every pass.
   */
  markChecked(organizationId: string, mediaId: string, at: Date): Promise<void>;
}

/** A video in the library that is still there. */
function liveVideo(organizationId: string, mediaId: string) {
  return { id: mediaId, organizationId, type: 'video', deletedAt: null };
}

export function mediaFactsRows(db: MediaFactsDb = prisma): MediaFactsRows {
  return {
    async video(organizationId, mediaId) {
      return db.media.findFirst({
        where: liveVideo(organizationId, mediaId),
        select: {
          id: true,
          organizationId: true,
          path: true,
          thumbnail: true,
          fileSize: true,
          factsCheckedAt: true,
        },
      });
    },

    async writeFacts(organizationId, mediaId, update) {
      const result = await db.media.updateMany({
        where: liveVideo(organizationId, mediaId),
        data: update,
      });
      return result.count > 0;
    },

    async markChecked(organizationId, mediaId, at) {
      await db.media.updateMany({
        where: { ...liveVideo(organizationId, mediaId), factsCheckedAt: null },
        data: { factsCheckedAt: at },
      });
    },
  };
}
