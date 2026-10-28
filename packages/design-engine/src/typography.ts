/**
 * Which family each piece of text is set in.
 *
 * A theme decides the type: a family, a weight, a size, a line height and a
 * letter spacing for every role. Three choices can replace the **family**,
 * and only the family, in this order:
 *
 * 1. the element's own font (`ElementState.font`), on one slot of one slide;
 * 2. the design's fonts (`DesignDocument.fonts`), one per face;
 * 3. the brand kit's fonts (`DesignBrand.fonts`), copied in with its colours;
 * 4. the theme's own.
 *
 * The design and the kit choose a **face**, not a role. Picking a heading
 * font changes the headline, the quote, the statistic and every other role
 * the theme sets in its heading face, together, so the theme's hierarchy
 * survives the swap. Weight, size, line height and tracking stay the
 * theme's, so a new family keeps the slide's rhythm; `resolveWeight` snaps
 * the weight to what the chosen family has, at the point it is drawn.
 *
 * The renderer, the exporter's list of faces to inline and the editor all
 * ask this file, so the face a user sees is the face that is exported.
 */
import { FONTS } from './fonts';
import { themeById } from './themes';
import type {
  DesignBrand,
  DesignDocument,
  ElementState,
  FontId,
  Theme,
  TypeFace,
  TypeRole,
  TypeStyle,
} from './types';

/** What the resolution reads of a design: its own fonts and its brand kit's. */
export type FontChoices = Pick<DesignDocument, 'fonts'> & { brand: Pick<DesignBrand, 'fonts'> };

/**
 * True for a family the library ships. `Object.hasOwn`, so a stored
 * `"toString"` is not a font. The schema refuses any other id on the way in;
 * the resolution still checks, so a design built in memory with a family a
 * later release dropped falls back to the next choice rather than drawing
 * nothing.
 */
export function isKnownFont(value: unknown): value is FontId {
  return typeof value === 'string' && Object.hasOwn(FONTS, value);
}

/**
 * One role's type on one slot: the theme's style, with the family the
 * choices above give it. The theme's own object comes back when nothing
 * replaces its family, so an unchanged slot costs nothing.
 */
export function resolveTypeStyle(
  theme: Theme,
  role: TypeRole,
  document: FontChoices,
  element?: Pick<ElementState, 'font'> | null,
): TypeStyle {
  const style = theme.type[role];
  const font = chosenFont(style.face, document, element) ?? style.font;

  return font === style.font ? style : { ...style, font };
}

/** The family the user's choices give a face, or null to keep the theme's. */
function chosenFont(
  face: TypeFace,
  document: FontChoices,
  element: Pick<ElementState, 'font'> | null | undefined,
): FontId | null {
  for (const candidate of [element?.font, document.fonts?.[face], document.brand.fonts?.[face]]) {
    if (isKnownFont(candidate)) return candidate;
  }

  return null;
}

/**
 * Every family a design draws with, each once: every type role through the
 * resolution above, then every element's own font on every slide. The API's
 * exporter inlines exactly these, so a design set in a font of the user's
 * choosing exports in it, and a theme face no role uses any more is not
 * shipped inside every slide.
 */
export function documentFonts(
  document: FontChoices & Pick<DesignDocument, 'themeId' | 'slides'>,
): FontId[] {
  const theme = themeById(document.themeId);
  const fonts = new Set<FontId>();

  for (const role of Object.keys(theme.type) as TypeRole[]) {
    fonts.add(resolveTypeStyle(theme, role, document).font);
  }

  for (const slide of document.slides) {
    for (const state of Object.values(slide.elements)) {
      const font = state?.font;
      if (isKnownFont(font)) fonts.add(font);
    }
  }

  return [...fonts];
}
