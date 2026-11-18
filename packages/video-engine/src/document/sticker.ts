/**
 * Stickers as data (Module 12): the sticker a tile adds, the frame a moving
 * sticker shows at a moment, and the Follow Badge's own layout.
 *
 * - A sticker's box (`widthPx` by `heightPx`, before `transform.scale`) is
 *   the picture's own shape; the picture fills it. A new one is a quarter of
 *   the canvas wide, centred, three seconds long.
 * - A moving sticker has a constant frame rate (the ingest and the upload
 *   check make it so): frame `k` starts `k / fps` after the item starts. A
 *   looping one wraps; one that plays once holds its last frame. The preview
 *   and the export both read `stickerFrameAt`, which is what FFmpeg's
 *   overlay picks from a stream shifted to start at the item's start.
 * - The Follow Badge has no file: a dark pill, a disc in the platform's
 *   colour with a play mark, "Follow On <Platform>" over the channel name.
 *   `badgeLayout` turns it into plain shapes and two ordinary texts, so the
 *   export draws it in the text layer (ASS) and the preview draws the same
 *   numbers. It names the platform in words and uses no platform's logo.
 */
import { outputDuration } from '../time/time-map';
import { ITEM_MIN_MS, STICKER_SIZE_MAX, STICKER_SIZE_MIN } from './limits';
import type { BadgePlatform, ClipDocument, StickerItem, StickerRef, TextItem } from './schema';

/** How long a new sticker lasts. */
export const DEFAULT_STICKER_MS = 3_000;
/** A new sticker's width, as a share of the canvas width. */
export const DEFAULT_STICKER_WIDTH_SHARE = 0.25;

/** The picture's size in pixels, for its shape. */
export interface StickerPictureSize {
  width: number;
  height: number;
}

function clampSize(value: number): number {
  return Math.min(STICKER_SIZE_MAX, Math.max(STICKER_SIZE_MIN, Math.round(value)));
}

/** A window of `wanted` ms at `atMs`, kept inside the clip. */
function windowAt(doc: ClipDocument, atMs: number, wanted: number): { start: number; duration: number } {
  const total = outputDuration(doc);
  const duration = Math.max(Math.min(ITEM_MIN_MS, total), Math.min(wanted, total));
  const at = Math.round(Number.isFinite(atMs) ? atMs : 0);
  return { start: Math.min(Math.max(0, at), Math.max(0, total - duration)), duration };
}

/**
 * The sticker a tile adds at `atMs`: centred, a quarter of the canvas wide in
 * the picture's own shape, three seconds, looping. `addItem` gives it its id.
 */
export function defaultStickerItem(
  doc: ClipDocument,
  atMs: number,
  ref: Exclude<StickerRef, { badge: BadgePlatform }>,
  picture: StickerPictureSize,
  id = 'stk_new',
): StickerItem {
  const aspect =
    picture.width > 0 && picture.height > 0 && Number.isFinite(picture.width / picture.height)
      ? picture.height / picture.width
      : 1;
  const widthPx = clampSize(doc.canvas.width * DEFAULT_STICKER_WIDTH_SHARE);
  return {
    id,
    type: 'sticker',
    ...windowAt(doc, atMs, DEFAULT_STICKER_MS),
    anchor: 'moment',
    ref,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    flipX: false,
    widthPx,
    heightPx: clampSize(widthPx * aspect),
    loop: true,
  };
}

/** The key one sticker file is fetched and cached by (`null` for the badge, which has none). */
export function stickerRefKey(ref: StickerRef): string | null {
  if ('library' in ref) return `library:${ref.id}`;
  if ('asset' in ref) return `asset:${ref.asset}`;
  return null;
}

/** A moving picture's timing: a constant frame rate and its frame count. */
export interface StickerAnimation {
  fps: number;
  frames: number;
}

/**
 * The frame a moving sticker shows `localMs` after its item started: frame
 * `k` covers `[k / fps, (k + 1) / fps)`, wrapping when it loops and holding
 * the last frame when it plays once. 0 for a still picture.
 */
export function stickerFrameAt(localMs: number, animation: StickerAnimation, loop: boolean): number {
  const { fps, frames } = animation;
  if (!(frames > 1) || !(fps > 0)) return 0;
  // The small nudge keeps a frame boundary that floating point lands just under on the right frame.
  const k = Math.floor((Math.max(0, localMs) * fps) / 1000 + 1e-6);
  return loop ? k % frames : Math.min(k, frames - 1);
}

// --- The Follow Badge -------------------------------------------------------------

/** The badge's shape on the canvas at scale 1, in canvas pixels. */
export const BADGE = Object.freeze({
  height: 140,
  /** The pill is fully round at both ends. */
  radius: 70,
  /** The dark pill. */
  fill: '#111111',
  fillOpacity: 0.92,
  /** The platform disc: its centre from the left and top, and its radius. */
  disc: { cx: 70, cy: 70, r: 50 },
  /** The words start here, from the left edge. */
  textLeft: 144,
  /** Room after the longest line. */
  padRight: 36,
  /** The narrowest a badge gets. */
  minWidth: 300,
  font: 'Inter',
  /** "Follow On Twitch". */
  small: { size: 30, weight: 600, opacity: 0.78, cy: 46 },
  /** The channel name. */
  name: { size: 48, weight: 800, opacity: 1, cy: 90 },
  colour: '#FFFFFF',
});

/** Each platform's name in words, its disc colour and the colour of the play mark on it. */
export const BADGE_PLATFORM_LOOK: Readonly<
  Record<BadgePlatform, { label: string; disc: string; mark: string }>
> = Object.freeze({
  twitch: { label: 'Twitch', disc: '#9146FF', mark: '#FFFFFF' },
  youtube: { label: 'YouTube', disc: '#FF0033', mark: '#FFFFFF' },
  kick: { label: 'Kick', disc: '#53FC18', mark: '#111111' },
  tiktok: { label: 'TikTok', disc: '#FE2C55', mark: '#FFFFFF' },
  instagram: { label: 'Instagram', disc: '#E1306C', mark: '#FFFFFF' },
});

/** The small line above the name: "Follow On Twitch". */
export function badgeSmallLine(platform: BadgePlatform): string {
  return `Follow On ${BADGE_PLATFORM_LOOK[platform].label}`;
}

/**
 * A rough width for a line of the badge's font, for when the browser cannot
 * measure (tests, a font still loading). The editor measures the real one.
 */
export function estimateBadgeTextWidth(text: string, sizePx: number, weight: number): number {
  const perChar = weight >= 700 ? 0.6 : 0.56;
  return [...text].length * sizePx * perChar;
}

/** The badge's width at scale 1 for its two lines' measured widths, in canvas pixels. */
export function badgeWidth(smallLinePx: number, nameLinePx: number): number {
  const widest = Math.max(0, smallLinePx, nameLinePx);
  return clampSize(Math.max(BADGE.minWidth, Math.ceil(BADGE.textLeft + widest + BADGE.padRight)));
}

/**
 * A new Follow Badge at `atMs`, `widthPx` wide (from `badgeWidth`): low on
 * the clip, three seconds. `addItem` gives it its id.
 */
export function defaultBadgeItem(
  doc: ClipDocument,
  atMs: number,
  platform: BadgePlatform,
  name: string,
  widthPx: number,
  id = 'stk_new',
): StickerItem {
  return {
    id,
    type: 'sticker',
    ...windowAt(doc, atMs, DEFAULT_STICKER_MS),
    anchor: 'moment',
    ref: { badge: platform, name: name.trim() },
    transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0, opacity: 1 },
    flipX: false,
    widthPx: clampSize(widthPx),
    heightPx: BADGE.height,
    loop: true,
  };
}

/** One plain shape of the badge, in canvas pixels after the item's scale. */
export interface BadgeShape {
  id: string;
  kind: 'pill' | 'disc' | 'mark';
  /** The shape's own centre on the canvas. */
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Corner radius (the pill's and the disc's); 0 for the mark. */
  radius: number;
  /** Degrees, clockwise positive: the badge's own turn. */
  rotationDeg: number;
  colour: string;
  opacity: number;
}

/** The badge as shapes (bottom first) and its two lines as ordinary texts. */
export interface BadgeLayout {
  shapes: BadgeShape[];
  texts: TextItem[];
}

/** The play mark's box inside the disc: a triangle pointing right, nudged right to look centred. */
const MARK = Object.freeze({ width: 38, height: 44, nudge: 4 });

/**
 * The Follow Badge as shapes and texts on the canvas. Every part turns with
 * the badge about the badge's centre: a part's centre is moved by the turn
 * and the part is turned about its own centre by the same angle, which is
 * the same picture. Opacity multiplies through.
 */
export function badgeLayout(
  item: StickerItem,
  canvas: { width: number; height: number },
  opacity = item.transform.opacity,
): BadgeLayout {
  if (!('badge' in item.ref)) return { shapes: [], texts: [] };
  const { badge: platform, name } = item.ref;
  const look = BADGE_PLATFORM_LOOK[platform];
  const { scale, rotation } = item.transform;
  const width = item.widthPx;
  const height = item.heightPx;
  const centreX = item.transform.x * canvas.width;
  const centreY = item.transform.y * canvas.height;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  /** A point of the unscaled badge (from its top left) on the canvas. */
  const place = (localX: number, localY: number): { x: number; y: number } => {
    const dx = (localX - width / 2) * scale;
    const dy = (localY - height / 2) * scale;
    return { x: centreX + dx * cos - dy * sin, y: centreY + dx * sin + dy * cos };
  };
  const shape = (
    id: string,
    kind: BadgeShape['kind'],
    localCx: number,
    localCy: number,
    w: number,
    h: number,
    radius: number,
    colour: string,
    alpha: number,
  ): BadgeShape => {
    const at = place(localCx, localCy);
    return {
      id: `${item.id}-${id}`,
      kind,
      cx: at.x,
      cy: at.y,
      width: w * scale,
      height: h * scale,
      radius: radius * scale,
      rotationDeg: rotation,
      colour,
      opacity: alpha,
    };
  };
  const radius = Math.min(BADGE.radius, height / 2, width / 2);
  const { disc } = BADGE;
  const shapes: BadgeShape[] = [
    shape('pill', 'pill', width / 2, height / 2, width, height, radius, BADGE.fill, BADGE.fillOpacity * opacity),
    shape('disc', 'disc', disc.cx, disc.cy, disc.r * 2, disc.r * 2, disc.r, look.disc, opacity),
    shape('mark', 'mark', disc.cx + MARK.nudge, disc.cy, MARK.width, MARK.height, 0, look.mark, opacity),
  ];

  const lineWidth = Math.max(40, width - BADGE.textLeft);
  const line = (id: string, text: string, spec: { size: number; weight: number; opacity: number; cy: number }): TextItem => {
    const at = place(BADGE.textLeft + lineWidth / 2, spec.cy);
    return {
      id: `${item.id}-${id}`,
      type: 'text',
      start: item.start,
      duration: item.duration,
      anchor: item.anchor,
      text,
      style: {
        font: BADGE.font,
        size: spec.size,
        weight: spec.weight,
        italic: false,
        colour: BADGE.colour,
        align: 'left',
        outline: null,
        background: null,
        shadow: false,
        uppercase: false,
      },
      transform: {
        x: at.x / canvas.width,
        y: at.y / canvas.height,
        scale,
        rotation,
        opacity: spec.opacity * opacity,
      },
      widthPx: lineWidth,
      fadeInMs: 0,
      fadeOutMs: 0,
    };
  };
  return {
    shapes,
    texts: [line('small', badgeSmallLine(platform), BADGE.small), line('name', name.trim(), BADGE.name)],
  };
}

/** Whether a sticker is the Follow Badge. */
export function isBadge(item: Pick<StickerItem, 'ref'>): item is Pick<StickerItem, 'ref'> & {
  ref: Extract<StickerRef, { badge: BadgePlatform }>;
} {
  return 'badge' in item.ref;
}
