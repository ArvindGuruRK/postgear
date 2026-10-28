/**
 * The design fonts (Sprint 9), declared for every screen that draws a slide.
 *
 * A design is set in its theme's families, not in the app's Sora, and the
 * export renders the very same files: the API serves them from
 * `packages/design-engine/fonts/` at `/public/studio-fonts/:file`, and the
 * exporter inlines those bytes. So a slide in the editor and the image it
 * exports break their lines in the same places.
 *
 * React hoists a `<style>` that has `href` and `precedence` into the head
 * and keeps one copy, however many screens render this.
 */
import { buildFontStylesheet, FONT_IDS, FONTS, faceWeight } from '@postgear/design-engine';
import { BROWSER_API_URL } from '@/lib/api';

const STYLESHEET = buildFontStylesheet(
  FONT_IDS.flatMap((id) =>
    FONTS[id].faces.map((face) => ({
      family: FONTS[id].family,
      weight: faceWeight(face),
      url: `${BROWSER_API_URL}/public/studio-fonts/${encodeURIComponent(face.file)}`,
    })),
  ),
);

export function StudioFonts() {
  return (
    <style href="postgear-studio-fonts" precedence="default">
      {STYLESHEET}
    </style>
  );
}
