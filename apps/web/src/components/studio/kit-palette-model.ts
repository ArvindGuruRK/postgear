/**
 * From One Colour (Sprint 9b): a whole brand kit from the one colour a
 * person has, usually the main colour of their logo.
 *
 * That colour becomes Primary exactly as given. The other four are built
 * around its hue, the way the classic themes pair theirs:
 *
 * - Background: the hue barely there, near white on a light ground and near
 *   black on a dark one.
 * - Text: the hue as a very dark ink (or a very light one), at least 7:1 on
 *   the background, so body text reads well past the AA line.
 * - Secondary: the hue greyed down, for quieter words, at least 4.5:1 on the
 *   background.
 * - Accent: the hue turned most of the way round the wheel, for highlights,
 *   at least 4.5:1 on the background. A grey has no hue to turn, so its
 *   accent is a warm orange, as the Ink theme's is.
 *
 * Every colour that fails its ratio is walked darker (or lighter) a step at
 * a time until it passes, so the guarantees hold for any colour typed, a
 * pale yellow or a near-black included. The inks the engine derives for the
 * fills (`applyBrand`) are its own business and need nothing from here.
 */
import {
  AA_CONTRAST,
  type BrandColors,
  contrastRatio,
  luminance,
  normalizeHex,
} from '@postgear/design-engine';

export type KitGround = 'light' | 'dark';

export const GROUND_OPTIONS: readonly { value: KitGround; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** WCAG's AAA ratio for body text, which a kit's own Text should clear on its Background. */
export const TEXT_CONTRAST = 7;

/** How far round the colour wheel the accent sits from the primary, in degrees. */
const ACCENT_TURN = 150;
/** Below this saturation a colour reads as grey, and its hue means nothing. */
const GREY = 0.08;
const GREY_ACCENT_HUE = 20;
/** The luminance below which white text reads better than the engine's dark ink (`readableInk`). */
const DARK_GROUND = 0.18;

interface Hsl {
  /** 0 to 360. */
  h: number;
  /** 0 to 1. */
  s: number;
  /** 0 to 1. */
  l: number;
}

function toHsl(hex: string): Hsl {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };

  const hex = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();

  return `#${hex(channel(hue + 1 / 3))}${hex(channel(hue))}${hex(channel(hue - 1 / 3))}`;
}

/**
 * The colour, moved away from the ground a step at a time until it reads at
 * `ratio` on it: darker on a light ground, lighter on a dark one. Black or
 * white, which always clear 7:1 on these grounds, if nothing in between does.
 */
function readableOn(color: Hsl, background: string, ratio: number, ground: KitGround): string {
  const step = ground === 'light' ? -0.01 : 0.01;

  for (let l = color.l; l >= 0 && l <= 1; l += step) {
    const hex = fromHsl({ ...color, l });
    if (contrastRatio(hex, background) >= ratio) return hex;
  }

  return ground === 'light' ? '#000000' : '#FFFFFF';
}

/**
 * The ground a kit is on now, which From One Colour starts from so a dark
 * kit stays dark: dark when its background takes light text. Anything that
 * is not a colour yet reads as light, the default theme's ground.
 */
export function groundOf(background: string): KitGround {
  const hex = normalizeHex(background);
  return hex && luminance(hex) < DARK_GROUND ? 'dark' : 'light';
}

/** The five kit colours from one, or null when `seed` is not a colour. */
export function paletteFromColor(seed: string, ground: KitGround = 'light'): BrandColors | null {
  const primary = normalizeHex(seed);
  if (!primary) return null;

  const { h, s } = toHsl(primary);
  const light = ground === 'light';

  const background = fromHsl(
    light ? { h, s: Math.min(s, 0.7), l: 0.97 } : { h, s: Math.min(s, 0.5), l: 0.09 },
  );
  const text = readableOn(
    light ? { h, s: Math.min(s, 0.45), l: 0.13 } : { h, s: Math.min(s, 0.3), l: 0.95 },
    background,
    TEXT_CONTRAST,
    ground,
  );
  const secondary = readableOn(
    { h, s: Math.min(s, 0.22), l: light ? 0.42 : 0.68 },
    background,
    AA_CONTRAST,
    ground,
  );
  const grey = s < GREY;
  const accent = readableOn(
    {
      h: grey ? GREY_ACCENT_HUE : h + ACCENT_TURN,
      s: grey ? 0.75 : Math.min(0.85, Math.max(0.55, s)),
      l: light ? 0.42 : 0.62,
    },
    background,
    AA_CONTRAST,
    ground,
  );

  return { primary, secondary, accent, background, text };
}
