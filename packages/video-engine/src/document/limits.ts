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

/** Sounds a clip may hold (effects and music together). */
export const MAX_SOUNDS = 20;

/**
 * Stickers a clip may hold, Follow Badges included. Each is its own input to
 * the export, and a moving one keeps its frames in memory there, so the
 * count is capped like the sounds' rather than left to `MAX_ITEMS`.
 */
export const MAX_STICKERS = 20;

/** Areas in one layout: the Four layout has four. */
export const MAX_AREAS = 4;

/** Crop keyframes per area. Sprint 12 writes one; Sprint 13's speaker tracking writes many. */
export const MAX_CROP_KEYFRAMES = 600;

export const MAX_ZOOMS = 50;

/** Characters in one text item. */
export const TEXT_MAX = 280;

/** A text box's width on the canvas, in canvas pixels before its scale (the text wraps inside it). */
export const TEXT_WIDTH_MIN = 40;
export const TEXT_WIDTH_MAX = 4_000;

/** A text's own fade in or out (Short and Long in the Text panel are 200 and 500 ms). */
export const TEXT_FADE_MAX_MS = 2_000;

/**
 * A sticker's box on the canvas, in canvas pixels before its scale (Module
 * 12). The picture fills it; its shape is the picture's own.
 */
export const STICKER_SIZE_MIN = 16;
export const STICKER_SIZE_MAX = 4_000;

/**
 * Frames in a moving sticker (6 seconds at 20 fps). `normaliseSticker`
 * makes nothing longer, and the render keeps a looping sticker's frames in
 * memory, so the plan refuses a file that says it has more.
 */
export const STICKER_FRAMES_MAX = 120;

/** Characters in a Follow Badge's channel name. */
export const BADGE_NAME_MAX = 30;

/** Overlay and sound tracks in one clip (the schema's cap on `tracks`). */
export const MAX_TRACKS = 16;

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

// --- Version 2 (Sprint 13) ----------------------------------------------------

/** A caption's size on the 1080 short side: readable at the small end, a shout at the large. */
export const CAPTION_SIZE_MIN = 24;
export const CAPTION_SIZE_MAX = 220;
/** The most words a caption page may be asked to hold ("A Line" asks for 7). */
export const CAPTION_MAX_WORDS = 12;
/** The longest one caption word may be after an edit, punctuation included. */
export const CAPTION_WORD_MAX = 80;
/** The most words of one clip a person may change or hide (a 30 minute clip holds about 5,000). */
export const MAX_CAPTION_EDITS = 2_000;
/** The most bleeps and mutes one clip keeps. */
export const MAX_BLEEPS = 300;
/** The most stretches of a followed clip a person may fix by hand. */
export const MAX_FOLLOW_OVERRIDES = 100;
