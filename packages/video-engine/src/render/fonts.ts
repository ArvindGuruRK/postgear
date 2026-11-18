/**
 * The font manifest: which font families the render can draw, and the three
 * numbers that turn a CSS font size into an ASS one.
 *
 * libass reads only TTF and OTF (WOFF2 fails with "Error opening memory font")
 * and falls back silently to another face when a family is not in `fontsdir`
 * (cookbook section 6). So `clips:fonts:build` writes TTF or OTF twins of the
 * Studio fonts and this manifest beside them, and the compiler checks every
 * family a clip uses against it before rendering: a missing family fails with
 * `font_missing` rather than drawing the text in some other face.
 *
 * Module 05 ships the mechanism with an empty manifest; Module 11 fills it.
 */
import { z } from 'zod';
import type { ClipDocument } from '../document/schema';

/** The manifest's file name inside the fonts folder. */
export const FONT_MANIFEST_FILE = 'manifest.json';

/** The fonts folder's name inside a render's scratch folder (`ass=...:fontsdir=fonts`). */
export const FONTS_DIR = 'fonts';

export const fontManifestEntrySchema = z
  .object({
    /** The family name as text items and the ASS `Fontname` write it. */
    family: z.string().trim().min(1).max(80),
    /** The TTF or OTF file inside the fonts folder. */
    file: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+\.(ttf|otf)$/, 'A font file is a plain .ttf or .otf name'),
    /** From the `head` table. */
    unitsPerEm: z.number().int().positive(),
    /** `usWinAscent` and `usWinDescent` from the `OS/2` table. */
    winAscent: z.number().int().min(0),
    winDescent: z.number().int().min(0),
  })
  .strict();

export const fontManifestSchema = z
  .object({
    version: z.literal(1),
    fonts: z.array(fontManifestEntrySchema),
  })
  .strict();

export type FontManifestEntry = z.infer<typeof fontManifestEntrySchema>;
export type FontManifest = z.infer<typeof fontManifestSchema>;

/** The manifest `clips:fonts:build` writes before any font is converted. */
export function emptyFontManifest(): FontManifest {
  return { version: 1, fonts: [] };
}

/** Parses a manifest read from disk; throws a ZodError when it has the wrong shape. */
export function parseFontManifest(raw: unknown): FontManifest {
  return fontManifestSchema.parse(raw);
}

/** Family names compare as libass does: case does not matter. */
function familyKey(family: string): string {
  return family.trim().toLowerCase();
}

/** Every font family the clip's text uses, sorted, each once. */
export function fontsNeeded(doc: Pick<ClipDocument, 'tracks'>): string[] {
  const families = new Map<string, string>();
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') {
      continue;
    }
    for (const item of track.items) {
      if (item.type === 'text') {
        const key = familyKey(item.style.font);
        if (!families.has(key)) {
          families.set(key, item.style.font.trim());
        }
      }
    }
  }
  return [...families.values()].sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * The families in `wanted` that the manifest lacks, in the order asked.
 * An empty list means the render can draw every text it was given.
 */
export function checkFonts(manifest: FontManifest | null, wanted: readonly string[]): string[] {
  const have = new Set((manifest?.fonts ?? []).map((entry) => familyKey(entry.family)));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const family of wanted) {
    const key = familyKey(family);
    if (!have.has(key) && !seen.has(key)) {
      missing.push(family);
    }
    seen.add(key);
  }
  return missing;
}

/** The manifest entry for a family, or null. */
export function findFont(manifest: FontManifest, family: string): FontManifestEntry | null {
  const key = familyKey(family);
  return manifest.fonts.find((entry) => familyKey(entry.family) === key) ?? null;
}

/**
 * The ASS `Fontsize` that draws a font as large as CSS `font-size: cssPx`.
 * ASS sizes the line height, not the em: `fs = cssPx x (winAscent +
 * winDescent) / unitsPerEm` (Arial at `\fs100` measured a 64 px cap height,
 * as predicted; cookbook section 6). Rounded to two decimals.
 */
export function assFontSize(entry: FontManifestEntry, cssPx: number): number {
  const fs = (cssPx * (entry.winAscent + entry.winDescent)) / entry.unitsPerEm;
  return Math.round(fs * 100) / 100;
}
