/**
 * Looks (Module 13): one colour look for the whole clip, its strength, a
 * vignette and the numbers both drawings read.
 *
 * - Every look is one colour matrix with an offset (`LookMatrix`): each
 *   output channel is `r x a + g x b + b x c + o`, clamped once at the end,
 *   in plain sRGB. The export writes it as `colorchannelmixer` on RGBA (the
 *   alpha column, against an alpha of 255, is the offset) and the editor as
 *   an SVG `feColorMatrix` in sRGB, which is the same sum and the same clamp.
 *   So the editor and the export agree to within the YUV rounding of the
 *   video itself (an earlier CSS filter chain was up to 56 levels off on
 *   Warm; measured on FFmpeg 9.0.2).
 * - The strength moves every number in a straight line from the identity,
 *   so Strength 0% draws exactly what None draws (and the export writes no
 *   filter at all).
 * - The vignette darkens by `cos(angle x d)^4`, `d` the distance from the
 *   centre over half the diagonal, as FFmpeg's `vignette` does on RGB
 *   (measured on 9.0.2 at `angle = PI/4`, 1080 by 1920: 0.74 at the side,
 *   0.36 at the top, 0.25 in the corner). The editor draws the same curve as
 *   a black radial gradient, which multiplies by the same factor.
 *
 * Pure: numbers and strings only.
 */
import { LOOK_COLOURS, type LookColour, type Looks } from '../document/schema';

/** The tile names, in the order the Effects tab shows them. */
export const LOOK_NAMES: Readonly<Record<LookColour, string>> = Object.freeze({
  none: 'None',
  warm: 'Warm',
  cool: 'Cool',
  vivid: 'Vivid',
  black_white: 'Black And White',
  sepia: 'Sepia',
  vintage: 'Vintage',
  cinematic: 'Cinematic',
});

export const LOOK_ORDER: readonly LookColour[] = LOOK_COLOURS;

/** One output channel: the red, green and blue weights and the offset (0 to 1 units). */
export type LookRow = readonly [number, number, number, number];
/** Rows red, green, blue. */
export type LookMatrix = readonly [LookRow, LookRow, LookRow];

export const IDENTITY_LOOK: LookMatrix = Object.freeze([
  Object.freeze([1, 0, 0, 0]),
  Object.freeze([0, 1, 0, 0]),
  Object.freeze([0, 0, 1, 0]),
]) as unknown as LookMatrix;

/** `a` after `b`: the matrix that applies `b`, then `a` (before any clamp). */
export function composeLooks(a: LookMatrix, b: LookMatrix): LookMatrix {
  const row = (i: number): LookRow => {
    const ar = a[i] as LookRow;
    const col = (j: number) =>
      ar[0] * (b[0] as LookRow)[j] + ar[1] * (b[1] as LookRow)[j] + ar[2] * (b[2] as LookRow)[j];
    return [col(0), col(1), col(2), col(3) + ar[3]];
  };
  return [row(0), row(1), row(2)];
}

/** Several steps, applied first to last. */
function chain(...steps: LookMatrix[]): LookMatrix {
  return steps.reduce((done, step) => composeLooks(step, done), IDENTITY_LOOK);
}

/** The identity blended towards `target` by `s`. */
export function blendLook(target: LookMatrix, s: number): LookMatrix {
  const row = (i: number): LookRow => {
    const from = IDENTITY_LOOK[i] as LookRow;
    const to = target[i] as LookRow;
    return [0, 1, 2, 3].map(
      (j) => (from[j] as number) + ((to[j] as number) - (from[j] as number)) * s,
    ) as unknown as LookRow;
  };
  return [row(0), row(1), row(2)];
}

/** Rec. 709 weights, as CSS's `saturate` uses. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Saturation `a` (1 is unchanged, 0 is grey). */
export function saturationLook(a: number): LookMatrix {
  const row = (i: number): LookRow =>
    [0, 1, 2]
      .map((j) => (LUMA[j] as number) * (1 - a) + (i === j ? a : 0))
      .concat(0) as unknown as LookRow;
  return [row(0), row(1), row(2)];
}

/** Contrast `k` about the middle grey. */
export function contrastLook(k: number): LookMatrix {
  const o = 0.5 * (1 - k);
  return [
    [k, 0, 0, o],
    [0, k, 0, o],
    [0, 0, k, o],
  ];
}

/** A gain and an offset per channel. */
export function tintLook(
  gain: readonly [number, number, number],
  offset: readonly [number, number, number] = [0, 0, 0],
): LookMatrix {
  return [
    [gain[0], 0, 0, offset[0]],
    [0, gain[1], 0, offset[1]],
    [0, 0, gain[2], offset[2]],
  ];
}

/** Luma weights: a flat 96,144,192 becomes 135 grey (cookbook section 7). */
export const GREY_LOOK: LookMatrix = [
  [0.3, 0.59, 0.11, 0],
  [0.3, 0.59, 0.11, 0],
  [0.3, 0.59, 0.11, 0],
];
/** The classic sepia matrix: a flat 96,144,192 becomes 184,164,128. */
export const SEPIA_LOOK: LookMatrix = [
  [0.393, 0.769, 0.189, 0],
  [0.349, 0.686, 0.168, 0],
  [0.272, 0.534, 0.131, 0],
];

/**
 * Each look at full strength. Tuned by eye with `clips:stills` (Module 13
 * Decision Log); the module doc's filters were the starting point.
 */
export const LOOK_TARGETS: Readonly<Record<LookColour, LookMatrix>> = Object.freeze({
  none: IDENTITY_LOOK,
  // Golden: less blue, a little less green, a touch more red in the shadows.
  warm: tintLook([1, 0.96, 0.85], [0.035, 0.01, 0]),
  // Clear and blue: less red, a lift in the blue.
  cool: tintLook([0.88, 0.97, 1], [0, 0.01, 0.04]),
  vivid: chain(saturationLook(1.45), contrastLook(1.1)),
  black_white: GREY_LOOK,
  sepia: SEPIA_LOOK,
  // Faded film: half sepia, softer contrast, less colour, lifted blacks.
  vintage: chain(
    blendLook(SEPIA_LOOK, 0.5),
    saturationLook(0.85),
    contrastLook(0.9),
    tintLook([1, 1, 1], [0.03, 0.03, 0.03]),
  ),
  // Teal shadows, warm lights, a little more punch.
  cinematic: chain(
    saturationLook(1.05),
    contrastLook(1.12),
    tintLook([1.04, 1, 0.95], [-0.015, 0, 0.035]),
  ),
});

function unitOf(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** The look's matrix at its strength, rounded to six places; null for None and Strength 0. */
export function lookMatrix(looks: Pick<Looks, 'colour' | 'strength'>): LookMatrix | null {
  const s = unitOf(looks.strength);
  if (looks.colour === 'none' || s === 0) return null;
  const m = blendLook(LOOK_TARGETS[looks.colour], s);
  const r = (row: LookRow): LookRow => [round(row[0]), round(row[1]), round(row[2]), round(row[3])];
  return [r(m[0]), r(m[1]), r(m[2])];
}

/** One colour through a look (0 to 255 in, 0 to 255 out, clamped once): what both drawings do. */
export function applyLook(
  matrix: LookMatrix | null,
  colour: readonly [number, number, number],
): [number, number, number] {
  if (!matrix) return [colour[0], colour[1], colour[2]];
  const out = matrix.map((row) => {
    const v = row[0] * colour[0] + row[1] * colour[1] + row[2] * colour[2] + row[3] * 255;
    return Math.min(255, Math.max(0, v));
  });
  return [out[0] as number, out[1] as number, out[2] as number];
}

/**
 * The editor's SVG `feColorMatrix` values (four rows of five; alpha kept), or
 * null when the look draws nothing.
 */
export function lookSvgValues(looks: Pick<Looks, 'colour' | 'strength'>): string | null {
  const m = lookMatrix(looks);
  if (!m) return null;
  return [...m.map((row) => [row[0], row[1], row[2], 0, row[3]]), [0, 0, 0, 1, 0]]
    .map((row) => row.join(' '))
    .join(' ');
}

// --- Vignette ---------------------------------------------------------------------------

/** The `vignette` filter's angle for a Vignette of `v` (0 to 1): 0 is none, 1 is `PI/4`. */
export function vignetteAngle(v: number): number {
  return (Math.PI / 4) * unitOf(v);
}

/** How bright a point stays under the vignette: `d` is its distance from the centre over half the diagonal. */
export function vignetteFactor(v: number, d: number): number {
  const angle = vignetteAngle(v);
  if (angle === 0) return 1;
  const c = Math.cos(angle * Math.min(1, Math.max(0, d)));
  return c * c * (c * c);
}

/** The steps of the editor's vignette gradient. */
export const VIGNETTE_CSS_STOPS = 10;

/**
 * The editor's vignette: a circular gradient to the far corner, black with
 * the darkening `vignetteFactor` gives at each tenth of the way. Null when
 * there is no vignette.
 */
export function vignetteCss(v: number): string | null {
  if (vignetteAngle(v) === 0) return null;
  const stops: string[] = [];
  for (let k = 0; k <= VIGNETTE_CSS_STOPS; k += 1) {
    const d = k / VIGNETTE_CSS_STOPS;
    const alpha = round(1 - vignetteFactor(v, d), 3);
    stops.push(`rgba(0, 0, 0, ${alpha}) ${round(d * 100, 1)}%`);
  }
  return `radial-gradient(circle farthest-corner at 50% 50%, ${stops.join(', ')})`;
}
