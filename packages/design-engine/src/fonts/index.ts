/**
 * The curated type set a design can use, and the one place that knows which
 * file serves which weight.
 *
 * CLAUDE.md's "one font, Sora" rule is about the **app's chrome**. A design is
 * the user's own content and would look like a template library of one if
 * every slide were set in the product's UI face, so themes pick from these
 * eight OFL families. The Studio around the canvas still uses the app's role
 * utilities only.
 *
 * Five of the eight are variable fonts: Google serves the same binary for
 * every weight asked of them, so one file is stored and its `@font-face`
 * declares the whole range. The three static Poppins cuts are separate files
 * because they genuinely are.
 *
 * Nothing in this file reads a file: the package stays browser-safe. The API's
 * exporter resolves `file` against `packages/design-engine/fonts/` and inlines
 * the bytes; the web app serves the same folder through the API's public font
 * route. One copy of each file, two readers.
 */
import type { FontId } from '../types';

export interface FontFace {
  /** The file in `packages/design-engine/fonts/`. */
  file: string;
  /** A single weight, or the range a variable file covers. */
  weight: number | [number, number];
}

export interface FontDef {
  id: FontId;
  /** The CSS family name. Matches Google's, so a missing file falls back sanely. */
  family: string;
  /** What a web-safe stack should do if the file never arrives. */
  fallback: string;
  faces: FontFace[];
}

export const FONTS: Record<FontId, FontDef> = {
  sora: {
    id: 'sora',
    family: 'Sora',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    faces: [{ file: 'sora-var.woff2', weight: [100, 800] }],
  },
  inter: {
    id: 'inter',
    family: 'Inter',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    faces: [{ file: 'inter-var.woff2', weight: [100, 900] }],
  },
  poppins: {
    id: 'poppins',
    family: 'Poppins',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    faces: [
      { file: 'poppins-400.woff2', weight: 400 },
      { file: 'poppins-600.woff2', weight: 600 },
      { file: 'poppins-700.woff2', weight: 700 },
    ],
  },
  'space-grotesk': {
    id: 'space-grotesk',
    family: 'Space Grotesk',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    faces: [{ file: 'space-grotesk-var.woff2', weight: [300, 700] }],
  },
  'archivo-black': {
    id: 'archivo-black',
    family: 'Archivo Black',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    faces: [{ file: 'archivo-black-400.woff2', weight: 400 }],
  },
  'dm-serif-display': {
    id: 'dm-serif-display',
    family: 'DM Serif Display',
    fallback: 'ui-serif, Georgia, serif',
    faces: [{ file: 'dm-serif-display-400.woff2', weight: 400 }],
  },
  'playfair-display': {
    id: 'playfair-display',
    family: 'Playfair Display',
    fallback: 'ui-serif, Georgia, serif',
    faces: [{ file: 'playfair-display-var.woff2', weight: [400, 900] }],
  },
  'jetbrains-mono': {
    id: 'jetbrains-mono',
    family: 'JetBrains Mono',
    fallback: 'ui-monospace, SFMono-Regular, monospace',
    faces: [{ file: 'jetbrains-mono-var.woff2', weight: [100, 800] }],
  },
};

export const FONT_IDS = Object.keys(FONTS) as FontId[];

/** The CSS `font-family` value for a slot: the family, then its fallback. */
export function fontStack(id: FontId): string {
  const font = FONTS[id];
  return `"${font.family}", ${font.fallback}`;
}

/**
 * The weight a face declares. A variable file says `100 800`, which is what
 * lets one file answer every weight a theme asks for.
 */
export function faceWeight(face: FontFace): string {
  return Array.isArray(face.weight) ? `${face.weight[0]} ${face.weight[1]}` : String(face.weight);
}

/**
 * Archivo Black and DM Serif Display only exist at one weight. A theme that
 * asks for 800 from them would otherwise get a browser's synthetic bold,
 * which is heavier in Chromium than in the editor's own rendering on some
 * platforms; snapping to what the file has keeps the two identical.
 */
export function resolveWeight(id: FontId, requested: number): number {
  const faces = FONTS[id].faces;
  const variable = faces.find((face) => Array.isArray(face.weight));

  if (variable && Array.isArray(variable.weight)) {
    return Math.max(variable.weight[0], Math.min(variable.weight[1], requested));
  }

  const weights = faces.map((face) => face.weight as number);
  return weights.reduce((best, weight) =>
    Math.abs(weight - requested) < Math.abs(best - requested) ? weight : best,
  );
}

/** Every file a set of fonts needs, deduplicated. What the exporter inlines. */
export function filesFor(ids: Iterable<FontId>): string[] {
  const files = new Set<string>();

  for (const id of ids) {
    for (const face of FONTS[id].faces) files.add(face.file);
  }

  return [...files];
}
