/**
 * The clip document: everything a clip is, in one versioned JSON value.
 *
 * ## Two clocks
 *
 * - **Source time** (the video's own milliseconds): segments say which part
 *   of the video plays, and crops and zooms are keyed to it, so trimming,
 *   splitting or speeding a part never moves a crop off the moment it framed.
 * - **Output time** (the clip's milliseconds, from 0): text, stickers and
 *   sounds sit on it. Items with `anchor: 'moment'` are put back on their
 *   video moment after every edit that moves video (see `time/edits.ts`);
 *   items with `anchor: 'clip'` stay where they are.
 *
 * All times are whole milliseconds. Frames are never stored: they are worked
 * out from `canvas.fps` when drawing.
 *
 * ## Strict on purpose
 *
 * Every object is `.strict()`: an unknown key is a refusal, not something
 * quietly carried. A document is upgraded first (`upgrade.ts`), then parsed,
 * so an older document is never refused for being older.
 *
 * Pure: no Node built-ins and no other `@postgear/*` package, because the
 * browser preview, the API and the worker all read it.
 */
import { z } from 'zod';
import { BRAND_VIDEO_MAX_MS } from '../brand/types';
import { CANVAS_FPS, CANVASES, RATIOS } from '../canvas';
import { hasEmoji } from './emoji';
import {
  BADGE_NAME_MAX,
  BLUR_MIN_SIZE,
  CAPTION_MAX_WORDS,
  CAPTION_SIZE_MAX,
  CAPTION_SIZE_MIN,
  CAPTION_WORD_MAX,
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  FADE_MAX_MS,
  ITEM_MIN_MS,
  JOIN_FADE_MS,
  MAX_AREAS,
  MAX_BLEEPS,
  MAX_BLURS,
  MAX_CAPTION_EDITS,
  MAX_CROP_KEYFRAMES,
  MAX_FOLLOW_OVERRIDES,
  MAX_ITEMS,
  MAX_SEGMENTS,
  MAX_SOUNDS,
  MAX_SOURCES,
  MAX_STICKERS,
  MAX_TRACKS,
  MAX_ZOOMS,
  MONTAGE_MAX_CLIPS,
  MONTAGE_MIN_CLIPS,
  MONTAGE_PART_TITLE_MAX,
  SEGMENT_MIN_MS,
  SPEEDS,
  STICKER_SIZE_MAX,
  STICKER_SIZE_MIN,
  TEXT_FADE_MAX_MS,
  TEXT_MAX,
  TEXT_WIDTH_MAX,
  TEXT_WIDTH_MIN,
  VOLUME_MAX,
  ZOOM_MAX,
} from './limits';

/** Short ids made by the editor (`seg_3f9a`), or UUIDs. Never free text. */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'An id may hold letters, digits, _ and - only');

const uuidSchema = z.string().uuid();

/** Whole milliseconds, never negative. */
const msSchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 * 60 * 1000);

/** A fraction from 0 to 1. */
const unit = z.number().min(0).max(1);

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is #RRGGBB');

export const rectSchema = z
  .object({
    x: unit,
    y: unit,
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .strict()
  .refine(
    (r) => r.x + r.w <= 1 + 1e-6 && r.y + r.h <= 1 + 1e-6,
    'A box must stay inside the picture',
  );

export const pointSchema = z.object({ x: unit, y: unit }).strict();

export const ratioSchema = z.enum(RATIOS);

export const canvasSchema = z
  .object({
    ratio: ratioSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.union([z.literal(CANVAS_FPS[0]), z.literal(CANVAS_FPS[1])]),
    background: hexColour,
  })
  .strict()
  .refine(
    (c) => c.width === CANVASES[c.ratio].width && c.height === CANVASES[c.ratio].height,
    'The canvas size must match its shape',
  );

export const sourceSchema = z.object({ id: idSchema, videoId: uuidSchema }).strict();

export const speedSchema = z.union([
  z.literal(SPEEDS[0]),
  z.literal(SPEEDS[1]),
  z.literal(SPEEDS[2]),
  z.literal(SPEEDS[3]),
  z.literal(SPEEDS[4]),
  z.literal(SPEEDS[5]),
]);

export const LAYOUT_KINDS = [
  'fullscreen',
  'blurred',
  'split',
  'three',
  'four',
  'gameplay',
  'screen_share',
  'custom',
] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

export const FIT_CROPS = ['original', '4:3', '1:1'] as const;
export type FitCrop = (typeof FIT_CROPS)[number];

export const cropKeyframeSchema = z.object({ at: msSchema, rect: rectSchema }).strict();

export const areaSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(40),
    frame: rectSchema,
    crop: z.array(cropKeyframeSchema).min(1).max(MAX_CROP_KEYFRAMES),
    fit: z.enum(['cover', 'contain']),
    /** Rounded corners, in canvas pixels (the 1080 short side). */
    radius: z.number().min(0).max(540).optional(),
  })
  .strict()
  .refine(
    (a) => a.crop.every((k, i) => i === 0 || k.at > (a.crop[i - 1] as { at: number }).at),
    'Crop keyframes must be in time order',
  );

/**
 * What sits behind the areas: the canvas colour, or a blurred copy of the
 * video. Optional: without it the kind decides (Blurred and Screen Share are
 * blurred, the rest solid); a layout turned Custom writes it so it keeps the
 * background it had (Module 10).
 */
export const LAYOUT_BASES = ['solid', 'blurred'] as const;
export type LayoutBase = (typeof LAYOUT_BASES)[number];

/** Fix By Hand: a crop that replaces the followed frame for one stretch, in SOURCE time. */
export const followOverrideSchema = z
  .object({ from: msSchema, to: msSchema, rect: rectSchema })
  .strict()
  .refine((o) => o.from < o.to, 'A hand fix must end after it starts');

/**
 * The parts of a layout every layout has. `layoutSchema` adds `follow`; a
 * followed layout keeps the layout it replaced as `follow.saved` in this
 * shape (no `follow` of its own, so a saved layout is never a followed one).
 */
const layoutFields = {
  kind: z.enum(LAYOUT_KINDS),
  fitCrop: z.enum(FIT_CROPS).optional(),
  base: z.enum(LAYOUT_BASES).optional(),
  areas: z.array(areaSchema).min(1).max(MAX_AREAS),
};

/** A layout as it was before Follow The Speaker (Module 08): what switching it off gives back. */
export const savedLayoutSchema = z.object(layoutFields).strict();

/**
 * Version 2: Follow The Speaker (Module 08). The crops it works out are
 * written as keyframes in `areas[].crop`, which `areaCropAt` already reads;
 * this records that they came from following, from which face file, the
 * stretches a person fixed by hand (mode `speaker` only), the person picked
 * when there were many faces (`personId`, optional), and `saved`, the
 * layout as it was before, so switching it off gives back the person's own
 * boxes exactly.
 */
export const followSchema = z
  .object({
    mode: z.enum(['speaker', 'both']),
    faceAssetId: uuidSchema,
    overrides: z.array(followOverrideSchema).max(MAX_FOLLOW_OVERRIDES),
    /**
     * Who was picked to follow when there were many faces, as an anchor the
     * editor resolves to the nearest face (`person@<ms>:<cx>,<cy>`, not a
     * `linkPeople` id: those follow first-seen order and change with the
     * pictures read). Absent when the speaker is chosen.
     */
    personId: z.string().min(1).max(40).optional(),
    saved: savedLayoutSchema,
  })
  .strict();

export const layoutSchema = z
  .object({
    ...layoutFields,
    follow: followSchema.optional(),
  })
  .strict();

/**
 * The roles a part can play (version 2). Absent for an ordinary part.
 *
 * - `hook` (Module 09): a stretch of the video played first as the clip's
 *   opening (it also plays later). A part like any other to the time map.
 * - `intro`, `outro` (Module 10): a brand kit's own short video, played
 *   before or after the clip. Captions and bleeps skip them; they carry a
 *   `layoutOverride` (their own video, cover-fitted), since the clip's
 *   layout frames another video.
 */
export const SEGMENT_ROLES = ['hook', 'intro', 'outro'] as const;
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

export const segmentSchema = z
  .object({
    id: idSchema,
    source: idSchema,
    sourceIn: msSchema,
    sourceOut: msSchema,
    speed: speedSchema,
    volume: z.number().min(0).max(VOLUME_MAX),
    role: z.enum(SEGMENT_ROLES).optional(),
    /**
     * Version 2 (Module 10, widened by Module 11's montage): this part's own
     * layout, in place of the document's. Its crops are keyed in the part's
     * own source time like the document's. The full layout shape: a montage
     * part carries its original clip's layout, which may be followed (its
     * crops then move, and `follow` keeps what switching it off gives back).
     */
    layoutOverride: layoutSchema.optional(),
  })
  .strict()
  .refine((s) => s.sourceIn < s.sourceOut, 'A part must end after it starts');

export const zoomSchema = z
  .object({
    id: idSchema,
    source: idSchema,
    /** Source time, like crops. */
    from: msSchema,
    to: msSchema,
    scale: z.number().min(1).max(ZOOM_MAX),
    /** The point zoomed into, a fraction of the clip's canvas (it stays still while the rest grows). */
    focus: pointSchema,
    /** Milliseconds the zoom takes to come in and to go out, 0 for a cut. */
    ease: z.number().int().min(0).max(2_000),
  })
  .strict()
  .refine((z) => z.from < z.to, 'A zoom must end after it starts');

export const LOOK_COLOURS = [
  'none',
  'warm',
  'cool',
  'vivid',
  'black_white',
  'sepia',
  'vintage',
  'cinematic',
] as const;
export type LookColour = (typeof LOOK_COLOURS)[number];

export const looksSchema = z
  .object({
    colour: z.enum(LOOK_COLOURS),
    strength: unit,
    vignette: unit,
  })
  .strict();

export const fadesSchema = z
  .object({
    inMs: z.number().int().min(0).max(FADE_MAX_MS),
    outMs: z.number().int().min(0).max(FADE_MAX_MS),
  })
  .strict();

export const ANCHORS = ['moment', 'clip'] as const;
export type Anchor = (typeof ANCHORS)[number];

/** Where a visual item sits: its centre, size and turn, relative to the canvas. */
export const transformSchema = z
  .object({
    /** The centre, a fraction of the canvas (may sit partly off it). */
    x: z.number().min(-0.5).max(1.5),
    y: z.number().min(-0.5).max(1.5),
    /** 1 is the item's natural size on the 1080 canvas. */
    scale: z.number().gt(0).max(10),
    /** Degrees, clockwise positive. */
    rotation: z.number().min(-360).max(360),
    opacity: unit,
  })
  .strict();

const itemBase = {
  id: idSchema,
  /** Output time. */
  start: msSchema,
  duration: z.number().int().min(ITEM_MIN_MS).max(CLIP_MAX_MS),
  anchor: z.enum(ANCHORS),
};

/**
 * How a text looks. Sizes are canvas pixels (the 1080 short side), so they
 * mean the same at every export quality; `size` is a CSS-style em size and
 * the compiler turns it into an ASS one with the font's own numbers.
 *
 * **Outline and box are one choice** (Module 11): an ASS box is the outline
 * drawn as a filled rectangle (`BorderStyle 3`), so one text cannot have
 * both. Box corners are square in Sprint 12 (`radius` is kept for Module 21
 * and is 0 from every control); the box's `opacity` is the box colour's
 * alpha, and the padding is its `pad`.
 */
export const textStyleSchema = z
  .object({
    /** A Studio font family name; the render fails with `font_missing` rather than swap it. */
    font: z.string().trim().min(1).max(80),
    /** Pixels on the 1080 canvas. */
    size: z.number().min(8).max(400),
    weight: z.number().int().min(100).max(900),
    italic: z.boolean(),
    colour: hexColour,
    align: z.enum(['left', 'center', 'right']),
    outline: z
      .object({ colour: hexColour, width: z.number().min(0).max(40) })
      .strict()
      .nullable(),
    background: z
      .object({
        colour: hexColour,
        opacity: unit,
        radius: z.number().min(0).max(200),
        /** The box's margin around the text, canvas pixels (the ASS `Outline` of a box). */
        pad: z.number().min(0).max(120).optional(),
      })
      .strict()
      .nullable(),
    shadow: z.boolean(),
    uppercase: z.boolean(),
  })
  .strict()
  .refine((s) => !(s.outline && s.background), 'A text has an outline or a box, not both');

export const textItemSchema = z
  .object({
    ...itemBase,
    type: z.literal('text'),
    text: z
      .string()
      .min(1)
      .max(TEXT_MAX)
      .refine((text) => text.trim().length > 0, 'A text needs at least one letter')
      .refine((text) => !hasEmoji(text), 'Emoji are stickers, not text'),
    style: textStyleSchema,
    transform: transformSchema,
    /** The text box's width on the canvas before `transform.scale`; the words wrap inside it. */
    widthPx: z.number().min(TEXT_WIDTH_MIN).max(TEXT_WIDTH_MAX),
    /** The text's own fade in and out, from and to transparent (0 for none). */
    fadeInMs: z.number().int().min(0).max(TEXT_FADE_MAX_MS),
    fadeOutMs: z.number().int().min(0).max(TEXT_FADE_MAX_MS),
    /**
     * Version 2: made by Add Hook Title (Module 09). It stays at 0, over the
     * hook clip, when a hook is added or removed; otherwise an ordinary text.
     */
    hookTitle: z.literal(true).optional(),
  })
  .strict();

/** The platforms a Follow Badge can name (Module 12 section 8). */
export const BADGE_PLATFORMS = ['twitch', 'youtube', 'kick', 'tiktok', 'instagram'] as const;
export type BadgePlatform = (typeof BADGE_PLATFORMS)[number];

/**
 * What a sticker draws: a library item, the workspace's own upload, or the
 * Follow Badge, which is drawn from its data (a platform and a channel name)
 * and has no file.
 */
export const stickerRefSchema = z.union([
  z.object({ library: z.literal('sticker'), id: uuidSchema }).strict(),
  z.object({ asset: uuidSchema }).strict(),
  z
    .object({
      badge: z.enum(BADGE_PLATFORMS),
      name: z
        .string()
        .max(BADGE_NAME_MAX)
        .refine((name) => name.trim().length > 0, 'A Follow Badge needs a name')
        .refine(
          // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
          (name) => !/[\u0000-\u001f\u007f]/.test(name),
          'A Follow Badge name is one plain line',
        )
        .refine((name) => !hasEmoji(name), 'Emoji are stickers, not text'),
    })
    .strict(),
]);

const stickerSize = z.number().min(STICKER_SIZE_MIN).max(STICKER_SIZE_MAX);

export const stickerItemSchema = z
  .object({
    ...itemBase,
    type: z.literal('sticker'),
    ref: stickerRefSchema,
    transform: transformSchema,
    flipX: z.boolean(),
    /** The box on the canvas before `transform.scale`, in canvas pixels (the picture's own shape). */
    widthPx: stickerSize,
    heightPx: stickerSize,
    /**
     * A moving sticker loops for the item's length, or plays once and holds
     * its last frame until the item ends. A still one ignores it.
     */
    loop: z.boolean(),
    /**
     * Version 2: the brand kit's logo (Module 10). Added and removed with the
     * kit's Logo switch; otherwise an ordinary sticker.
     */
    brand: z.literal(true).optional(),
  })
  .strict();

export const soundRefSchema = z.union([
  z.object({ library: z.literal('sound'), id: uuidSchema }).strict(),
  z.object({ asset: uuidSchema }).strict(),
]);

export const audioItemSchema = z
  .object({
    ...itemBase,
    type: z.enum(['sfx', 'music']),
    ref: soundRefSchema,
    /** Where in the sound file playback starts. */
    offsetMs: msSchema,
    volume: z.number().min(0).max(VOLUME_MAX),
    fadeInMs: z.number().int().min(0).max(FADE_MAX_MS),
    fadeOutMs: z.number().int().min(0).max(FADE_MAX_MS),
    /** Music only: lower it while the video's own sound plays. */
    duck: z.boolean(),
  })
  .strict();

export const overlayTrackSchema = z
  .object({
    id: idSchema,
    kind: z.literal('overlay'),
    items: z.array(z.discriminatedUnion('type', [textItemSchema, stickerItemSchema])),
  })
  .strict();

export const audioTrackSchema = z
  .object({ id: idSchema, kind: z.literal('audio'), items: z.array(audioItemSchema) })
  .strict();

/** How a caption's words are cased when drawn (ASS has no case attribute: the writer does it). */
export const CAPTION_CASES = ['as_spoken', 'upper', 'lower'] as const;
export type CaptionCase = (typeof CAPTION_CASES)[number];

/** A change to one word that belongs to this clip only (a video-wide fix lives in the transcript). */
export const captionEditSchema = z
  .object({
    /** What this word says in this clip. */
    text: z
      .string()
      .min(1)
      .max(CAPTION_WORD_MAX)
      .refine((text) => text.trim().length > 0, 'A word needs at least one letter')
      .optional(),
    /** The word is not shown in this clip (it is still spoken). */
    hidden: z.boolean().optional(),
  })
  .strict();

/**
 * Version 2: captions (Sprint 13, Module 03). **No time is stored here.** The
 * words and their times live in the transcript file (`transcriptAssetId`), in
 * the video's own time; everything shown is mapped onto the clip through the
 * segment list (`captions/map.ts`), so a trim, a split, a removed part, a
 * speed change or a hook clip keeps every caption on its word.
 *
 * - `styleId`: a built-in style's id, or a workspace's own `ClipCaptionStyle`.
 * - `position`: the centre of the caption block, a fraction of the canvas.
 * - `sizePx`: the text's size on the 1080 short side.
 * - `maxWords`: words on a page at once (the pager may show fewer).
 * - `edits`: this clip's own changes, keyed by the word's stable index.
 * - `letterCase`, `markColour`: set only when they differ from the style's own.
 */
export const captionsTrackSchema = z
  .object({
    id: idSchema,
    kind: z.literal('captions'),
    transcriptAssetId: uuidSchema,
    /**
     * Module 11: the source (video) these captions are for. Absent on a clip
     * with one captions track (they follow every main part); required on each
     * track once a document has more than one (a montage of clips from
     * several videos: one captions track per source transcript).
     */
    source: idSchema.optional(),
    language: z.string().regex(/^[a-z]{2,3}$/, 'A language is a short code'),
    styleId: idSchema,
    position: pointSchema,
    sizePx: z.number().min(CAPTION_SIZE_MIN).max(CAPTION_SIZE_MAX),
    maxWords: z.number().int().min(1).max(CAPTION_MAX_WORDS),
    edits: z
      .record(
        z.string().regex(/^(?:0|[1-9]\d{0,8})$/, 'A word index is a whole number'),
        captionEditSchema,
      )
      .refine((edits) => Object.keys(edits).length <= MAX_CAPTION_EDITS, {
        message: `A clip keeps up to ${MAX_CAPTION_EDITS} caption changes`,
      }),
    letterCase: z.enum(CAPTION_CASES).optional(),
    markColour: hexColour.optional(),
  })
  .strict();

/**
 * Version 2: a word bleeped or muted (Module 09), in SOURCE time like crops,
 * so it stays on its word through every edit.
 */
export const bleepSchema = z
  .object({
    id: idSchema,
    source: idSchema,
    from: msSchema,
    to: msSchema,
    mode: z.enum(['bleep', 'mute']),
  })
  .strict()
  .refine((b) => b.from < b.to, 'A bleep must end after it starts');

/**
 * Module 17 item 18: a part of one video blurred for the whole clip (a
 * bystander, a screen), as a fraction of that video's picture, so it stays
 * on the same spot whatever the crop, the layout or the zoom.
 */
export const blurSchema = z
  .object({
    id: idSchema,
    source: idSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(BLUR_MIN_SIZE).max(1),
    h: z.number().min(BLUR_MIN_SIZE).max(1),
  })
  .strict()
  .refine(
    (b) => b.x + b.w <= 1.000001 && b.y + b.h <= 1.000001,
    'A blur must stay inside the video',
  );

export const trackSchema = z.discriminatedUnion('kind', [
  overlayTrackSchema,
  audioTrackSchema,
  captionsTrackSchema,
]);

/**
 * Editor facts that never reach the picture (Module 08). Optional, so every
 * document written before it still reads, and strict like the rest.
 *
 * - `shapeChosen`: the first-open "What Do You Want To Make?" question was
 *   answered, so it is never asked again (even if the answer kept the shape).
 */
export const documentMetaSchema = z
  .object({
    shapeChosen: z.boolean().optional(),
    /**
     * Module 10: the cleanup this clip had, so Save As Recipe reads it back
     * (a removed pause is only a cut once made). Set by Remove Silences
     * (`silencesMinMs`, the slider's value) and Remove Filler Words.
     */
    cleanup: z
      .object({
        silencesMinMs: z.number().int().min(0).max(10_000).optional(),
        fillers: z.literal(true).optional(),
      })
      .strict()
      .optional(),
    /**
     * Module 11: a montage's original clips, in order, each with the part it
     * starts at (the timeline's divider and name). A snapshot: renaming or
     * editing the original clip changes nothing here. A part named here that
     * an edit removed simply loses its divider.
     */
    montage: z
      .object({
        parts: z
          .array(
            z
              .object({
                clipId: idSchema,
                title: z.string().max(MONTAGE_PART_TITLE_MAX),
                firstSegment: idSchema,
              })
              .strict(),
          )
          .min(MONTAGE_MIN_CLIPS)
          .max(MONTAGE_MAX_CLIPS),
      })
      .strict()
      .optional(),
  })
  .strict();

/** The longest line a card shows. */
export const CARD_TEXT_MAX = 80;
/** A card lasts this long (Module 10's outro card, Module 11's title card). */
export const CARD_MS = 2_000;

/**
 * Version 2 (Module 10): a scene drawn by the compiler with no video, from a
 * `color` source, an optional logo and one line of ASS text, with silent
 * sound. The closing card is a brand kit's outro card; the opening card is
 * Module 11's montage title. Cards sit OUTSIDE the clip's own time: the
 * time map, every item and every caption are in the clip's time, and the
 * render adds the opening card before it and the closing card after it
 * (`cardsMs`, `renderedDuration`).
 */
export const cardSchema = z
  .object({
    text: z
      .string()
      .max(CARD_TEXT_MAX)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
      .refine((text) => !/[\u0000-\u001f\u007f]/.test(text), 'A card line is one plain line')
      .refine((text) => !hasEmoji(text), 'Emoji are stickers, not text'),
    background: hexColour,
    colour: hexColour,
    /** The kit's logo as the workspace's own sticker asset, or none. */
    logo: z.object({ asset: uuidSchema }).strict().nullable(),
    /** A hook look id (`hook-bold`...) the text is drawn in, or null for the plain card text. */
    look: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .nullable(),
    durationMs: z.literal(CARD_MS),
  })
  .strict()
  .refine(
    (card) => card.text.trim().length > 0 || card.logo !== null,
    'A card shows a line or a logo',
  );

export const cardsSchema = z
  .object({ opening: cardSchema.optional(), closing: cardSchema.optional() })
  .strict();

/**
 * Version 2 (Module 11): how two parts meet. A Cut needs nothing; a Fade is
 * a picture and sound mix of `JOIN_FADE_MS` at the start of `beforeSegment`.
 * The two sides overlap, so every fade shortens the clip by its length and
 * moves everything after it earlier (`time/time-map.ts`, `joinOverlapMs`).
 * A join naming a part that is gone, or the first part, does nothing.
 */
export const joinSchema = z
  .object({
    beforeSegment: idSchema,
    kind: z.literal('fade'),
    ms: z.literal(JOIN_FADE_MS),
  })
  .strict();

/**
 * Version 2 (Sprint 13) adds captions, bleeps, a part's `hook` role, Follow
 * The Speaker and `recipeId`. It changes nothing a version 1 clip relies on:
 * every version 1 document is a valid version 2 document after `upgrade()`.
 */
export const CURRENT_SCHEMA_VERSION = 2 as const;

/** Output length of one part, rounded once. `time/time-map.ts` builds on this. */
export function segmentOutputMs(segment: {
  sourceIn: number;
  sourceOut: number;
  speed: number;
}): number {
  return Math.round((segment.sourceOut - segment.sourceIn) / segment.speed);
}

/**
 * Module 11: how much each part overlaps the one before it (0 for a cut,
 * the first part and a join naming a gone part). A fade never takes more
 * than half of either side, so two fades around a short part never meet and
 * FFmpeg's `xfade` always has enough picture. The time map, the compiler's
 * `xfade` offsets and the preview all read this one list.
 */
export function joinOverlaps(doc: {
  segments: ReadonlyArray<{ id: string; sourceIn: number; sourceOut: number; speed: number }>;
  joins?: ReadonlyArray<{ beforeSegment: string; ms: number }> | undefined;
}): number[] {
  const wanted = new Map((doc.joins ?? []).map((join) => [join.beforeSegment, join.ms]));
  return doc.segments.map((segment, i) => {
    const ms = wanted.get(segment.id);
    const previous = doc.segments[i - 1];
    if (ms === undefined || i === 0 || !previous) return 0;
    const half = Math.floor(Math.min(segmentOutputMs(previous), segmentOutputMs(segment)) / 2);
    return Math.max(0, Math.min(ms, half));
  });
}

const documentShape = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    canvas: canvasSchema,
    sources: z.array(sourceSchema).min(1).max(MAX_SOURCES),
    segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
    layout: layoutSchema,
    zooms: z.array(zoomSchema).max(MAX_ZOOMS),
    looks: looksSchema,
    fades: fadesSchema,
    tracks: z.array(trackSchema).max(MAX_TRACKS),
    /** Version 2: words bleeped or muted, in SOURCE time. Empty for most clips. */
    bleeps: z.array(bleepSchema).max(MAX_BLEEPS),
    /** Version 2: the recipe this clip was made with (a starter's id or a workspace recipe). Never drawn. */
    recipeId: idSchema.optional(),
    /**
     * Version 2 (Module 10): the brand kit applied to this clip (a Studio kit's
     * id: a uuid, or a readable one for kits seeded by hand). Never drawn on its own.
     */
    brandKitId: idSchema.optional(),
    /** Version 2 (Module 10): scenes drawn before and after the clip (see `cardSchema`). */
    cards: cardsSchema.optional(),
    /** Version 2 (Module 11): Fade joins between parts (a montage's Between Clips). Empty or absent: cuts. */
    joins: z.array(joinSchema).max(MAX_SEGMENTS).optional(),
    meta: documentMetaSchema.optional(),
    /** Module 17 item 18: blurred parts of the video. Absent: none. */
    blurs: z.array(blurSchema).max(MAX_BLURS).optional(),
  })
  .strict();

/**
 * The document, with the rules that need more than one field: references
 * resolve, ids are unique, parts are long enough, the clip's length is in
 * range, and the item, sound and sticker counts are under their caps (here,
 * so a save the editor's own Add checks never saw is refused too).
 */
export const clipDocumentSchema = documentShape.superRefine((doc, ctx) => {
  const sourceIds = new Set(doc.sources.map((s) => s.id));
  if (sourceIds.size !== doc.sources.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sources'],
      message: 'Source ids must be unique',
    });
  }

  const ids = new Set<string>();
  const claim = (id: string, path: (string | number)[]) => {
    if (ids.has(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `The id ${id} is used twice` });
    }
    ids.add(id);
  };

  let total = 0;
  doc.segments.forEach((segment, i) => {
    claim(segment.id, ['segments', i, 'id']);
    if (!sourceIds.has(segment.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments', i, 'source'],
        message: 'A part points at a video the clip does not have',
      });
    }
    const out = segmentOutputMs(segment);
    if (out < SEGMENT_MIN_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments', i],
        message: `A part must last at least ${SEGMENT_MIN_MS} ms`,
      });
    }
    total += out;
  });

  // Module 10: a brand intro opens the clip (a hook part may come before or after it) and an
  // outro closes it, each at most `BRAND_VIDEO_MAX_MS` long.
  let introMs = 0;
  let outroMs = 0;
  doc.segments.forEach((segment, i) => {
    const out = segmentOutputMs(segment);
    if (segment.role === 'intro') {
      introMs += out;
      if (doc.segments.slice(0, i).some((s) => s.role !== 'intro' && s.role !== 'hook')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segments', i, 'role'],
          message: 'An intro part plays at the start of the clip',
        });
      }
    } else if (segment.role === 'outro') {
      outroMs += out;
      if (doc.segments.slice(i + 1).some((s) => s.role !== 'outro')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segments', i, 'role'],
          message: 'An outro part plays at the end of the clip',
        });
      }
    }
  });
  if (introMs > BRAND_VIDEO_MAX_MS || outroMs > BRAND_VIDEO_MAX_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['segments'],
      message: `An intro or an outro lasts at most ${BRAND_VIDEO_MAX_MS / 1000} seconds`,
    });
  }

  // Module 11: Fade joins overlap their two sides, so the clip is shorter by each.
  total -= joinOverlaps(doc).reduce((sum, ms) => sum + ms, 0);

  if (total < CLIP_MIN_MS || total > CLIP_MAX_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['segments'],
      message: `A clip must last from ${CLIP_MIN_MS / 1000} seconds to ${CLIP_MAX_MS / 60_000} minutes`,
    });
  }

  doc.layout.areas.forEach((area, i) => {
    claim(area.id, ['layout', 'areas', i, 'id']);
  });

  (doc.blurs ?? []).forEach((blur, i) => {
    claim(blur.id, ['blurs', i, 'id']);
    if (!sourceIds.has(blur.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blurs', i, 'source'],
        message: 'A blur points at a video the clip does not have',
      });
    }
  });

  doc.bleeps.forEach((bleep, i) => {
    claim(bleep.id, ['bleeps', i, 'id']);
    if (!sourceIds.has(bleep.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bleeps', i, 'source'],
        message: 'A bleep points at a video the clip does not have',
      });
    }
  });

  // One set of captions, or (Module 11, a montage) one per source, each naming its own.
  const captionTracks = doc.tracks.filter((track) => track.kind === 'captions');
  if (captionTracks.length > 1) {
    const named = captionTracks.map((track) => track.source);
    if (
      named.some((source) => source === undefined || !sourceIds.has(source)) ||
      new Set(named).size !== named.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tracks'],
        message: 'A clip has one set of captions for each of its videos',
      });
    }
  } else if (captionTracks[0]?.source !== undefined && !sourceIds.has(captionTracks[0].source)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tracks'],
      message: 'Captions point at a video the clip does not have',
    });
  }

  const joined = new Set<string>();
  (doc.joins ?? []).forEach((join, i) => {
    // A join naming a part that is gone does nothing (`joinOverlaps`); twice on one part is refused.
    if (joined.has(join.beforeSegment)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['joins', i, 'beforeSegment'],
        message: 'A part has one join before it',
      });
    }
    joined.add(join.beforeSegment);
  });

  doc.zooms.forEach((zoom, i) => {
    claim(zoom.id, ['zooms', i, 'id']);
    if (!sourceIds.has(zoom.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['zooms', i, 'source'],
        message: 'A zoom points at a video the clip does not have',
      });
    }
  });

  let items = 0;
  let sounds = 0;
  let stickers = 0;
  doc.tracks.forEach((track, t) => {
    claim(track.id, ['tracks', t, 'id']);
    if (track.kind === 'captions') {
      return;
    }
    track.items.forEach((item, i) => {
      items += 1;
      if (track.kind === 'audio') sounds += 1;
      else if (item.type === 'sticker') stickers += 1;
      claim(item.id, ['tracks', t, 'items', i, 'id']);
      if (item.start + item.duration > total) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', t, 'items', i],
          message: 'An item must end by the end of the clip',
        });
      }
    });
  });

  if (items > MAX_ITEMS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tracks'],
      message: `A clip can hold up to ${MAX_ITEMS} texts, stickers and sounds`,
    });
  }
  if (sounds > MAX_SOUNDS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tracks'],
      message: `A clip can hold up to ${MAX_SOUNDS} sounds`,
    });
  }
  if (stickers > MAX_STICKERS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tracks'],
      message: `A clip can hold up to ${MAX_STICKERS} stickers`,
    });
  }
});

export type Rect = z.infer<typeof rectSchema>;
export type ClipCanvas = z.infer<typeof canvasSchema>;
export type ClipSource = z.infer<typeof sourceSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type CropKeyframe = z.infer<typeof cropKeyframeSchema>;
export type LayoutArea = z.infer<typeof areaSchema>;
export type ClipLayout = z.infer<typeof layoutSchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type Looks = z.infer<typeof looksSchema>;
export type Fades = z.infer<typeof fadesSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type TextItem = z.infer<typeof textItemSchema>;
export type StickerRef = z.infer<typeof stickerRefSchema>;
export type StickerItem = z.infer<typeof stickerItemSchema>;
export type SoundRef = z.infer<typeof soundRefSchema>;
export type AudioItem = z.infer<typeof audioItemSchema>;
export type OverlayTrack = z.infer<typeof overlayTrackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type CaptionsTrack = z.infer<typeof captionsTrackSchema>;
export type CaptionEdit = z.infer<typeof captionEditSchema>;
export type Bleep = z.infer<typeof bleepSchema>;
export type Blur = z.infer<typeof blurSchema>;
export type LayoutFollow = z.infer<typeof followSchema>;
export type FollowOverride = z.infer<typeof followOverrideSchema>;
export type SavedLayout = z.infer<typeof savedLayoutSchema>;
export type Track = z.infer<typeof trackSchema>;
export type OverlayItem = TextItem | StickerItem;
export type TimedItem = TextItem | StickerItem | AudioItem;
export type ClipDocumentMeta = z.infer<typeof documentMetaSchema>;
export type ClipCard = z.infer<typeof cardSchema>;
export type ClipCards = z.infer<typeof cardsSchema>;
export type ClipJoin = z.infer<typeof joinSchema>;
export type ClipDocument = z.infer<typeof clipDocumentSchema>;
