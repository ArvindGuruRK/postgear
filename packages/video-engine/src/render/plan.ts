/**
 * `buildRenderPlan(doc, ctx)`: the frozen clip document plus the files the
 * worker fetched, turned into a plain JSON plan in output pixels.
 *
 * This is the one place fractions become pixels (cookbook rule 7): sizes to
 * the nearest even number, positions rounded (to even on the output picture,
 * where `pad` and `overlay` would round odd ones down by themselves). The
 * compiler only writes these numbers into filter text and never converts
 * again. Every geometry number comes from `frameState`, so the plan, the
 * preview and the parity tests share one definition.
 *
 * What this version can render: every layout (one to four areas, cover or
 * contain, rounded corners, a solid or blurred base) with constant crops,
 * any mix of speeds, segment volumes, text (Module 11), stickers and the
 * Follow Badge (Module 12), zooms, the look and the vignette (Module 13),
 * sound effects and music (Module 14), the clip's fades and the plan's mark.
 * Anything else (a moving crop, captions) is refused with a typed
 * `RenderCompileError`; a render never draws something other than the
 * document.
 *
 * No file access: the files are named by the caller (`ctx.assets`), relative
 * to the job's scratch folder.
 */
import { type ClipDocument, clipDocumentSchema, type Segment } from '../document/schema';
import { type ExportQuality, isExportQuality } from '../quality';
import { outputDuration, placeSegments } from '../time/time-map';
import { zoomWindows } from '../time/zooms';
import { RenderCompileError } from './errors';
import { type PlanCaptions, planCaptions, type RenderCaptionsAsset } from './caption-plan';
import { checkFonts, type FontManifest, fontsNeeded } from './fonts';
import { type PlanLook, planLook } from './looks';
import { type PlanSound, planSounds, type RenderSoundAsset } from './sound-plan';
import { type PlanSticker, planStickers, type RenderStickerAsset } from './sticker-plan';
import {
  type PlanShape,
  type PlanText,
  planShapes,
  planTexts,
  textFontFiles,
  textFontNames,
} from './text-plan';
import { cropIsConstant, effectiveFades, frameState, type SourcePicture } from './frame-state';
import { type EncodeSpec, encodeSpecFor, evenPosition, evenSize, outputSizeFor } from './specs';
import type { PlanZoom } from './zoom';

/** The file the worker has for one of the document's sources. */
export interface RenderSourceAsset {
  /** A plain relative name inside the scratch folder (the sharp range, or the light copy). */
  file: string;
  /** The video moment, in source ms, at which the file starts (0 for the light copy). */
  sourceOffsetMs: number;
  /** The file's length in ms. */
  durationMs: number;
  /** The file's picture size and frame rate (normalised at import: even, constant rate). */
  width: number;
  height: number;
  fps: number;
  /** False for a video with no sound: the compiler makes silence of the right length. */
  hasAudio: boolean;
}

/** The brand mark image (a PNG with its own soft outline, Module 15). */
export interface RenderWatermarkAsset {
  file: string;
  width: number;
  height: number;
}

/** The fonts folder and its manifest (`clips:fonts:build`). */
export interface RenderFontsAsset {
  /** A relative folder name inside the scratch folder, normally `fonts`. */
  dir: string;
  manifest: FontManifest;
}

export interface RenderAssets {
  /** Keyed by the document's source id. */
  sources: Readonly<Record<string, RenderSourceAsset>>;
  watermark?: RenderWatermarkAsset | null;
  fonts?: RenderFontsAsset | null;
  /** Sticker pictures, keyed by `stickerRefKey` (`library:<id>`, `asset:<id>`). */
  stickers?: Readonly<Record<string, RenderStickerAsset>> | null;
  /** Sound files (`.m4a`), keyed by `soundRefKey` (`library:<id>`, `asset:<id>`). */
  sounds?: Readonly<Record<string, RenderSoundAsset>> | null;
  /**
   * Sprint 13: the words and the style of the clip's captions, resolved by the
   * prepare step (nothing is fetched during a render). Needed exactly when the
   * document has a captions track.
   */
  captions?: RenderCaptionsAsset | null;
}

/** What the render job knows besides the document (copied from the job input and the fetched files). */
export interface RenderContext {
  quality: ExportQuality;
  /** Preview Export: the proof spec, whatever the quality. */
  proof: boolean;
  /** The plan's mark, decided by the server. */
  watermark: boolean;
  assets: RenderAssets;
}

/** A rectangle in whole pixels. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One `-i`: a run of segments that follow each other in the same file. */
export interface PlanInput {
  index: number;
  sourceId: string;
  file: string;
  /** Input seeking point in the file's own ms, or null to read from its start. */
  seekMs: number | null;
  hasAudio: boolean;
  /** How many segments read this input (more than one needs `split`). */
  segmentCount: number;
}

export type PlanBase =
  | { kind: 'colour'; colour: string }
  | {
      kind: 'blurred';
      /** The part of the source the base shows, in source pixels. */
      crop: PixelRect;
      /** The small size the base is blurred at (a tenth of the output, even). */
      smallWidth: number;
      smallHeight: number;
    };

/** One layout area of a segment, in output pixels. */
export interface PlanArea {
  id: string;
  /** The source pixels it shows (the crop narrowed to the frame's shape for cover). */
  crop: PixelRect;
  /** Its picture's size and top left corner on the output (even numbers). */
  width: number;
  height: number;
  x: number;
  y: number;
  /** Rounded corners in output pixels (whole, at most half the short side); 0 for square. */
  radius: number;
}

/** How one segment's picture is drawn on the output. */
export interface PlanPicture {
  base: PlanBase;
  /** The areas, bottom first. */
  areas: PlanArea[];
  /** True when the first area alone covers the whole output on a colour base, so no base is drawn. */
  fillsOutput: boolean;
}

export interface PlanSegment {
  id: string;
  index: number;
  inputIndex: number;
  /** The trim window in the opened input's own time (after any seek), whole ms. */
  trimStartMs: number;
  trimEndMs: number;
  speed: number;
  volume: number;
  /** Where the segment sits in the clip, whole ms (`outEndMs` exclusive). */
  outStartMs: number;
  outEndMs: number;
  picture: PlanPicture;
}

export interface PlanWatermark {
  inputIndex: number;
  file: string;
  width: number;
  height: number;
  x: number;
  y: number;
  opacity: number;
}

/** Everything the compiler needs, in output pixels and whole ms. Plain JSON. */
export interface RenderPlan {
  version: 1;
  quality: ExportQuality;
  proof: boolean;
  encode: EncodeSpec;
  output: { width: number; height: number; fps: number; durationMs: number };
  /** Output pixels per canvas pixel. */
  scale: number;
  inputs: PlanInput[];
  segments: PlanSegment[];
  fades: { inMs: number; outMs: number };
  /**
   * The zoom windows in clip ms with the focus in output pixels (Module 13):
   * one `perspective` each on the joined picture, before the look and the overlays.
   */
  zooms: PlanZoom[];
  /** The look and the vignette, drawn on the joined picture after the zoom (Module 13). */
  look: PlanLook;
  watermark: PlanWatermark | null;
  /** The document canvas: the ASS file's `PlayRes` (libass scales it to the output). */
  canvas: { width: number; height: number };
  /** Picture stickers, bottom first, in output pixels (Module 12), drawn after the layout. */
  stickers: PlanSticker[];
  /** Sound effects and music, in track order (Module 14), mixed over the video's own sound. */
  sounds: PlanSound[];
  /** Text items and the Follow Badges' lines, bottom first, in canvas pixels (Module 11). */
  texts: PlanText[];
  /** The Follow Badges' shapes, in canvas pixels, drawn in the same ASS file as the text. */
  shapes: PlanShape[];
  /** Sprint 13: the clip's captions as pages and font runs, or null when it has none. */
  captions: PlanCaptions | null;
  fonts: {
    dir: string | null;
    families: string[];
    /** The twins the texts use, which the worker copies into the fonts folder. */
    files: string[];
    /** Their PostScript names: a `fontselect:` line naming any other font is a fallback. */
    psNames: string[];
  };
}

/** Input seeking starts this long before a run, and `trim` cuts the rest exactly. */
export const SEEK_PREROLL_MS = 1_000;

/** The mark's width, as a fraction of the canvas width (Module 15). */
export const WATERMARK_WIDTH_FRACTION = 0.18;
/** The mark's margin from the right and bottom edges, as a fraction of the canvas width. */
export const WATERMARK_MARGIN_FRACTION = 0.04;
export const WATERMARK_OPACITY = 0.7;

const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/** A plain relative name: letters, digits, `.`, `_`, `-` and `/`; no `..`, no drive, no leading slash. */
export function isSafeRelativeName(name: string): boolean {
  return (
    name.length > 0 && name.length <= 200 && SAFE_NAME.test(name) && !name.split('/').includes('..')
  );
}

function positiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function checkSourceAsset(id: string, asset: RenderSourceAsset): void {
  const bad = (what: string): never => {
    throw new RenderCompileError('invalid_context', `Source ${id}: ${what}`, { sourceId: id });
  };
  if (!isSafeRelativeName(asset.file)) bad('the file must be a plain relative name');
  if (!Number.isInteger(asset.sourceOffsetMs) || asset.sourceOffsetMs < 0)
    bad('bad sourceOffsetMs');
  if (!positiveInt(asset.durationMs)) bad('bad durationMs');
  if (!positiveInt(asset.width) || !positiveInt(asset.height)) bad('bad picture size');
  if (!(asset.fps > 0) || !Number.isFinite(asset.fps)) bad('bad fps');
}

/** A fractional rectangle in pixels of a `width` by `height` picture: even size, rounded position, inside. */
function toPixels(
  rect: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): PixelRect {
  const maxW = width - (width % 2);
  const maxH = height - (height % 2);
  const w = Math.min(maxW, evenSize(rect.w * width));
  const h = Math.min(maxH, evenSize(rect.h * height));
  const x = Math.min(width - w, Math.max(0, Math.round(rect.x * width)));
  const y = Math.min(height - h, Math.max(0, Math.round(rect.y * height)));
  return { x, y, w, h };
}

/** Refuses what this version cannot draw, before any pixel is worked out. */
function refuseUnsupported(doc: ClipDocument): void {
  // Every layout renders (Module 10). A crop that moves over time needs the
  // `sendcmd` file of cookbook section 3, which Sprint 13 writes; until then
  // it is refused rather than drawn still.
  for (const area of doc.layout.areas) {
    if (!cropIsConstant(area.crop)) {
      throw new RenderCompileError(
        'crop_keyframes_unsupported',
        'A moving crop is not rendered yet',
        {
          areaId: area.id,
          keyframes: area.crop.length,
        },
      );
    }
  }
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Two segments play one after the other from the same stretch of the same video. */
function continues(prev: Segment | undefined, next: Segment): boolean {
  return prev !== undefined && prev.source === next.source && prev.sourceOut === next.sourceIn;
}

/**
 * The render plan for a frozen document. Throws `RenderCompileError` when the
 * document is invalid, an input is missing or does not cover the clip, a font
 * is missing, or the clip uses something this version cannot render yet.
 */
export function buildRenderPlan(document: ClipDocument, ctx: RenderContext): RenderPlan {
  const parsed = clipDocumentSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RenderCompileError('invalid_document', 'The clip document is not valid', {
      path: issue ? issue.path.join('.') : '',
      reason: issue ? issue.message : '',
    });
  }
  const doc = parsed.data;

  if (!isExportQuality(ctx.quality)) {
    throw new RenderCompileError('invalid_context', 'Unknown export quality', {
      quality: String(ctx.quality),
    });
  }

  // Fonts first: a family the manifest lacks would otherwise be drawn in another face.
  const families = fontsNeeded(doc);
  const fontsAsset = ctx.assets.fonts ?? null;
  if (families.length > 0) {
    const missing = checkFonts(fontsAsset?.manifest ?? null, families);
    if (missing.length > 0) {
      throw new RenderCompileError('font_missing', 'A font the clip uses is not installed', {
        families: missing.join(', '),
      });
    }
  }
  if (fontsAsset && !isSafeRelativeName(fontsAsset.dir)) {
    throw new RenderCompileError(
      'invalid_context',
      'The fonts folder must be a plain relative name',
    );
  }

  refuseUnsupported(doc);

  // Text and badges: every number in canvas pixels, the font resolved against the manifest the render has.
  const texts = planTexts(doc, fontsAsset?.manifest ?? null);
  const shapes = planShapes(doc);
  // Captions: the same canvas pixels, their fonts resolved the same way (Sprint 13).
  const planned = planCaptions(doc, ctx.assets.captions, fontsAsset?.manifest ?? null);
  // Captions with nothing to show (every word cut or hidden) draw nothing and need no font.
  const captions = planned && planned.layout.pages.length > 0 ? planned : null;

  const spec = encodeSpecFor(ctx.quality, ctx.proof);
  const size = outputSizeFor(doc.canvas, spec);
  const durationMs = outputDuration(doc);

  // Every source the segments name must be handed in and usable.
  const pictures: Record<string, SourcePicture> = {};
  for (const segment of doc.segments) {
    const asset = ctx.assets.sources[segment.source];
    if (!asset) {
      throw new RenderCompileError(
        'input_missing',
        'A video file the clip needs was not handed in',
        {
          sourceId: segment.source,
        },
      );
    }
    checkSourceAsset(segment.source, asset);
    pictures[segment.source] = { width: asset.width, height: asset.height, fps: asset.fps };
  }

  const inputs: PlanInput[] = [];
  const segments: PlanSegment[] = [];
  const placed = placeSegments(doc);
  let previous: Segment | undefined;
  let current: PlanInput | null = null;

  for (const entry of placed) {
    const segment = entry.segment;
    const asset = ctx.assets.sources[segment.source] as RenderSourceAsset;
    const fileIn = segment.sourceIn - asset.sourceOffsetMs;
    const fileOut = segment.sourceOut - asset.sourceOffsetMs;
    // One source frame of slack at the end: a probed length can be a frame short of the video's.
    const slack = Math.ceil(1000 / asset.fps);
    if (fileIn < 0 || fileOut > asset.durationMs + slack) {
      throw new RenderCompileError(
        'source_not_covered',
        'The video file does not hold this part of the clip',
        {
          segmentId: segment.id,
          sourceIn: segment.sourceIn,
          sourceOut: segment.sourceOut,
          fileFrom: asset.sourceOffsetMs,
          fileTo: asset.sourceOffsetMs + asset.durationMs,
        },
      );
    }

    if (!current || !continues(previous, segment)) {
      const seek = fileIn - SEEK_PREROLL_MS;
      current = {
        index: inputs.length,
        sourceId: segment.source,
        file: asset.file,
        seekMs: seek > 0 ? seek : null,
        hasAudio: asset.hasAudio,
        segmentCount: 0,
      };
      inputs.push(current);
    }
    current.segmentCount += 1;
    const seekMs = current.seekMs ?? 0;

    // The picture, from the one definition of what is on screen.
    const state = frameState(doc, entry.outStart, { sources: pictures });
    if (state.areas.length === 0) {
      throw new RenderCompileError('layout_unsupported', 'The layout has no area');
    }
    const areas: PlanArea[] = state.areas.map((area) => {
      const width = Math.min(size.width, evenSize(area.content.w * size.width));
      const height = Math.min(size.height, evenSize(area.content.h * size.height));
      const radius = Math.max(
        0,
        Math.min(Math.round(area.radius * size.scale), Math.floor(Math.min(width, height) / 2)),
      );
      return {
        id: area.id,
        crop: toPixels(area.visibleCrop, asset.width, asset.height),
        width,
        height,
        x: Math.min(size.width - width, evenPosition(area.content.x * size.width)),
        y: Math.min(size.height - height, evenPosition(area.content.y * size.height)),
        radius,
      };
    });
    const first = areas[0] as PlanArea;
    const fillsOutput =
      first.width === size.width &&
      first.height === size.height &&
      first.radius === 0 &&
      state.background.kind === 'colour';

    const base: PlanBase =
      state.background.kind === 'blurred'
        ? {
            kind: 'blurred',
            crop: toPixels(state.background.crop, asset.width, asset.height),
            smallWidth: evenSize(size.width / 10),
            smallHeight: evenSize(size.height / 10),
          }
        : { kind: 'colour', colour: state.background.colour };

    segments.push({
      id: segment.id,
      index: entry.index,
      inputIndex: current.index,
      trimStartMs: fileIn - seekMs,
      trimEndMs: fileOut - seekMs,
      speed: segment.speed,
      volume: segment.volume,
      outStartMs: entry.outStart,
      outEndMs: entry.outEnd,
      picture: { base, areas, fillsOutput },
    });
    previous = segment;
  }

  // Stickers read the inputs after the video's; the mark comes after them.
  const stickers = planStickers(
    doc,
    ctx.assets.stickers ?? {},
    { width: size.width, height: size.height, scale: size.scale, durationMs },
    inputs.length,
  );

  let watermark: PlanWatermark | null = null;
  if (ctx.watermark) {
    const mark = ctx.assets.watermark ?? null;
    if (!mark) {
      throw new RenderCompileError('input_missing', 'The mark image was not handed in', {
        input: 'watermark',
      });
    }
    if (!isSafeRelativeName(mark.file) || !positiveInt(mark.width) || !positiveInt(mark.height)) {
      throw new RenderCompileError('invalid_context', 'The mark image is not usable', {
        input: 'watermark',
      });
    }
    const markWidth = evenSize(WATERMARK_WIDTH_FRACTION * size.width);
    const markHeight = evenSize((markWidth * mark.height) / mark.width);
    const margin = Math.round(WATERMARK_MARGIN_FRACTION * size.width);
    watermark = {
      inputIndex: inputs.length + stickers.length,
      file: mark.file,
      width: markWidth,
      height: markHeight,
      x: evenPosition(size.width - markWidth - margin),
      y: evenPosition(size.height - markHeight - margin),
      opacity: WATERMARK_OPACITY,
    };
  }

  // Sounds read the inputs after the mark (or after the stickers when there is none).
  const sounds = planSounds(
    doc,
    ctx.assets.sounds ?? {},
    durationMs,
    inputs.length + stickers.length + (watermark ? 1 : 0),
  );

  // Zooms: the windows frameState reads, the focus in output pixels.
  const zooms: PlanZoom[] = zoomWindows(doc).map((window) => ({
    id: window.zoomId,
    startMs: window.startMs,
    endMs: window.endMs,
    easeMs: window.easeMs,
    scale: window.scale,
    focusX: roundTo(window.focus.x * size.width, 2),
    focusY: roundTo(window.focus.y * size.height, 2),
  }));

  return {
    version: 1,
    quality: ctx.quality,
    proof: ctx.proof,
    encode: spec,
    output: { width: size.width, height: size.height, fps: spec.fps, durationMs },
    scale: size.scale,
    inputs,
    segments,
    fades: effectiveFades(doc.fades, durationMs),
    zooms,
    look: planLook(doc.looks),
    watermark,
    canvas: { width: doc.canvas.width, height: doc.canvas.height },
    stickers,
    sounds,
    texts,
    shapes,
    captions,
    fonts: {
      dir: fontsAsset ? fontsAsset.dir : null,
      families: captions
        ? [...new Set([...families, captions.layout.look.font])].sort((a, b) =>
            a.localeCompare(b, 'en'),
          )
        : families,
      files: [
        ...new Set([
          ...(fontsAsset && texts.length > 0 ? textFontFiles(texts, fontsAsset.manifest) : []),
          ...(captions?.files ?? []),
        ]),
      ].sort(),
      psNames: [...new Set([...textFontNames(texts), ...(captions?.psNames ?? [])])].sort(),
    },
  };
}
