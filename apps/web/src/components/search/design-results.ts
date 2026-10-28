/**
 * How a Studio design reads in the search box (Sprint 9b).
 *
 * The names and sizes are written out here instead of read from the engine's
 * `FORMATS`: the search box sits in every page's top bar, and the engine's
 * entry point brings every template and drawing with it. The test holds them
 * to `FORMATS` and to the design cards' `formatName`, so they cannot drift.
 */
import type { FormatId } from '@postgear/design-engine';

export interface DesignFormatLook {
  /** "Portrait (4:5)", as the Studio's design cards name it. */
  label: string;
  /** The exported slide's size in pixels, which gives the thumbnail its shape. */
  width: number;
  height: number;
}

export const DESIGN_FORMATS: Record<FormatId, DesignFormatLook> = {
  square: { label: 'Square (1:1)', width: 1080, height: 1080 },
  portrait: { label: 'Portrait (4:5)', width: 1080, height: 1350 },
  story: { label: 'Story (9:16)', width: 1080, height: 1920 },
  landscape: { label: 'Landscape (16:9)', width: 1920, height: 1080 },
};

/**
 * The format's name and size, or null for one this build does not know (an
 * API newer than the page). `Object.hasOwn`, so "toString" is not a format.
 */
export function designFormat(format: string): DesignFormatLook | null {
  return Object.hasOwn(DESIGN_FORMATS, format) ? DESIGN_FORMATS[format as FormatId] : null;
}

/**
 * The thumbnail's size inside a square of `box` pixels: the slide's own
 * shape, as large as fits, so a story and a landscape both show whole. An
 * unknown format gets the whole square.
 */
export function thumbSize(
  format: DesignFormatLook | null,
  box: number,
): { width: number; height: number } {
  const ratio = format ? format.width / format.height : 1;

  return ratio >= 1
    ? { width: box, height: Math.round(box / ratio) }
    : { width: Math.round(box * ratio), height: box };
}

/** Where a design opens: the Studio editor. */
export function designHref(base: string, id: string): string {
  return `${base}/studio/${encodeURIComponent(id)}`;
}
