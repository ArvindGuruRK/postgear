/**
 * The font manifest: which fonts the render can draw text in, and the
 * numbers that make the editor and the export agree.
 *
 * Facts this rests on (the Module 11 spike, FFmpeg 9.0.2, 2026-11-18):
 * - libass reads only TTF and OTF; WOFF2 fails with "Error opening memory
 *   font" (cookbook section 6).
 * - libass draws a variable font's **default instance** whatever weight is
 *   asked (Playfair Display at 900 came out as its 400), so every weight is
 *   a static file of its own.
 * - A family name that matches nothing **falls back silently** (Montserrat's
 *   variable file names itself "Montserrat Thin", and "Montserrat" drew in
 *   Arial). So each twin carries its own unique family name (`assName`),
 *   the ASS style names exactly that, and the render checks libass's
 *   `fontselect:` lines, which name the **PostScript name** it chose
 *   (`psName`), never the file.
 * - Asking for a heavier weight than the face makes libass fake-bold it; an
 *   exact match draws the real face. The style asks for the twin's own weight.
 *
 * `clips:fonts:build` writes the twins, `manifest.json` beside them, and the
 * committed copy `fonts-manifest.ts` that the web app and the tests read
 * (no font file needed). A twin's internal name never carries a family's
 * Reserved Font Name: an instanced variable font is a Modified Version under
 * the OFL.
 *
 * Pure: strings and numbers.
 */
import { z } from 'zod';
import type { ClipDocument, TextStyle } from '../document/schema';
import { BADGE } from '../document/sticker';

/** The manifest's file name inside the fonts folder. */
export const FONT_MANIFEST_FILE = 'manifest.json';

/** The fonts folder's name inside a render's scratch folder (`ass=...:fontsdir=fonts`). */
export const FONTS_DIR = 'fonts';

export const FONT_MANIFEST_VERSION = 2 as const;

export const fontManifestEntrySchema = z
  .object({
    /** The Studio font id (`montserrat`), or a fallback's own id (`noto-sans-tamil`). */
    fontId: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/),
    /** The family name a text item writes and the browser draws (`Montserrat`). */
    family: z.string().trim().min(1).max(80),
    /** The twin's weight: a static file per weight. */
    weight: z.number().int().min(100).max(900),
    /** The twin's own family name, which the ASS `Fontname` writes (never a Reserved Font Name). */
    assName: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9 ]+$/),
    /** The twin's PostScript name, which libass's `fontselect:` lines report. */
    psName: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9-]+$/),
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
    /** A script fallback (Noto Sans Tamil, Devanagari): used for letters the chosen font lacks, never offered. */
    fallback: z.boolean(),
  })
  .strict();

/** Inclusive `[first, last]` code point ranges, sorted and merged. */
const coverageSchema = z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)]));

export const fontManifestSchema = z
  .object({
    version: z.literal(FONT_MANIFEST_VERSION),
    fonts: z.array(fontManifestEntrySchema),
    /** What each font id can draw (the same for all of its weights: the build keeps the common part). */
    coverage: z.record(coverageSchema),
  })
  .strict();

export type FontManifestEntry = z.infer<typeof fontManifestEntrySchema>;
export type FontManifest = z.infer<typeof fontManifestSchema>;
export type FontCoverage = z.infer<typeof coverageSchema>;

/** A manifest with nothing in it. */
export function emptyFontManifest(): FontManifest {
  return { version: FONT_MANIFEST_VERSION, fonts: [], coverage: {} };
}

/** Parses a manifest read from disk; throws a ZodError when it has the wrong shape. */
export function parseFontManifest(raw: unknown): FontManifest {
  return fontManifestSchema.parse(raw);
}

/** Family names compare as the browser does: case does not matter. */
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
      } else if ('badge' in item.ref) {
        // The Follow Badge's two lines are drawn in its own font.
        const key = familyKey(BADGE.font);
        if (!families.has(key)) {
          families.set(key, BADGE.font);
        }
      }
    }
  }
  return [...families.values()].sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * The families in `wanted` that the manifest cannot draw (no weight of it at
 * all), in the order asked. Fallback fonts never count: nobody picks them.
 */
export function checkFonts(manifest: FontManifest | null, wanted: readonly string[]): string[] {
  const have = new Set(
    (manifest?.fonts ?? []).filter((entry) => !entry.fallback).map((entry) => familyKey(entry.family)),
  );
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

/** The weights the manifest has for a family, lightest first (empty when it has none). */
export function familyWeights(manifest: FontManifest, family: string): number[] {
  const key = familyKey(family);
  return [
    ...new Set(
      manifest.fonts
        .filter((entry) => !entry.fallback && familyKey(entry.family) === key)
        .map((entry) => entry.weight),
    ),
  ].sort((a, b) => a - b);
}

/** The nearest of `weights` to `wanted`; a tie goes to the heavier one. */
export function nearestWeight(weights: readonly number[], wanted: number): number | null {
  let best: number | null = null;
  for (const weight of weights) {
    if (
      best === null ||
      Math.abs(weight - wanted) < Math.abs(best - wanted) ||
      (Math.abs(weight - wanted) === Math.abs(best - wanted) && weight > best)
    ) {
      best = weight;
    }
  }
  return best;
}

/**
 * The twin a text is drawn with: its family at the nearest weight the
 * manifest has, or null when the family is not there at all. The preview
 * and the compiler both call this, so a weight the font lacks is drawn as
 * the same nearest one on both sides.
 */
export function resolveTextFont(
  manifest: FontManifest,
  family: string,
  weight: number,
): FontManifestEntry | null {
  const key = familyKey(family);
  const candidates = manifest.fonts.filter(
    (entry) => !entry.fallback && familyKey(entry.family) === key,
  );
  const chosen = nearestWeight(
    candidates.map((entry) => entry.weight),
    weight,
  );
  return candidates.find((entry) => entry.weight === chosen) ?? null;
}

/** The manifest entry for a family at any weight, or null. */
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

/** The line height libass uses, in ems of the font (its own Windows ascent plus descent). */
export function lineHeightEm(entry: FontManifestEntry): number {
  return (entry.winAscent + entry.winDescent) / entry.unitsPerEm;
}

export interface TextBoxMetrics {
  entry: FontManifestEntry;
  /** CSS `line-height` in ems: lines are spaced as libass spaces them. */
  lineHeightEm: number;
  /** One line's height in canvas pixels at the style's size. */
  lineHeightPx: number;
  /** The ASS `Fontsize` for the style's size. */
  assFontSize: number;
}

/**
 * The numbers a text box is laid out with, for a style at an item scale.
 * Null when the manifest has no weight of the family. Sprint 13's caption
 * pager reads the same function.
 */
export function textBoxMetrics(
  style: Pick<TextStyle, 'font' | 'weight' | 'size'>,
  manifest: FontManifest,
  scale = 1,
): TextBoxMetrics | null {
  const entry = resolveTextFont(manifest, style.font, style.weight);
  if (!entry) {
    return null;
  }
  const em = lineHeightEm(entry);
  const size = style.size * scale;
  return { entry, lineHeightEm: em, lineHeightPx: size * em, assFontSize: assFontSize(entry, size) };
}

/** Whether a code point is in a sorted range list. */
export function covers(coverage: FontCoverage | undefined, codePoint: number): boolean {
  if (!coverage) {
    return false;
  }
  let low = 0;
  let high = coverage.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = coverage[mid] as [number, number];
    if (codePoint < range[0]) {
      high = mid - 1;
    } else if (codePoint > range[1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/** Characters every font may lack without harm: they draw nothing (spaces are in every font). */
function drawsNothing(codePoint: number): boolean {
  return (
    codePoint === 0x0a ||
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0x2060 ||
    codePoint === 0xfeff
  );
}

/** A joining mark or format character: it belongs with the letter before it. */
function joinsPrevious(char: string): boolean {
  return /\p{M}|\p{Cf}/u.test(char);
}

/** One run of a text drawn in one font. */
export interface TextRun {
  text: string;
  entry: FontManifestEntry;
}

export type TextRunsResult =
  | { ok: true; runs: TextRun[] }
  /** Characters no font in the manifest can draw, each once, in the order met. */
  | { ok: false; missing: string[] };

/**
 * A text split into runs by font: letters the chosen twin draws stay in it;
 * the others go to the first fallback that has them (at the fallback's
 * nearest weight). Marks and joiners stay with the letter before them, so a
 * Tamil or Hindi cluster is never cut in two. Runs of the same font are
 * merged. Fails with the characters nobody can draw.
 */
export function textRuns(text: string, main: FontManifestEntry, manifest: FontManifest): TextRunsResult {
  const fallbacks = [
    ...new Set(manifest.fonts.filter((entry) => entry.fallback).map((entry) => entry.fontId)),
  ].map((fontId) => {
    const weights = manifest.fonts.filter((entry) => entry.fontId === fontId);
    const chosen = nearestWeight(
      weights.map((entry) => entry.weight),
      main.weight,
    );
    return weights.find((entry) => entry.weight === chosen) as FontManifestEntry;
  });

  const runs: TextRun[] = [];
  const missing: string[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number;
    const previous = runs[runs.length - 1];
    let entry: FontManifestEntry | null = null;
    if (covers(manifest.coverage[main.fontId], codePoint)) {
      entry = main;
    } else if (previous && joinsPrevious(char)) {
      entry = previous.entry;
    } else {
      entry =
        fallbacks.find((fallback) => covers(manifest.coverage[fallback.fontId], codePoint)) ??
        (drawsNothing(codePoint) ? (previous?.entry ?? main) : null);
    }
    // A mark the main font has still joins a fallback run before it (a Tamil vowel sign after a Tamil letter).
    if (entry === main && previous && previous.entry !== main && joinsPrevious(char)) {
      entry = previous.entry;
    }
    if (!entry) {
      if (!missing.includes(char)) {
        missing.push(char);
      }
      continue;
    }
    if (previous && previous.entry === entry) {
      previous.text += char;
    } else {
      runs.push({ text: char, entry });
    }
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, runs };
}

/**
 * The characters of a text that no font can draw for this family and
 * weight, for the Text panel's warning. Empty when everything draws (or the
 * family is unknown: the font picker shows that problem instead).
 */
export function missingCharacters(
  text: string,
  family: string,
  weight: number,
  manifest: FontManifest,
): string[] {
  const main = resolveTextFont(manifest, family, weight);
  if (!main) {
    return [];
  }
  const result = textRuns(text, main, manifest);
  return result.ok ? [] : result.missing;
}
