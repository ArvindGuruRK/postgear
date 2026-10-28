import { applyBrand, checkContrast, paletteForSlide, slideGround } from './brand';
import { AA_CONTRAST, contrastRatio, meetsAA, normalizeHex, rgbToHex } from './color';
import { THEMES, themeById } from './themes';
import type { BrandColors, DesignSlide } from './types';

const TEAL: BrandColors = {
  primary: '#0F766E',
  secondary: '#115E59',
  accent: '#F97316',
  background: '#FFFFFF',
  text: '#0A0A0A',
};

function slide(background: DesignSlide['background']): Pick<DesignSlide, 'background'> {
  return { background };
}

describe('applyBrand', () => {
  it('keeps the five colours the user chose', () => {
    const palette = applyBrand(themeById('ink'), TEAL);

    expect(palette.primary).toBe('#0F766E');
    expect(palette.secondary).toBe('#115E59');
    expect(palette.accent).toBe('#F97316');
    expect(palette.background).toBe('#FFFFFF');
    expect(palette.text).toBe('#0A0A0A');
  });

  it('returns the theme untouched when there is no brand kit', () => {
    expect(applyBrand(themeById('midnight'), null)).toEqual(themeById('midnight').colors);
  });

  it('replaces a text colour that cannot be read on the brand background', () => {
    // White text on a white background is the mistake a kit most often holds.
    const palette = applyBrand(themeById('ink'), { ...TEAL, text: '#FFFFFF' });

    expect(palette.text).not.toBe('#FFFFFF');
    expect(meetsAA(palette.text, palette.background)).toBe(true);
  });

  it('derives inks that read on the fill they sit on', () => {
    const palette = applyBrand(themeById('ink'), TEAL);

    expect(meetsAA(palette.onPrimary, palette.primary)).toBe(true);
    expect(meetsAA(palette.onAccent, palette.accent)).toBe(true);
    expect(meetsAA(palette.onSurface, palette.surface)).toBe(true);
  });

  it('never produces unreadable text, for any five colours at all', () => {
    // A deterministic sweep rather than a random one: a failure has to be
    // reproducible, and 4 096 palettes is enough to cover the corners.
    const steps = [0x00, 0x44, 0x88, 0xcc, 0xf0, 0xff];
    const theme = themeById('ink');

    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const ground = rgbToHex({ r, g, b });
          const palette = applyBrand(theme, {
            primary: ground,
            secondary: ground,
            accent: ground,
            background: ground,
            text: ground,
          });

          expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(
            AA_CONTRAST,
          );
          expect(contrastRatio(palette.textMuted, palette.background)).toBeGreaterThanOrEqual(
            AA_CONTRAST,
          );
          expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(
            AA_CONTRAST,
          );
          expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(
            AA_CONTRAST,
          );
          expect(contrastRatio(palette.onSurface, palette.surface)).toBeGreaterThanOrEqual(
            AA_CONTRAST,
          );
        }
      }
    }
  });

  it('ignores a value that is not a colour and keeps the one from the theme', () => {
    const palette = applyBrand(themeById('ink'), { ...TEAL, primary: 'rgb(1,2,3)' });
    expect(palette.primary).toBe(themeById('ink').colors.primary);
  });
});

describe('paletteForSlide', () => {
  it('turns the ink white under a photo, because the overlay darkens', () => {
    const palette = paletteForSlide(
      themeById('ink'),
      TEAL,
      slide({
        kind: 'media',
        mediaId: '11111111-1111-4111-8111-111111111111',
        overlay: 0.4,
      }),
    );

    expect(palette.text).toBe('#FFFFFF');
  });

  it('keeps text readable on a custom background colour', () => {
    const palette = paletteForSlide(
      themeById('ink'),
      TEAL,
      slide({ kind: 'color', hex: '#0A0A0A' }),
    );

    expect(meetsAA(palette.text, '#0A0A0A')).toBe(true);
    expect(palette.background).toBe('#0A0A0A');
  });

  it('keeps text readable when the slide takes a role as its ground', () => {
    for (const theme of THEMES) {
      for (const role of [
        'primary',
        'secondary',
        'accent',
        'surface',
        'text',
        'textMuted',
      ] as const) {
        const palette = paletteForSlide(theme, null, slide({ kind: 'role', role }));
        const ground = slideGround(palette, slide({ kind: 'role', role }));

        expect(contrastRatio(palette.text, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
        expect(contrastRatio(palette.textMuted, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
      }
    }
  });

  it('paints a slide in the colour of the role it names, inks included', () => {
    for (const theme of THEMES) {
      for (const brand of [null, TEAL]) {
        const colors = applyBrand(theme, brand);

        for (const role of [
          'primary',
          'secondary',
          'accent',
          'surface',
          'text',
          'textMuted',
        ] as const) {
          const palette = paletteForSlide(theme, brand, slide({ kind: 'role', role }));

          expect(slideGround(palette, slide({ kind: 'role', role }))).toBe(colors[role]);
        }
      }
    }
  });

  it('draws a slide grounded on the text colour inverted, with panels and inks to match', () => {
    const ink = themeById('ink');
    const palette = paletteForSlide(ink, null, slide({ kind: 'role', role: 'text' }));

    expect(palette.background).toBe(ink.colors.text);
    expect(palette.text).not.toBe(ink.colors.text);
    expect(meetsAA(palette.onSurface, palette.surface)).toBe(true);
    // Fills keep the brand's colours: only the ground and what is written on it change.
    expect(palette.primary).toBe(ink.colors.primary);
    expect(palette.accent).toBe(ink.colors.accent);
  });
});

describe('checkContrast', () => {
  it('passes a readable pairing and suggests nothing', () => {
    const verdict = checkContrast('#111111', '#FFFFFF');
    expect(verdict.readable).toBe(true);
    expect(verdict.suggestion).toBeNull();
  });

  it('fails an unreadable one and suggests an ink that works', () => {
    const verdict = checkContrast('#FFE94A', '#FFFFFF');
    expect(verdict.readable).toBe(false);
    expect(verdict.suggestion).not.toBeNull();
    expect(meetsAA(verdict.suggestion as string, '#FFFFFF')).toBe(true);
  });
});

describe('normalizeHex', () => {
  it('accepts three and six digits, with or without the hash', () => {
    expect(normalizeHex('abc')).toBe('#AABBCC');
    expect(normalizeHex('#AaBbCc')).toBe('#AABBCC');
    expect(normalizeHex(' #123456 ')).toBe('#123456');
  });

  it('refuses anything else', () => {
    for (const value of ['', '#12', '#12345', 'red', 'rgb(0,0,0)', '#12345g', 'javascript:x']) {
      expect(normalizeHex(value)).toBeNull();
    }
  });
});
