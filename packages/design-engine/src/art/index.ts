/**
 * Every background art style, and the colours a slide draws one in.
 *
 * Like the layouts, the themes and the presets, this is a library in code: a
 * design stores an art id, never a drawing, so a style can be improved in a
 * release and every design that uses it improves with it. An id is never
 * reused or removed; a style that should no longer be offered is hidden from
 * the pickers, not deleted, because Reset and old designs still name it.
 *
 * ## The colours
 *
 * A theme may pin the exact `mid` and `highlight` its art was drawn with
 * (the ported CarouselClick looks are exact this way). Those are used only
 * while a slide sits on the theme's own background. On any other ground (a
 * brand kit's, a custom colour, a slide set to the primary colour) the art
 * derives them the way CarouselClick re-derives custom colours: the
 * highlight is the palette's accent and `mid` sits between the ground and
 * the highlight. So a brand kit recolours the art along with everything else.
 */
import { contrastRatio, INK_DARK, INK_LIGHT, mix, normalizeHex } from '../color';
import { LUXURY_ARTS } from './luxury';
import { ORIGINAL_ARTS } from './originals';
import { PATTERN_ARTS } from './patterns';
import type { ArtColors, ArtStyle } from './types';

export type { ArtColors, ArtKind, ArtStyle } from './types';

export const ART_STYLES: ArtStyle[] = [...PATTERN_ARTS, ...ORIGINAL_ARTS, ...LUXURY_ARTS];

/** A `Map`, so a stored id of `"toString"` misses rather than finding a prototype method. */
const BY_ID: ReadonlyMap<string, ArtStyle> = new Map(ART_STYLES.map((art) => [art.id, art]));

export function isArtId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

export function artById(id: string | null | undefined): ArtStyle | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/** True when light ink reads better than dark on `ground`: the art then takes a white sheen. */
export function isDarkGround(ground: string): boolean {
  return contrastRatio(INK_LIGHT, ground) >= contrastRatio(INK_DARK, ground);
}

/**
 * The colours one slide's art is drawn in, in this order:
 *
 * 1. `home`: a hand-made original's own colours, while `ground` is the
 *    ground it was drawn on;
 * 2. `pinned`: the theme's own art colours, while `ground` is the theme's
 *    background;
 * 3. derived from the ground and the accent, as CarouselClick re-derives
 *    custom colours.
 */
export function artColors(input: {
  /** The colour the slide is painted (`slideGround`). */
  ground: string;
  /** The slide palette's accent, which the art's highlight follows when nothing is pinned. */
  accent: string;
  /** `Theme.art` with the theme's background. */
  pinned?: { background: string; mid: string; highlight: string } | null;
  /** `ArtStyle.home`. */
  home?: { background: string; mid: string; highlight: string; sheen?: string } | null;
}): ArtColors {
  const ground = normalizeHex(input.ground) ?? input.ground;
  const dark = isDarkGround(ground);
  const { home, pinned } = input;

  if (home && normalizeHex(home.background) === ground) {
    return {
      background: ground,
      mid: home.mid,
      highlight: home.highlight,
      sheen: home.sheen ?? (dark ? '#FFFFFF' : home.highlight),
    };
  }

  if (pinned && normalizeHex(pinned.background) === ground) {
    return {
      background: ground,
      mid: pinned.mid,
      highlight: pinned.highlight,
      sheen: dark ? '#FFFFFF' : pinned.highlight,
    };
  }

  const highlight = normalizeHex(input.accent) ?? input.accent;

  return {
    background: ground,
    mid: mix(ground, highlight, dark ? 0.35 : 0.45),
    highlight,
    sheen: dark ? '#FFFFFF' : highlight,
  };
}

/**
 * Drawn SVGs, by everything that decides them. The editor re-renders a slide
 * on every keystroke and the gallery draws a hundred thumbnails, while the
 * distinct drawings in play at once number in the tens.
 */
const CACHE_LIMIT = 200;
const drawn = new Map<string, string>();

/** The art as an SVG document, or null when the id is unknown. */
export function artSvg(
  id: string,
  colors: ArtColors,
  width: number,
  height: number,
): string | null {
  const art = artById(id);
  if (!art) return null;

  const key = [
    id,
    width,
    height,
    colors.background,
    colors.mid,
    colors.highlight,
    colors.sheen,
  ].join('|');
  const cached = drawn.get(key);
  if (cached !== undefined) return cached;

  const svg = art.draw(colors, width, height);
  if (drawn.size >= CACHE_LIMIT) {
    const oldest = drawn.keys().next().value;
    if (oldest !== undefined) drawn.delete(oldest);
  }
  drawn.set(key, svg);

  return svg;
}

/** An SVG document as something `<img src>` takes, in the browser and on the export page alike. */
export function artDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
