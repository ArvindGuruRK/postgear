/**
 * The seven layouts, as data.
 *
 * `LAYOUT_PRESETS[kind][ratio]` lists a preset's areas: a name, a frame on
 * the canvas (fractions, 0 to 1), a fit, an optional corner radius and the
 * rule that places its first crop on the video, plus the base drawn behind
 * them. Nothing here is code: `applyLayout` (in `edit.ts`) reads the table,
 * the Layouts panel draws its tiles from it, and a ratio a kind has no entry
 * for is a ratio the panel cannot offer it on.
 *
 * - Vertical (9:16), Square (1:1) and 4:5 get all seven.
 * - Horizontal (16:9) gets Fullscreen and Blurred only (story CL-6.1).
 * - Areas are listed bottom first: the Gameplay and Screen Share camera boxes
 *   come last so they are drawn over the game.
 * - Radii are canvas pixels on the 1080 short side, as the document stores
 *   them (about 3 to 4 percent of the width); the render multiplies them by
 *   the export's scale once.
 *
 * The figures follow the cookbook's verified layouts (research 09, section
 * 2): Gameplay's camera is a square box about 36 percent of the width with a
 * 36 px radius at (0.04, 0.03); Screen Share is a 16:9 band over a 4:3
 * rounded camera on a blurred base.
 */
import type { Ratio } from '../canvas';
import type { LayoutBase, LayoutKind } from '../document/schema';
import type { Rect } from '../geometry';

/** The kinds a preset exists for: every kind but `custom`. */
export const PRESET_KINDS = [
  'fullscreen',
  'blurred',
  'split',
  'three',
  'four',
  'gameplay',
  'screen_share',
] as const satisfies readonly LayoutKind[];
export type PresetKind = (typeof PRESET_KINDS)[number];

/** What each preset is called in the Layouts panel (Title Case, as names are). */
export const PRESET_LABELS: Readonly<Record<PresetKind, string>> = Object.freeze({
  fullscreen: 'Fullscreen',
  blurred: 'Blurred',
  split: 'Split',
  three: 'Three',
  four: 'Four',
  gameplay: 'Gameplay',
  screen_share: 'Screen Share',
});

/**
 * Where an area's first crop goes on the video. Every rule gives a crop of
 * the frame's shape (cover) or the picture to show whole (contain), so
 * nothing is ever stretched.
 *
 * - `centre`: the largest crop of the frame's shape, centred on the video.
 * - `region`: the largest crop of the frame's shape inside `region` (a
 *   fraction of the video), centred in it: Three and Four take a half or a
 *   quarter of the video each.
 * - `face_cam`: a typical face camera in the video's lower left corner,
 *   `FACE_CAM_HEIGHT` of the video tall (Split, Gameplay, Screen Share).
 * - `fit`: the whole video, or the centred Fit crop ratio part of it (the
 *   Blurred layout's contain area).
 */
export type CropRule =
  | { rule: 'centre' }
  | { rule: 'region'; region: Rect }
  | { rule: 'face_cam' }
  | { rule: 'fit' };

export interface PresetArea {
  name: string;
  frame: Rect;
  fit: 'cover' | 'contain';
  /** Rounded corners in canvas pixels (the 1080 short side); absent for square corners. */
  radius?: number;
  crop: CropRule;
}

export interface LayoutPreset {
  kind: PresetKind;
  ratio: Ratio;
  base: LayoutBase;
  areas: readonly PresetArea[];
}

/** How tall a face camera usually is in a stream, as a fraction of the video's height. */
export const FACE_CAM_HEIGHT = 0.4;

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
const CENTRE: CropRule = { rule: 'centre' };
const FACE_CAM: CropRule = { rule: 'face_cam' };
const LEFT_HALF: CropRule = { rule: 'region', region: { x: 0, y: 0, w: 0.5, h: 1 } };
const RIGHT_HALF: CropRule = { rule: 'region', region: { x: 0.5, y: 0, w: 0.5, h: 1 } };

/** The Gameplay camera's corner radius, canvas pixels (cookbook section 2). */
const GAMEPLAY_RADIUS = 36;
/** The Screen Share camera's corner radius, canvas pixels. */
const SCREEN_SHARE_RADIUS = 40;

function fullscreen(ratio: Ratio): LayoutPreset {
  return {
    kind: 'fullscreen',
    ratio,
    base: 'solid',
    areas: [{ name: 'Video', frame: FULL, fit: 'cover', crop: CENTRE }],
  };
}

function blurred(ratio: Ratio): LayoutPreset {
  return {
    kind: 'blurred',
    ratio,
    base: 'blurred',
    areas: [{ name: 'Video', frame: FULL, fit: 'contain', crop: { rule: 'fit' } }],
  };
}

/** Camera on top (`cameraH` of the height), Content below. */
function split(ratio: Ratio, cameraH: number): LayoutPreset {
  return {
    kind: 'split',
    ratio,
    base: 'solid',
    areas: [
      { name: 'Camera', frame: { x: 0, y: 0, w: 1, h: cameraH }, fit: 'cover', crop: FACE_CAM },
      {
        name: 'Content',
        frame: { x: 0, y: cameraH, w: 1, h: 1 - cameraH },
        fit: 'cover',
        crop: CENTRE,
      },
    ],
  };
}

function three(ratio: Ratio): LayoutPreset {
  return {
    kind: 'three',
    ratio,
    base: 'solid',
    areas: [
      { name: 'Top', frame: { x: 0, y: 0, w: 1, h: 0.5 }, fit: 'cover', crop: CENTRE },
      { name: 'Left', frame: { x: 0, y: 0.5, w: 0.5, h: 0.5 }, fit: 'cover', crop: LEFT_HALF },
      { name: 'Right', frame: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, fit: 'cover', crop: RIGHT_HALF },
    ],
  };
}

function four(ratio: Ratio): LayoutPreset {
  const quarter = (x: number, y: number): CropRule => ({
    rule: 'region',
    region: { x, y, w: 0.5, h: 0.5 },
  });
  return {
    kind: 'four',
    ratio,
    base: 'solid',
    areas: [
      {
        name: 'Top Left',
        frame: { x: 0, y: 0, w: 0.5, h: 0.5 },
        fit: 'cover',
        crop: quarter(0, 0),
      },
      {
        name: 'Top Right',
        frame: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        fit: 'cover',
        crop: quarter(0.5, 0),
      },
      {
        name: 'Bottom Left',
        frame: { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        fit: 'cover',
        crop: quarter(0, 0.5),
      },
      {
        name: 'Bottom Right',
        frame: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        fit: 'cover',
        crop: quarter(0.5, 0.5),
      },
    ],
  };
}

/** The game fills the canvas; the square camera box sits near the top left, over it. */
function gameplay(ratio: Ratio, camera: Rect): LayoutPreset {
  return {
    kind: 'gameplay',
    ratio,
    base: 'solid',
    areas: [
      { name: 'Game', frame: FULL, fit: 'cover', crop: CENTRE },
      { name: 'Camera', frame: camera, fit: 'cover', radius: GAMEPLAY_RADIUS, crop: FACE_CAM },
    ],
  };
}

/** A 16:9 screen band in the upper part, a 4:3 rounded camera below it, on a blurred base. */
function screenShare(ratio: Ratio, screen: Rect, camera: Rect): LayoutPreset {
  return {
    kind: 'screen_share',
    ratio,
    base: 'blurred',
    areas: [
      { name: 'Screen', frame: screen, fit: 'cover', crop: CENTRE },
      { name: 'Camera', frame: camera, fit: 'cover', radius: SCREEN_SHARE_RADIUS, crop: FACE_CAM },
    ],
  };
}

/*
 * Frame figures, canvas pixels in brackets.
 * 9:16 (1080 x 1920): Split camera 0.375 (720); Gameplay camera 0.36 wide
 *   (389 x 389); Screen 1080 x 607.5 at y 192, Camera 864 x 648 at y 883.
 * 1:1 (1080 x 1080): Split halves; Gameplay camera 0.32 (346); Screen 972 x
 *   547 at (54, 43), Camera 547 x 410 below it.
 * 4:5 (1080 x 1350): Split camera 0.4 (540); Gameplay camera 0.34 wide (367);
 *   Screen 1080 x 607.5 at y 81, Camera 648 x 486 at y 756.
 */
const VERTICAL_CAMERA_H = (0.36 * 1080) / 1920;
const PORTRAIT_CAMERA_H = (0.34 * 1080) / 1350;

export const LAYOUT_PRESETS: Readonly<
  Record<PresetKind, Readonly<Partial<Record<Ratio, LayoutPreset>>>>
> = Object.freeze({
  fullscreen: {
    '9:16': fullscreen('9:16'),
    '16:9': fullscreen('16:9'),
    '1:1': fullscreen('1:1'),
    '4:5': fullscreen('4:5'),
  },
  blurred: {
    '9:16': blurred('9:16'),
    '16:9': blurred('16:9'),
    '1:1': blurred('1:1'),
    '4:5': blurred('4:5'),
  },
  split: { '9:16': split('9:16', 0.375), '1:1': split('1:1', 0.5), '4:5': split('4:5', 0.4) },
  three: { '9:16': three('9:16'), '1:1': three('1:1'), '4:5': three('4:5') },
  four: { '9:16': four('9:16'), '1:1': four('1:1'), '4:5': four('4:5') },
  gameplay: {
    '9:16': gameplay('9:16', { x: 0.04, y: 0.03, w: 0.36, h: VERTICAL_CAMERA_H }),
    '1:1': gameplay('1:1', { x: 0.04, y: 0.04, w: 0.32, h: 0.32 }),
    '4:5': gameplay('4:5', { x: 0.04, y: 0.032, w: 0.34, h: PORTRAIT_CAMERA_H }),
  },
  screen_share: {
    '9:16': screenShare(
      '9:16',
      { x: 0, y: 0.1, w: 1, h: 607.5 / 1920 },
      { x: 0.1, y: 0.46, w: 0.8, h: 648 / 1920 },
    ),
    '1:1': screenShare(
      '1:1',
      { x: 0.05, y: 0.04, w: 0.9, h: 0.50625 },
      { x: (1 - 0.38 * (4 / 3)) / 2, y: 0.58, w: 0.38 * (4 / 3), h: 0.38 },
    ),
    '4:5': screenShare(
      '4:5',
      { x: 0, y: 0.06, w: 1, h: 607.5 / 1350 },
      { x: 0.2, y: 0.56, w: 0.6, h: 486 / 1350 },
    ),
  },
});

/** The preset for a kind at a ratio, or null when that shape does not offer it. */
export function presetFor(kind: LayoutKind, ratio: Ratio): LayoutPreset | null {
  if (kind === 'custom') {
    return null;
  }
  return LAYOUT_PRESETS[kind][ratio] ?? null;
}

/** The kinds a shape offers, in the panel's order: all seven, or two for Horizontal. */
export function layoutsFor(ratio: Ratio): PresetKind[] {
  return PRESET_KINDS.filter((kind) => LAYOUT_PRESETS[kind][ratio] !== undefined);
}

/** Whether a shape offers a kind (`custom` is offered everywhere: it is whatever the person made). */
export function isLayoutOffered(kind: LayoutKind, ratio: Ratio): boolean {
  return kind === 'custom' || presetFor(kind, ratio) !== null;
}
