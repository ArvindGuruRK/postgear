/**
 * Which family a slot is set in: the element's own font, then the design's,
 * then the brand kit's, then the theme's, and only ever the family.
 */
import { applyBrandKit, documentFromPreset, setDocumentFonts, setElementFont } from './document';
import { fontsOf, themeById } from './themes';
import type { DesignFonts, FontId, TypeRole } from './types';
import { documentFonts, type FontChoices, resolveTypeStyle } from './typography';

/** Ink sets its headings in one family and its body in another, which every test below leans on. */
const theme = themeById('ink');
const THEME_HEADING = theme.type.headline.font;
const THEME_BODY = theme.type.body.font;

/** Three families the theme does not use, one for each level of choice. */
const ELEMENT: FontId = 'jetbrains-mono';
const DESIGN: FontId = 'playfair-display';
const KIT: FontId = 'dm-serif-display';

function choices(design: DesignFonts | null, kit: DesignFonts | null = null): FontChoices {
  return { fonts: design, brand: { fonts: kit } };
}

const ROLES = Object.keys(theme.type) as TypeRole[];

describe('resolveTypeStyle', () => {
  it('uses three families the theme does not', () => {
    expect(THEME_HEADING).not.toBe(THEME_BODY);
    for (const font of [ELEMENT, DESIGN, KIT]) {
      expect([THEME_HEADING, THEME_BODY]).not.toContain(font);
    }
  });

  it('gives back the theme own style when nothing is chosen', () => {
    for (const role of ROLES) {
      expect(resolveTypeStyle(theme, role, choices(null))).toBe(theme.type[role]);
      expect(resolveTypeStyle(theme, role, choices(null), {})).toBe(theme.type[role]);
    }
  });

  it('takes the element font, then the design, then the brand kit, then the theme', () => {
    const all = choices({ heading: DESIGN, body: null }, { heading: KIT, body: null });

    expect(resolveTypeStyle(theme, 'headline', all, { font: ELEMENT }).font).toBe(ELEMENT);
    expect(resolveTypeStyle(theme, 'headline', all).font).toBe(DESIGN);
    expect(
      resolveTypeStyle(theme, 'headline', choices(null, { heading: KIT, body: null })).font,
    ).toBe(KIT);
    expect(resolveTypeStyle(theme, 'headline', choices(null)).font).toBe(THEME_HEADING);
  });

  it('changes the family only, keeping the theme weight, size, spacing and case', () => {
    for (const role of ROLES) {
      const resolved = resolveTypeStyle(theme, role, choices({ heading: DESIGN, body: KIT }));

      expect({ ...resolved, font: theme.type[role].font }).toEqual(theme.type[role]);
    }
  });

  it('moves every role in a face together, and no role in the other face', () => {
    const resolved = (role: TypeRole) =>
      resolveTypeStyle(theme, role, choices({ heading: DESIGN, body: null })).font;

    for (const role of ROLES) {
      const face = theme.type[role].face;
      expect(resolved(role)).toBe(face === 'heading' ? DESIGN : theme.type[role].font);
    }
    expect(ROLES.some((role) => theme.type[role].face === 'body')).toBe(true);
  });

  it('lets a face the design leaves empty fall to the brand kit beneath it', () => {
    const mixed = choices({ heading: null, body: DESIGN }, { heading: KIT, body: ELEMENT });

    expect(resolveTypeStyle(theme, 'headline', mixed).font).toBe(KIT);
    expect(resolveTypeStyle(theme, 'body', mixed).font).toBe(DESIGN);
  });

  it('passes over a family the library does not have, rather than drawing nothing', () => {
    const gone = 'retired-family' as FontId;
    const all = choices({ heading: gone, body: null }, { heading: KIT, body: null });

    expect(resolveTypeStyle(theme, 'headline', all, { font: gone }).font).toBe(KIT);
    expect(resolveTypeStyle(theme, 'headline', choices({ heading: gone, body: null })).font).toBe(
      THEME_HEADING,
    );
  });
});

describe('documentFonts', () => {
  const design = () => documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });

  const sorted = (fonts: FontId[]) => [...fonts].sort();

  it('is the theme families for a design with no choices', () => {
    const document = design();
    expect(sorted(documentFonts(document))).toEqual(sorted(fontsOf(themeById(document.themeId))));
  });

  it('follows the design and kit choices, leaving out a theme face no role uses any more', () => {
    const document = setDocumentFonts(design(), { heading: DESIGN, body: null });
    const fonts = documentFonts(document);

    expect(fonts).toContain(DESIGN);
    expect(fonts).toContain(THEME_BODY);
    expect(fonts).not.toContain(THEME_HEADING);

    const kitted = applyBrandKit(design(), {
      kitId: 'kit-1',
      colors: null,
      logoMediaId: null,
      name: 'Brand',
      kitVersion: null,
      fonts: { heading: null, body: KIT },
    });
    expect(sorted(documentFonts(kitted))).toEqual(sorted([THEME_HEADING, KIT]));
  });

  it('adds every element font, each once', () => {
    let document = design();
    document = setElementFont(document, document.slides[0].id, 'headline', ELEMENT);
    document = setElementFont(document, document.slides[2].id, 'headline', ELEMENT);
    document = setElementFont(document, document.slides[1].id, 'list', KIT);

    const fonts = documentFonts(document);

    expect(sorted(fonts)).toEqual(sorted([THEME_HEADING, THEME_BODY, ELEMENT, KIT]));
    expect(new Set(fonts).size).toBe(fonts.length);
  });
});
