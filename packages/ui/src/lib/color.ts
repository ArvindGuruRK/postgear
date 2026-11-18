/**
 * Colour maths for `ColorPicker`: hex in and out, and the hue, saturation
 * and value the shade square and hue strip are drawn in. Pure.
 */

export interface Hsv {
  /** 0 to 360. */
  h: number;
  /** 0 to 1. */
  s: number;
  /** 0 to 1. */
  v: number;
}

/**
 * A typed colour as `#RRGGBB` (upper case), or null when it is not one.
 * Takes `#RGB`, `RGB`, `#RRGGBB` and `RRGGBB`, with spaces around.
 */
export function parseHex(input: string): string | null {
  const text = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text
      .split('')
      .map((c) => c + c)
      .join('')}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) {
    return `#${text}`.toUpperCase();
  }
  return null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function hexToHsv(hex: string): Hsv {
  const parsed = parseHex(hex) ?? '#000000';
  const r = Number.parseInt(parsed.slice(1, 3), 16) / 255;
  const g = Number.parseInt(parsed.slice(3, 5), 16) / 255;
  const b = Number.parseInt(parsed.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = (((Number.isFinite(h) ? h : 0) % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(v);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  const two = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${two(r)}${two(g)}${two(b)}`.toUpperCase();
}

/** The pure hue at full saturation and value, for the shade square's backdrop. */
export function hueHex(h: number): string {
  return hsvToHex({ h, s: 1, v: 1 });
}

/** A few most recent colours, newest first, each once. */
export function pushRecent(recent: readonly string[], hex: string, keep = 8): string[] {
  const parsed = parseHex(hex);
  if (!parsed) return [...recent];
  return [parsed, ...recent.filter((other) => other !== parsed)].slice(0, keep);
}
