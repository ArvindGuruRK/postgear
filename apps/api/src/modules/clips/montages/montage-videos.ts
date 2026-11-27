/**
 * Which videos a montage plays, and the rules that follow from it (Sprint 13,
 * Module 11). Shared by the montage route, the clip read, the exports, the
 * deletes and the removal rules, so they all agree on one list.
 *
 * - A montage (`origin: MONTAGE`) keeps its first clip's video in `videoId`
 *   and every OTHER video of its clips in `meta.videoIds` (a brand kit's
 *   intro or outro is not in the list: removing a brand video never removes a
 *   clip, montage or not, Module 10's rule).
 * - Removal (Sprint 12, Module 19): a montage is a clip of EVERY video it
 *   plays. `clipsPlayingVideo` is the `where` that finds the clips of a video
 *   including the montages that play it, so the removal deletes an unexported
 *   montage and marks an exported one, whichever of its videos goes.
 * - `assertMontageVideosLive`: a montage whose videos include a removed one
 *   (or that was marked removed) cannot be opened or exported: 422
 *   `montage_video_removed`.
 *
 * `meta.videoIds` is read, never trusted: anything that is not a list of
 * UUIDs reads as no other videos.
 */
import { HttpStatus } from '@nestjs/common';
import { type Clip, ClipOrigin, ClipVideoStatus, type Prisma } from '@postgear/db';
import { MAX_SOURCES } from '@postgear/video-engine';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import type { ClipsTx } from '../clips.tx';

/** The most videos one montage plays: one per clip. */
/** As many as a document may play (a montage of montages can reach it). */
const MAX_MONTAGE_VIDEOS = MAX_SOURCES;

type MontageFields = Pick<Clip, 'origin' | 'videoId' | 'meta'>;

/** True for a montage row. */
export function isMontage(clip: Pick<Clip, 'origin'>): boolean {
  return clip.origin === ClipOrigin.MONTAGE;
}

/** The other videos a stored meta lists (`meta.videoIds`), or none when it does not read. */
export function metaVideoIds(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const raw = (meta as { videoIds?: unknown }).videoIds;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isUuid))].slice(0, MAX_MONTAGE_VIDEOS);
}

/** Every video a clip is "of": its own, and for a montage every other video it plays. */
export function videosOfClip(clip: MontageFields): string[] {
  if (!isMontage(clip)) return [clip.videoId];
  return [...new Set([clip.videoId, ...metaVideoIds(clip.meta)])];
}

/** The montages that play `videoId` besides their first video. */
export function montagesPlayingVideo(videoId: string): Prisma.ClipWhereInput {
  return {
    origin: ClipOrigin.MONTAGE,
    meta: { path: ['videoIds'], array_contains: [videoId] },
  };
}

/** The clips of a video in a workspace: made from it, or a montage that plays it. */
export function clipsPlayingVideo(orgId: string, videoId: string): Prisma.ClipWhereInput {
  return { organizationId: orgId, OR: [{ videoId }, montagesPlayingVideo(videoId)] };
}

export function montageVideoRemoved(): ClipErrorException {
  return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'montage_video_removed');
}

/**
 * 422 `montage_video_removed` when the clip is a montage and one of its
 * videos was removed or deleted (or the montage itself was marked removed by
 * a removal). Anything else passes untouched, with no query. Takes a
 * transaction client so an export can check inside its own transaction.
 */
export async function assertMontageVideosLive(
  tx: Pick<ClipsTx, 'clipVideo'>,
  orgId: string,
  clip: MontageFields & Pick<Clip, 'removedAt'>,
): Promise<void> {
  if (!isMontage(clip)) return;
  if (clip.removedAt !== null) throw montageVideoRemoved();
  const ids = videosOfClip(clip);
  const live = await tx.clipVideo.count({
    where: {
      id: { in: ids },
      organizationId: orgId,
      deletedAt: null,
      status: { not: ClipVideoStatus.REMOVED },
    },
  });
  if (live < ids.length) throw montageVideoRemoved();
}

/**
 * Module 19's "a video was used" for every video of the clip: an export or
 * an open of a montage keeps each of its videos, not only the first.
 */
export async function touchVideosOfClip(
  retention: { touchVideo(orgId: string, videoId: string): Promise<boolean> },
  orgId: string,
  clip: MontageFields,
): Promise<void> {
  for (const videoId of videosOfClip(clip)) await retention.touchVideo(orgId, videoId);
}
