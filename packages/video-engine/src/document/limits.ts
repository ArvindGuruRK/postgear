/**
 * The hard limits of a clip document. The schema enforces them, the editor
 * reads them to disable what would break them, and the API never accepts a
 * document that passes one.
 *
 * These are shape limits, not plan limits: what a plan allows (video length,
 * export quality) comes from the entitlement resolver, never from here.
 */

/** A clip is at least 3 seconds long. */
export const CLIP_MIN_MS = 3_000;

/**
 * A clip is at most 30 minutes long: raised from 10 so Edit Whole Video
 * (story CL-3.4) can open a whole talk or class as one clip.
 */
export const CLIP_MAX_MS = 1_800_000;

/** A part of the video in the clip is at least this long, so a split never leaves a sliver. */
export const SEGMENT_MIN_MS = 200;

export const MAX_SEGMENTS = 50;

/** Text, stickers and sounds together, across every track. */
export const MAX_ITEMS = 100;

/** Areas in one layout: the Four layout has four. */
export const MAX_AREAS = 4;

/** Crop keyframes per area. Sprint 12 writes one; Sprint 13's speaker tracking writes many. */
export const MAX_CROP_KEYFRAMES = 600;

export const MAX_ZOOMS = 50;

/** Characters in one text item. */
export const TEXT_MAX = 280;

/** The speeds a part of the clip can play at. */
export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Extra video fetched each side of a clip's range, so a trim has room without a new fetch. */
export const HANDLE_MS = 30_000;

/** Shortest a text, sticker or sound may last on the timeline. */
export const ITEM_MIN_MS = 100;

/** Longest fade at either end of the clip. */
export const FADE_MAX_MS = 5_000;

/** A part's own volume, and a sound's, is 0 (silent) to 2 (twice as loud). */
export const VOLUME_MAX = 2;

/** Zoom never goes past four times. */
export const ZOOM_MAX = 4;
