/**
 * `frameState(doc, outputMs)`: the one definition of what is on screen at a
 * moment of the clip.
 *
 * The browser preview draws from it with CSS, `buildRenderPlan` turns its
 * fractions into FFmpeg pixels, and the parity tests compare rendered frames
 * with it, so the three cannot quietly disagree. Nothing else in the code
 * base works out a crop, a zoom, a position or a gain on its own.
 *
 * Rules (cookbook section 12):
 * - The segment and source moment come from the time map (`toSource`).
 * - Crops are keyed in source time, interpolated linearly between keyframes,
 *   held before the first and after the last, and read at the time of the
 *   source frame actually shown: `floor(sourceMs x fps / 1000)` (at 0.5x a
 *   source frame is shown twice, so reading the crop at the output time would
 *   be up to a frame of motion off). The parity test checks it frame by frame
 *   against FFmpeg through seeks and speeds.
 * - Cover fit narrows the crop to the frame's shape about its centre; contain
 *   fit keeps the whole crop and centres it inside the frame.
 * - Zooms are keyed in source time but ease in output milliseconds:
 *   `z = 1 + (S - 1) x u x u x (3 - 2u)`, `u` the smoothstep ramp at each end.
 * - Fades multiply, as two `fade` filters in a row do.
 * - Overlay items and sounds sit in output time, in the window
 *   `[start, start + duration)`.
 *
 * Pure and cheap: numbers in, numbers out, no allocation beyond the answer.
 * The preview calls it on every frame.
 */
import type {
  AudioItem,
  ClipDocument,
  CropKeyframe,
  LayoutArea,
  LayoutKind,
  Looks,
  StickerItem,
  TextItem,
} from '../document/schema';
import { FULL_RECT, fitRect, type Point, type Rect, rectAspect } from '../geometry';
import { frameToMs, outputDuration, segmentAt, toSource } from '../time/time-map';

/** What the caller knows about a source's picture (from the file it plays or renders). */
export interface SourcePicture {
  /** Pixels of the picture, to keep crops true to shape. */
  width: number;
  height: number;
  /** Frames a second, to read crops at the shown frame. */
  fps: number;
}

export interface FrameStateOptions {
  /**
   * Facts about each source, keyed by the document's source id. Without them
   * the crop is read at the exact source moment and taken to have the frame's
   * shape already (the layout presets make it so).
   */
  sources?: Readonly<Record<string, SourcePicture>>;
}

/** The part of the video playing, and where in it. */
export interface SegmentState {
  id: string;
  index: number;
  sourceId: string;
  speed: number;
  volume: number;
  /** Where the segment sits in the clip, in ms (`outEnd` exclusive). */
  outStart: number;
  outEnd: number;
  /** The video moment at this output moment, in whole ms of source time. */
  sourceMs: number;
  /** The source frame shown, or null when the frame rate is not known. */
  sourceFrame: number | null;
  /** The start of that frame in whole ms of source time (`sourceMs` when the rate is unknown). */
  shownSourceMs: number;
}

/** One layout area at this moment. Every rectangle is a fraction. */
export interface AreaState {
  id: string;
  name: string;
  fit: 'cover' | 'contain';
  /** Rounded corners in canvas pixels (the 1080 short side); 0 for none. */
  radius: number;
  /** Where the area sits on the canvas. */
  frame: Rect;
  /** The crop the document asks for at the shown frame, a fraction of the video. */
  crop: Rect;
  /** The part of the video actually drawn (the crop narrowed to the frame's shape for cover). */
  visibleCrop: Rect;
  /** Where the picture lands on the canvas (the frame for cover; centred inside it for contain). */
  content: Rect;
}

export type BackgroundState =
  | { kind: 'colour'; colour: string }
  /** The whole video, cover-fitted to the canvas, blurred. */
  | { kind: 'blurred'; crop: Rect };

export interface ZoomState {
  /** 1 when no zoom is on. */
  scale: number;
  /** The point that stays still, as the document stores it (a fraction, 0 to 1). */
  focus: Point;
  zoomId: string | null;
}

export interface OverlayState {
  id: string;
  trackId: string;
  type: 'text' | 'sticker';
  /** The item's centre, a fraction of the canvas. */
  centre: Point;
  /** 1 is the item's natural size on the 1080 canvas. */
  scale: number;
  /** Degrees, clockwise positive (CSS `rotate`, FFmpeg `rotate`; ASS writes `\frz` as minus this). */
  rotationDeg: number;
  /** The item's own opacity, 0 to 1 (the clip's fade is separate, in `fadeOpacity`). */
  opacity: number;
  flipX: boolean;
  /** Milliseconds since the item started (an animated sticker's clock). */
  localMs: number;
  startMs: number;
  endMs: number;
}

export interface SoundState {
  id: string;
  trackId: string;
  type: 'sfx' | 'music';
  /** Linear gain: volume, the item's own fades and the clip's fade. */
  gain: number;
  /** Where in the sound file playback is, in ms. */
  fileMs: number;
}

export interface FrameState {
  /** The moment asked for, clamped into the clip and rounded to a whole ms. */
  outputMs: number;
  durationMs: number;
  canvas: { width: number; height: number; background: string };
  layoutKind: LayoutKind;
  segment: SegmentState;
  background: BackgroundState;
  areas: AreaState[];
  zoom: ZoomState;
  looks: Looks;
  /** The clip's fade in and out, 0 (black, silent) to 1. */
  fadeOpacity: number;
  /** The video's own sound: the segment's volume times the fade. */
  videoGain: number;
  /** Visible overlay items, bottom first. */
  overlays: OverlayState[];
  /** Sounds playing, in track order. */
  sounds: SoundState[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The crop at a moment of source time: linear between keyframes, held
 * before the first and after the last.
 */
export function cropAt(keyframes: readonly CropKeyframe[], sourceMs: number): Rect {
  const first = keyframes[0];
  if (!first) {
    return { ...FULL_RECT };
  }
  if (sourceMs <= first.at || keyframes.length === 1) {
    return { ...first.rect };
  }
  for (let i = 1; i < keyframes.length; i += 1) {
    const next = keyframes[i] as CropKeyframe;
    if (sourceMs < next.at) {
      const prev = keyframes[i - 1] as CropKeyframe;
      const t = (sourceMs - prev.at) / (next.at - prev.at);
      return {
        x: lerp(prev.rect.x, next.rect.x, t),
        y: lerp(prev.rect.y, next.rect.y, t),
        w: lerp(prev.rect.w, next.rect.w, t),
        h: lerp(prev.rect.h, next.rect.h, t),
      };
    }
  }
  return { ...(keyframes[keyframes.length - 1] as CropKeyframe).rect };
}

/** Whether every keyframe holds the same rectangle, so the crop never moves. */
export function cropIsConstant(keyframes: readonly CropKeyframe[]): boolean {
  const first = keyframes[0];
  if (!first) {
    return true;
  }
  return keyframes.every(
    (k) =>
      k.rect.x === first.rect.x &&
      k.rect.y === first.rect.y &&
      k.rect.w === first.rect.w &&
      k.rect.h === first.rect.h,
  );
}

/**
 * Where an area's picture comes from and where it lands, for a crop.
 * `sourceAspect` is the video's real width over height (null when unknown),
 * `canvasAspect` the canvas's.
 */
export function placeArea(
  area: Pick<LayoutArea, 'frame' | 'fit'>,
  crop: Rect,
  sourceAspect: number | null,
  canvasAspect: number,
): { visibleCrop: Rect; content: Rect } {
  const frame = area.frame;
  if (sourceAspect === null || !(sourceAspect > 0)) {
    return { visibleCrop: { ...crop }, content: { ...frame } };
  }
  if (area.fit === 'cover') {
    const frameAspect = rectAspect(frame, canvasAspect);
    return { visibleCrop: fitRect(frameAspect, crop, sourceAspect), content: { ...frame } };
  }
  const cropAspect = rectAspect(crop, sourceAspect);
  return { visibleCrop: { ...crop }, content: fitRect(cropAspect, frame, canvasAspect) };
}

/** The Blurred layout's base: the whole video, cover-fitted to the canvas. */
export function blurredBaseCrop(sourceAspect: number | null, canvasAspect: number): Rect {
  if (sourceAspect === null || !(sourceAspect > 0)) {
    return { ...FULL_RECT };
  }
  return fitRect(canvasAspect, FULL_RECT, sourceAspect);
}

/** The smoothstep zoom scale at `t` for a window `[a, b)` with an ease, all output ms. */
export function zoomScaleAt(t: number, a: number, b: number, easeMs: number, peak: number): number {
  if (t < a || t >= b) {
    return 1;
  }
  const u = easeMs > 0 ? Math.min(clamp((t - a) / easeMs, 0, 1), clamp((b - t) / easeMs, 0, 1)) : 1;
  return 1 + (peak - 1) * u * u * (3 - 2 * u);
}

/**
 * The fades a clip of `durationMs` really gets: each is cut to the clip's
 * length (a 5 second fade on a 3 second clip fades over 3 seconds), so the
 * compiler's `fade=...:st=` never goes below zero. The compiler and
 * `fadeAt` both read this.
 */
export function effectiveFades(
  fades: { inMs: number; outMs: number },
  durationMs: number,
): { inMs: number; outMs: number } {
  const limit = Math.max(0, durationMs);
  return {
    inMs: clamp(Math.round(fades.inMs), 0, limit),
    outMs: clamp(Math.round(fades.outMs), 0, limit),
  };
}

/**
 * The clip's fade at `t`: fade in from black over `inMs`, out to black over
 * the last `outMs`, multiplied as two FFmpeg `fade` filters are.
 */
export function fadeAt(t: number, durationMs: number, inMs: number, outMs: number): number {
  const fades = effectiveFades({ inMs, outMs }, durationMs);
  const fadeIn = fades.inMs > 0 ? clamp(t / fades.inMs, 0, 1) : 1;
  const fadeOut = fades.outMs > 0 ? clamp((durationMs - t) / fades.outMs, 0, 1) : 1;
  return fadeIn * fadeOut;
}

function itemGain(item: AudioItem, localMs: number): number {
  const fadeIn = item.fadeInMs > 0 ? clamp(localMs / item.fadeInMs, 0, 1) : 1;
  const fadeOut = item.fadeOutMs > 0 ? clamp((item.duration - localMs) / item.fadeOutMs, 0, 1) : 1;
  return item.volume * fadeIn * fadeOut;
}

function overlayState(item: TextItem | StickerItem, trackId: string, t: number): OverlayState {
  return {
    id: item.id,
    trackId,
    type: item.type,
    centre: { x: item.transform.x, y: item.transform.y },
    scale: item.transform.scale,
    rotationDeg: item.transform.rotation,
    opacity: item.transform.opacity,
    flipX: item.type === 'sticker' ? item.flipX : false,
    localMs: t - item.start,
    startMs: item.start,
    endMs: item.start + item.duration,
  };
}

/**
 * Everything on screen at `outputMs`. A moment before the clip reads as its
 * start, a moment after it as its end (where the last frame stays).
 *
 * `outputMs` may be fractional (the exact time of output frame n is
 * `n x 1000 / fps`; the preview's media clock is fractional too): the source
 * frame is read from it as given, everything else from the nearest whole
 * millisecond, which is also the `outputMs` the answer reports.
 */
export function frameState(
  doc: ClipDocument,
  outputMs: number,
  options: FrameStateOptions = {},
): FrameState {
  const durationMs = outputDuration(doc);
  const exact = clamp(Number.isFinite(outputMs) ? outputMs : 0, 0, durationMs);
  const t = Math.round(exact);

  // A document always has a segment, so neither lookup is null inside [0, duration].
  const placed = segmentAt(doc, t);
  const moment = toSource(doc, t);
  if (!placed || !moment) {
    throw new Error('frameState needs a document with at least one segment');
  }
  const segment = placed.segment;
  const facts = options.sources?.[segment.source];
  const fps = facts && facts.fps > 0 ? facts.fps : null;
  // The frame is read from the unrounded moment: output frame n of a 30 fps
  // render is at 33.33 ms, which a whole millisecond (33) would put inside the
  // previous source frame for one frame in three.
  const exactSourceMs = clamp(
    segment.sourceIn + (exact - placed.outStart) * segment.speed,
    segment.sourceIn,
    segment.sourceOut,
  );
  const sourceFrame = fps === null ? null : Math.floor((exactSourceMs * fps) / 1000 + 1e-6);
  const shownSourceMs =
    fps === null || sourceFrame === null ? moment.sourceMs : frameToMs(sourceFrame, fps);

  const canvasAspect = doc.canvas.width / doc.canvas.height;
  const sourceAspect =
    facts && facts.width > 0 && facts.height > 0 ? facts.width / facts.height : null;

  const areas: AreaState[] = doc.layout.areas.map((area) => {
    const crop = cropAt(area.crop, shownSourceMs);
    const { visibleCrop, content } = placeArea(area, crop, sourceAspect, canvasAspect);
    return {
      id: area.id,
      name: area.name,
      fit: area.fit,
      radius: area.radius ?? 0,
      frame: { ...area.frame },
      crop,
      visibleCrop,
      content,
    };
  });

  const background: BackgroundState =
    doc.layout.kind === 'blurred'
      ? { kind: 'blurred', crop: blurredBaseCrop(sourceAspect, canvasAspect) }
      : { kind: 'colour', colour: doc.canvas.background };

  // Zooms: source-time windows mapped through the playing segment, eased in output ms.
  let zoom: ZoomState = { scale: 1, focus: { x: 0.5, y: 0.5 }, zoomId: null };
  for (const z of doc.zooms) {
    if (z.source !== segment.source) {
      continue;
    }
    const a = placed.outStart + (z.from - segment.sourceIn) / segment.speed;
    const b = placed.outStart + (z.to - segment.sourceIn) / segment.speed;
    const scale = zoomScaleAt(t, a, b, z.ease, z.scale);
    if (scale > zoom.scale) {
      zoom = { scale, focus: { x: z.focus.x, y: z.focus.y }, zoomId: z.id };
    }
  }

  const fadeOpacity = fadeAt(t, durationMs, doc.fades.inMs, doc.fades.outMs);

  const overlays: OverlayState[] = [];
  const sounds: SoundState[] = [];
  for (const track of doc.tracks) {
    if (track.kind === 'overlay') {
      for (const item of track.items) {
        if (t >= item.start && t < item.start + item.duration) {
          overlays.push(overlayState(item, track.id, t));
        }
      }
    } else if (track.kind === 'audio') {
      for (const item of track.items) {
        if (t >= item.start && t < item.start + item.duration) {
          const localMs = t - item.start;
          sounds.push({
            id: item.id,
            trackId: track.id,
            type: item.type,
            gain: itemGain(item, localMs) * fadeOpacity,
            fileMs: item.offsetMs + localMs,
          });
        }
      }
    }
  }

  return {
    outputMs: t,
    durationMs,
    canvas: {
      width: doc.canvas.width,
      height: doc.canvas.height,
      background: doc.canvas.background,
    },
    layoutKind: doc.layout.kind,
    segment: {
      id: segment.id,
      index: placed.index,
      sourceId: segment.source,
      speed: segment.speed,
      volume: segment.volume,
      outStart: placed.outStart,
      outEnd: placed.outEnd,
      sourceMs: moment.sourceMs,
      sourceFrame,
      shownSourceMs,
    },
    background,
    areas,
    zoom,
    looks: { ...doc.looks },
    fadeOpacity,
    videoGain: segment.volume * fadeOpacity,
    overlays,
    sounds,
  };
}
