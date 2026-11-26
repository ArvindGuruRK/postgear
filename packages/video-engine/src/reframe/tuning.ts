/**
 * Every number Follow The Speaker turns on (Sprint 13, Module 08), in one
 * place. The real-test plan tunes these once against a real podcast and a
 * real stream; nothing else in `speaker.ts` or `path.ts` is a magic number.
 *
 * Units: times are milliseconds of the video, places and sizes are fractions
 * of the picture (as crops are), speeds are picture widths a second.
 */

// --- Who is speaking (`speaker.ts`) -------------------------------------------------------

/** A subject's stretch shorter than this is joined to a neighbour, so a short "yeah" never flicks the frame. */
export const SPEAKER_JOIN_MS = 1_200;

/** More people than this in the stretch and the editor asks whom to follow. */
export const SPEAKER_MANY_PEOPLE = 4;

/**
 * Words closer than this are one stretch of speech (a breath between words,
 * not between turns). The one value for the live path (the API's speech
 * answer, `highlights/follow.ts` `speechSpansIn`) and `speechStretches`
 * alike. 500, not 300: at 300 a turn breaks into short stretches and the
 * two-speakers sample switches 0.8 s late (its check allows 0.5 s).
 */
export const SPEECH_JOIN_GAP_MS = 500;

/**
 * Two face boxes further apart than this are not one step of the mouth
 * measure (the face was lost between them); five a second is 200 ms apart.
 */
export const MOUTH_STEP_MAX_MS = 300;

/**
 * Below this mean change of the face's height between pictures (as a part of
 * the face's own height), nobody's mouth is moving: detector noise, so the
 * mouth measure is ignored and size and place decide.
 */
export const MOUTH_NOISE_FLOOR = 0.004;

/** How much each clue counts when several people could be speaking (they add up to 1). */
export const SPEAKER_WEIGHT_MOUTH = 0.6;
export const SPEAKER_WEIGHT_SIZE = 0.25;
export const SPEAKER_WEIGHT_CENTRE = 0.15;

// --- The camera path (`path.ts`) -----------------------------------------------------------

/** The subject's typical face is this part of the crop's height. */
export const FOLLOW_FACE_SHARE = 1 / 3;

/**
 * The crop is never smaller than this part of the largest crop of its shape
 * (at most 2.5 times zoom), so a small, distant face is not blown up into a
 * blur.
 */
export const FOLLOW_MIN_CROP_SCALE = 0.4;

/**
 * Head room: the crop is centred this many face heights above the face's
 * centre, so there is a little more room above the head (hair, a hat) than
 * below the chin.
 */
export const FOLLOW_HEAD_ROOM = 0.1;

/** Dead zone: the crop holds while the target stays inside this middle part of the crop's width (and height). */
export const FOLLOW_DEAD_ZONE = 0.2;

/** A move out of the dead zone is believed once it has held for this many pictures in a row. */
export const FOLLOW_CONFIRM_PICTURES = 3;

/**
 * Smoothing: the reach of the forwards and backwards average, ms (its time
 * constant). Run both ways and averaged, it adds no lag.
 */
export const FOLLOW_SMOOTH_MS = 700;

/** The fastest a pan may go, picture widths a second (research: 5 % normal, 25 % catching up). */
export const FOLLOW_MAX_SPEED = 0.2;

/**
 * The subject unseen for longer than this inside its own stretch: the crop
 * holds where it was, and cuts (never pans) to them when they are back.
 */
export const FOLLOW_HOLD_GAP_MS = 1_000;

/** A stretch with nobody to follow longer than this is reported as lost (the hatched stretch). */
export const FOLLOW_LOST_REPORT_MS = 1_500;

/**
 * Reducing keyframes: a keyframe a straight line between its neighbours
 * already explains within this much (picture fractions, about 5 px on a
 * 1280 px picture) is dropped. Raised step by step until the path fits
 * `MAX_CROP_KEYFRAMES`.
 */
export const FOLLOW_REDUCE_TOLERANCE = 0.004;

/** How much the reducer's tolerance grows each time the path is still too long. */
export const FOLLOW_REDUCE_GROWTH = 1.5;

/** A cut is two keyframes this far apart: the old crop, then the new one. */
export const FOLLOW_CUT_MS = 1;
