/**
 * Colour arithmetic: parse a hex, measure a contrast, pick a readable ink.
 *
 * Pure and dependency-free, because three very different callers need the
 * same answers: `brand.ts` when it maps a brand kit onto a theme, the
 * properties panel when it warns that text is hard to read, and the gallery
 * when it recolours a hundred thumbnails while the user scrolls.
 *
 * The contrast formula is WCAG 2.1's: relative luminance with the sRGB
 * linearisation, `(lighter + 0.05) / (darker + 0.05)`. AA for the sizes used
 * on a slide is 4.5:1 for body text and 3:1 for large text; a headline on a
 * slide is always large, but the guard uses 4.5 everywhere because a slide
 * is read at thumbnail size in a feed, where "large" stops being large.
 */

/** WCAG AA for normal text. The one threshold the whole module uses. */
export const AA_CONTRAST = 4.5;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for `#abc` and `#aabbcc`, with or without the hash. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value.trim());
}

/** `#abc` -> `#AABBCC`. Returns null rather than throwing: input is a text field. */
export function normalizeHex(value: string): string | null {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return null;

  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;

  return `#${full.toUpperCase()}`;
}

export function hexToRgb(value: string): Rgb | null {
  const hex = normalizeHex(value);
  if (!hex) return null;

  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;

  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= AA_CONTRAST;
}

/**
 * The two inks a design falls back to. The dark one is a softened near-black
 * because pure black text on a light slide reads as harsh at feed size; the
 * light one is plain white, which has nothing lighter to soften towards.
 */
export const INK_DARK = '#111111';
export const INK_LIGHT = '#FFFFFF';

/**
 * The ink that reads on `background`.
 *
 * The two softened inks first, because pure black on pure white is harsh at
 * feed size. They are not enough on their own: against a mid-tone around 46%
 * luminance neither clears 4.5:1, and that is a real gap rather than a bad
 * pair, so the fallback is pure black or pure white. Those two always clear
 * it: the worst case is the crossover, at 4.58:1.
 */
export function readableInk(background: string): string {
  const soft =
    contrastRatio(INK_DARK, background) >= contrastRatio(INK_LIGHT, background)
      ? INK_DARK
      : INK_LIGHT;

  if (meetsAA(soft, background)) return soft;

  return luminance(background) > 0.18 ? '#000000' : '#FFFFFF';
}

/**
 * Keeps a chosen ink if it is readable, and swaps it for the better of the
 * two fallbacks if it is not. This is what Fix Contrast does, and what
 * `applyBrand` runs on every derived role so a brand kit can never produce an
 * unreadable pairing on its own.
 */
export function ensureReadable(foreground: string, background: string): string {
  return meetsAA(foreground, background) ? foreground : readableInk(background);
}

/** Linear blend in sRGB. `amount` 0 returns `from`, 1 returns `to`. */
export function mix(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return from;

  const ratio = Math.max(0, Math.min(1, amount));

  return rgbToHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}

/**
 * A surface a step away from its ground: lighter on a dark slide, darker on a
 * light one, so a panel is visible without being a second colour to pick.
 */
export function surfaceFrom(background: string, amount = 0.08): string {
  return mix(background, readableInk(background), amount);
}

/**
 * A second ink for captions and handles: the main ink pulled back toward the
 * ground, but never past the point where it stops meeting AA. A "muted" that
 * is unreadable is just a bug with a nice name.
 */
export function mutedInk(ink: string, background: string, amount = 0.32): string {
  const candidate = mix(ink, background, amount);
  return meetsAA(candidate, background) ? candidate : ink;
}

/** `rgba()` for an overlay, from a hex and a 0-1 strength. */
export function rgba(color: string, alpha: number): string {
  const rgb = hexToRgb(color) ?? { r: 0, g: 0, b: 0 };
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}

/**
 * How far two colours are apart, 0-1, as a plain Euclidean distance in sRGB.
 * Used by the website extractor to merge near-duplicate swatches; it is not
 * perceptually uniform, and does not need to be for "are these the same blue".
 */
export function colorDistance(a: string, b: string): number {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  if (!first || !second) return 1;

  const dr = (first.r - second.r) / 255;
  const dg = (first.g - second.g) / 255;
  const db = (first.b - second.b) / 255;

  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
}

/** Saturation on the HSL scale, 0-1. Near-greys are what the extractor drops. */
export function saturation(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) return 0;

  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}
