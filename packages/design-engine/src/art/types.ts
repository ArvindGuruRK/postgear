/**
 * Background art: the drawing under a slide's text.
 *
 * An art style is a pure function from four colours and a canvas size to a
 * complete SVG document. It never names a hex of its own beyond white and
 * black, so the same drawing serves every theme and every brand kit, and the
 * renderer can show it as an `<img>` in the editor, the thumbnails, the share
 * page and the export alike.
 *
 * The four colours follow CarouselClick's model, where the patterns come
 * from: the ground, a `mid` tone between the ground and the highlight, the
 * `highlight` itself, and a `sheen` (white on a dark ground, the highlight
 * on a light one).
 */

export interface ArtColors {
  /** The slide's ground, as `#RRGGBB`. */
  background: string;
  /** A tone between the ground and the highlight. */
  mid: string;
  /** The brightest colour in the drawing. */
  highlight: string;
  /** White on a dark ground, the highlight on a light one. */
  sheen: string;
}

/**
 * Where an art style comes from: one of CarouselClick's ten generated
 * patterns, one of its hand-made backgrounds rebuilt as a generator, or the
 * luxury set drawn for PostGear.
 */
export type ArtKind = 'pattern' | 'original' | 'luxury';

export interface ArtStyle {
  /** Stable and never reused: a stored design names it. */
  id: string;
  /** Title Case, as the gallery's Look filter and the Design panel show it. */
  name: string;
  kind: ArtKind;
  /** Locked to paid plans. A design that already uses it keeps working. */
  premium: boolean;
  /**
   * The exact colours a hand-made original was drawn in, with the ground it
   * was drawn on. While a slide sits on that ground the art uses these, so
   * the original looks exactly as it was made; on any other ground it is
   * recoloured like a pattern. Patterns leave it out.
   */
  home?: { background: string; mid: string; highlight: string; sheen?: string };
  /**
   * The art as a complete `<svg>` document for a `width` x `height` canvas.
   * Pure and deterministic: the same input always gives the same string,
   * which is what lets the renderer cache it and the export match the
   * editor. No external references of any kind (no `href` to a URL, no
   * fonts, no images): the export page's CSP would refuse them anyway.
   */
  draw(colors: ArtColors, width: number, height: number): string;
}
