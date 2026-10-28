/**
 * Putting a brand's colours onto a theme, without ever making text unreadable.
 *
 * A brand kit holds five colours a person picked, usually from a logo or a
 * website. A theme needs ten roles, three of which are inks that have to read
 * on a fill. If the five were copied straight across, a brand whose primary is
 * pale yellow would produce white headlines on pale yellow, and the user would
 * be left to notice.
 *
 * So the mapping is: **take the five, derive the rest, and check every
 * pairing.** The five keep the brand's identity; the derived inks are
 * computed from the fill they sit on, never from the kit. `applyBrand` is
 * therefore total: for any five hex values, including five near-identical
 * ones, every ink role it returns clears WCAG AA against the ground it is
 * meant for. `brand.test.ts` asserts exactly that over a sweep of palettes.
 *
 * The brand's own colours (`primary`, `accent`) are also used as *text* by a
 * few slots, an accent eyebrow or a number in the primary colour, and those
 * cannot be fixed here without changing the brand. `ink.ts` handles them at
 * the point a slot is drawn, against the ground it actually sits on.
 *
 * A slide whose background is a photo is the one case the palette cannot
 * reason about, so `paletteForSlide` gives it the inks its overlay is for
 * (light under a dark tint, dark under a light one) and the overlay does the
 * rest; `SAFE_PHOTO_OVERLAY` is the strength at which that is a guarantee
 * rather than a hope.
 */
import {
  ensureReadable,
  meetsAA,
  mix,
  mutedInk,
  normalizeHex,
  readableInk,
  surfaceFrom,
} from './color';
import type { BrandColors, ColorRole, DesignSlide, Palette, PhotoTint, Theme } from './types';

/**
 * The overlay strength a photo background starts at, and below which the
 * panel warns that text on it may be hard to read.
 *
 * Under the default dark tint the overlay is black, so the lightest a photo
 * can be under it is white darkened by this much: `#666666` at 0.6. White
 * ink clears 5.7:1 on that and `PHOTO_INK_MUTED` clears 4.8:1, whatever the
 * photo is. A light tint is the mirror: the overlay is white, the darkest a
 * photo can be under it is black lightened by this much, `#999999`, and
 * `PHOTO_INK_DARK` clears 6.6:1 on that, `PHOTO_INK_DARK_MUTED` 4.8:1.
 */
export const SAFE_PHOTO_OVERLAY = 0.6;

/** The inks a photo slide takes under the dark tint. */
export const PHOTO_INK = '#FFFFFF';
export const PHOTO_INK_MUTED = '#EBEBEB';

/** The inks a photo slide takes under the light tint. */
export const PHOTO_INK_DARK = '#111111';
export const PHOTO_INK_DARK_MUTED = '#2E2E2E';

/** The colour a photo's overlay is laid in: black for the dark tint, white for the light one. */
export function photoOverlayColor(tint: PhotoTint = 'dark'): string {
  return tint === 'light' ? '#FFFFFF' : '#000000';
}

/**
 * The colour text on a photo is judged against: the photo its inks read
 * worst on, under its overlay, taking the overlay as at least the safe
 * strength. That is a white photo under a dark tint and a black one under a
 * light tint. A weaker overlay is the photo warning's business, not a reason
 * to switch the slide to inks that the opposite kind of photo would swallow.
 */
export function photoGround(overlay: number, tint: PhotoTint = 'dark'): string {
  const worst = tint === 'light' ? '#000000' : '#FFFFFF';
  return mix(worst, photoOverlayColor(tint), Math.max(overlay, SAFE_PHOTO_OVERLAY));
}

/**
 * True when a photo's overlay is too weak to promise readable text. The name
 * predates the light tint, which lightens rather than darkens; the rule is
 * the same for both: an overlay below the safe strength.
 */
export function photoNeedsDarkening(slide: Pick<DesignSlide, 'background'>): boolean {
  return slide.background.kind === 'media' && slide.background.overlay < SAFE_PHOTO_OVERLAY;
}

/**
 * The theme's palette with the brand's five colours mapped on.
 *
 * `background`, `primary`, `secondary` and `accent` are the brand's, as
 * given. `text` is the brand's **if it reads** on the brand's background, and
 * the better of the two fallback inks if it does not: a brand whose text
 * colour was chosen for a white site would otherwise vanish on a dark one.
 * Everything else is derived.
 */
export function applyBrand(theme: Theme, brand: BrandColors | null | undefined): Palette {
  if (!brand) return theme.colors;

  const background = normalizeHex(brand.background) ?? theme.colors.background;
  const primary = normalizeHex(brand.primary) ?? theme.colors.primary;
  const secondary = normalizeHex(brand.secondary) ?? theme.colors.secondary;
  const accent = normalizeHex(brand.accent) ?? theme.colors.accent;
  const text = ensureReadable(normalizeHex(brand.text) ?? readableInk(background), background);
  const surface = surfaceFrom(background);

  return {
    background,
    surface,
    primary,
    secondary,
    accent,
    text,
    textMuted: mutedInk(text, background),
    onPrimary: readableInk(primary),
    onAccent: readableInk(accent),
    onSurface: ensureReadable(text, surface),
  };
}

/**
 * The palette a particular slide is drawn with.
 *
 * Three things can change it, in this order:
 *
 * 1. the brand kit, if the design has one;
 * 2. a background other than the theme's own ground (a custom colour, or a
 *    role such as the brand's primary), which the text inks then have to
 *    read on instead;
 * 3. a photo background, which darkens under a black overlay and so takes
 *    light ink, or lightens under a white one (the light tint) and takes
 *    dark ink, whatever the theme says.
 *
 * The inks that belong to a fill (`onPrimary`, `onAccent`, `onSurface`) are
 * left alone in every case except a new surface: a painted panel is opaque,
 * so its ink reads on it whatever is behind the panel.
 */
export function paletteForSlide(
  theme: Theme,
  brand: BrandColors | null | undefined,
  slide: Pick<DesignSlide, 'background'>,
): Palette {
  const base = applyBrand(theme, brand);

  if (slide.background.kind === 'media') {
    return slide.background.tint === 'light'
      ? { ...base, text: PHOTO_INK_DARK, textMuted: PHOTO_INK_DARK_MUTED }
      : { ...base, text: PHOTO_INK, textMuted: PHOTO_INK_MUTED };
  }

  if (slide.background.kind === 'color') {
    const ground = normalizeHex(slide.background.hex);
    return ground ? onGround(base, ground) : base;
  }

  // A role background: the ground is whichever role the slide names, and the
  // text inks have to read on that rather than on the theme's own background.
  const ground = base[slide.background.role];
  if (ground === base.background) return base;

  // The text colour itself as the ground (an inverted slide) is drawn the way
  // a custom colour is. Its own role is about to hold the ink that reads on
  // it, so the ground moves to `background`, where `slideGround` finds it.
  if (INK_GROUNDS.has(slide.background.role)) return onGround(base, ground);

  const text = ensureReadable(base.text, ground);

  return { ...base, text, textMuted: mutedInk(text, ground) };
}

/** The roles `paletteForSlide` rewrites for a slide's ground: the text inks. */
const INK_GROUNDS: ReadonlySet<ColorRole> = new Set<ColorRole>(['text', 'textMuted']);

/** The palette on a ground the theme did not plan for: a custom colour, or an ink. */
function onGround(base: Palette, ground: string): Palette {
  const text = ensureReadable(base.text, ground);
  const surface = surfaceFrom(ground);

  return {
    ...base,
    background: ground,
    surface,
    text,
    textMuted: mutedInk(text, ground),
    onSurface: ensureReadable(text, surface),
  };
}

/**
 * The colour a slide is painted, before any photo. A photo slide reports its
 * palette's background, which is what shows if the photo cannot be drawn.
 *
 * `palette` is the slide's own, from `paletteForSlide`. A slide grounded on
 * a text ink finds that colour under `background`, since the ink's own role
 * now holds what is written on it.
 */
export function slideGround(palette: Palette, slide: Pick<DesignSlide, 'background'>): string {
  switch (slide.background.kind) {
    case 'color':
      return normalizeHex(slide.background.hex) ?? palette.background;
    case 'media':
      return palette.background;
    default:
      return INK_GROUNDS.has(slide.background.role)
        ? palette.background
        : palette[slide.background.role];
  }
}

/** Whether one colour reads on another, and the ink to switch to when it does not. */
export interface ContrastVerdict {
  readable: boolean;
  foreground: string;
  background: string;
  /** The ink to switch to. Null when the text already reads. */
  suggestion: string | null;
}

export function checkContrast(foreground: string, background: string): ContrastVerdict {
  const readable = meetsAA(foreground, background);

  return {
    readable,
    foreground,
    background,
    suggestion: readable ? null : readableInk(background),
  };
}

/** The five colours a brand kit starts with when it is built from a theme. */
export function brandFromTheme(theme: Theme): BrandColors {
  return {
    primary: theme.colors.primary,
    secondary: theme.colors.secondary,
    accent: theme.colors.accent,
    background: theme.colors.background,
    text: theme.colors.text,
  };
}
