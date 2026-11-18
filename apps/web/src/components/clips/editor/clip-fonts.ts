/**
 * The fonts a clip's text can use (Module 11), for the editor: the Studio
 * families the export has a twin of (the font manifest), how the preview
 * names each in CSS, and the font picker's id for a family.
 *
 * The preview draws with the Studio's own WOFF2 files (`StudioFonts`
 * declares them); letters a family lacks fall to Noto Sans Tamil, Noto Sans
 * Devanagari or Nirmala UI when the computer has them, while the export
 * always uses the Noto twins. That difference is written down in the README.
 */
import { FONT_IDS, FONTS, type FontId } from '@postgear/design-engine';
import { FONT_MANIFEST } from '@postgear/video-engine';

/** The script fallbacks the preview asks for after a family. */
const SCRIPT_FALLBACKS = '"Noto Sans Tamil", "Noto Sans Devanagari", "Nirmala UI"';

const BY_FAMILY = new Map<string, FontId>(FONT_IDS.map((id) => [FONTS[id].family, id]));

/** The Studio font id of a family name, or null for a family the Studio does not ship. */
export function fontIdOf(family: string): FontId | null {
  return BY_FAMILY.get(family) ?? null;
}

/** The families a clip's text can use: every Studio font the export has a twin of. */
export const CLIP_FONT_IDS: readonly FontId[] = FONT_IDS.filter((id) =>
  FONT_MANIFEST.fonts.some((entry) => !entry.fallback && entry.fontId === id),
);

/** The CSS `font-family` the preview draws a family with. */
export function clipFontFamily(family: string): string {
  const id = fontIdOf(family);
  const name = `"${family.replace(/"/g, '')}"`;
  return id
    ? `${name}, ${SCRIPT_FALLBACKS}, ${FONTS[id].fallback}`
    : `${name}, ${SCRIPT_FALLBACKS}, sans-serif`;
}
