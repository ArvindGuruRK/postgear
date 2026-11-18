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
import { CANVAS_FPS, CANVASES, RATIOS } from '../canvas';
import {
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  FADE_MAX_MS,
  ITEM_MIN_MS,
  MAX_AREAS,
  MAX_CROP_KEYFRAMES,
  MAX_ITEMS,
  MAX_SEGMENTS,
  MAX_ZOOMS,
  SEGMENT_MIN_MS,
  SPEEDS,
  TEXT_MAX,
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

export const segmentSchema = z
  .object({
    id: idSchema,
    source: idSchema,
    sourceIn: msSchema,
    sourceOut: msSchema,
    speed: speedSchema,
    volume: z.number().min(0).max(VOLUME_MAX),
  })
  .strict()
  .refine((s) => s.sourceIn < s.sourceOut, 'A part must end after it starts');

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

export const layoutSchema = z
  .object({
    kind: z.enum(LAYOUT_KINDS),
    fitCrop: z.enum(FIT_CROPS).optional(),
    areas: z.array(areaSchema).min(1).max(MAX_AREAS),
  })
  .strict();

export const zoomSchema = z
  .object({
    id: idSchema,
    source: idSchema,
    /** Source time, like crops. */
    from: msSchema,
    to: msSchema,
    scale: z.number().min(1).max(ZOOM_MAX),
    /** The point zoomed into, a fraction of the area's picture. */
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
      .object({ colour: hexColour, opacity: unit, radius: z.number().min(0).max(200) })
      .strict()
      .nullable(),
    shadow: z.boolean(),
    uppercase: z.boolean(),
  })
  .strict();

export const textItemSchema = z
  .object({
    ...itemBase,
    type: z.literal('text'),
    text: z.string().min(1).max(TEXT_MAX),
    style: textStyleSchema,
    transform: transformSchema,
  })
  .strict();

/** A library item, or the workspace's own upload: never both. */
export const stickerRefSchema = z.union([
  z.object({ library: z.literal('sticker'), id: uuidSchema }).strict(),
  z.object({ asset: uuidSchema }).strict(),
]);

export const stickerItemSchema = z
  .object({
    ...itemBase,
    type: z.literal('sticker'),
    ref: stickerRefSchema,
    transform: transformSchema,
    flipX: z.boolean(),
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

/** Reserved for Sprint 13: parses, so its documents stay valid here; nothing in Sprint 12 writes one. */
export const captionsTrackSchema = z
  .object({
    id: idSchema,
    kind: z.literal('captions'),
    transcriptAssetId: uuidSchema,
    style: z.record(z.unknown()),
  })
  .strict();

export const trackSchema = z.discriminatedUnion('kind', [
  overlayTrackSchema,
  audioTrackSchema,
  captionsTrackSchema,
]);

export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Output length of one part, rounded once. `time/time-map.ts` builds on this. */
export function segmentOutputMs(segment: {
  sourceIn: number;
  sourceOut: number;
  speed: number;
}): number {
  return Math.round((segment.sourceOut - segment.sourceIn) / segment.speed);
}

const documentShape = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    canvas: canvasSchema,
    sources: z.array(sourceSchema).min(1).max(8),
    segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
    layout: layoutSchema,
    zooms: z.array(zoomSchema).max(MAX_ZOOMS),
    looks: looksSchema,
    fades: fadesSchema,
    tracks: z.array(trackSchema).max(16),
  })
  .strict();

/**
 * The document, with the rules that need more than one field: references
 * resolve, ids are unique, parts are long enough, the clip's length is in
 * range and the item count is under the cap.
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
  doc.tracks.forEach((track, t) => {
    claim(track.id, ['tracks', t, 'id']);
    if (track.kind === 'captions') {
      return;
    }
    track.items.forEach((item, i) => {
      items += 1;
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
export type Track = z.infer<typeof trackSchema>;
export type OverlayItem = TextItem | StickerItem;
export type TimedItem = TextItem | StickerItem | AudioItem;
export type ClipDocument = z.infer<typeof clipDocumentSchema>;
