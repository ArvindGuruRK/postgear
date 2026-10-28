import {
  applyBrand,
  checkContrast,
  PHOTO_INK,
  PHOTO_INK_DARK,
  PHOTO_INK_DARK_MUTED,
  PHOTO_INK_MUTED,
  paletteForSlide,
  photoGround,
  photoNeedsDarkening,
  photoOverlayColor,
  SAFE_PHOTO_OVERLAY,
  slideGround,
} from './brand';
import { AA_CONTRAST, contrastRatio, meetsAA, normalizeHex, rgbToHex } from './color';
import { THEMES, themeById } from './themes';
import type { BrandColors, DesignSlide, PhotoTint } from './types';

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

describe('photo tints', () => {
  /** Every overlay from the safe strength to solid, in steps of 0.01 (integers, so no drift). */
  const safe = Math.round(SAFE_PHOTO_OVERLAY * 100);
  const SAFE_AND_UP = Array.from({ length: 100 - safe + 1 }, (_, step) => (safe + step) / 100);

  const photo = (overlay: number, tint?: PhotoTint) =>
    slide(
      tint
        ? { kind: 'media', mediaId: 'media-1', overlay, tint }
        : { kind: 'media', mediaId: 'media-1', overlay },
    );

  it('lays the overlay in black for the dark tint and in white for the light one', () => {
    expect(photoOverlayColor()).toBe('#000000');
    expect(photoOverlayColor('dark')).toBe('#000000');
    expect(photoOverlayColor('light')).toBe('#FFFFFF');
  });

  it('judges a dark-tinted photo as before: a white photo under the black overlay', () => {
    expect(photoGround(SAFE_PHOTO_OVERLAY)).toBe('#666666');

    for (const overlay of [0, 0.3, ...SAFE_AND_UP]) {
      expect(photoGround(overlay, 'dark')).toBe(photoGround(overlay));
    }
    // A weaker overlay is the warning's business, not a lighter ground.
    expect(photoGround(0.2)).toBe(photoGround(SAFE_PHOTO_OVERLAY));
  });

  it('judges a light-tinted photo against the darkest a white overlay can leave it', () => {
    expect(photoGround(SAFE_PHOTO_OVERLAY, 'light')).toBe('#999999');
    expect(photoGround(1, 'light')).toBe('#FFFFFF');
    expect(photoGround(0.2, 'light')).toBe(photoGround(SAFE_PHOTO_OVERLAY, 'light'));
  });

  it('gives a light-tinted photo dark inks that clear AA from the safe overlay to solid', () => {
    for (const overlay of SAFE_AND_UP) {
      const ground = photoGround(overlay, 'light');

      expect(contrastRatio(PHOTO_INK_DARK, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
      expect(contrastRatio(PHOTO_INK_DARK_MUTED, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('keeps the dark tint light inks, which clear AA over the same range', () => {
    for (const overlay of SAFE_AND_UP) {
      const ground = photoGround(overlay);

      expect(contrastRatio(PHOTO_INK, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
      expect(contrastRatio(PHOTO_INK_MUTED, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('turns the inks dark under a light tint and light under a dark one, whatever the theme', () => {
    for (const theme of THEMES) {
      for (const brand of [null, TEAL]) {
        const light = paletteForSlide(theme, brand, photo(0.6, 'light'));
        const dark = paletteForSlide(theme, brand, photo(0.6, 'dark'));
        const untinted = paletteForSlide(theme, brand, photo(0.6));

        expect([light.text, light.textMuted]).toEqual([PHOTO_INK_DARK, PHOTO_INK_DARK_MUTED]);
        expect([dark.text, dark.textMuted]).toEqual([PHOTO_INK, PHOTO_INK_MUTED]);
        expect(untinted).toEqual(dark);
        // Only the inks written on the photo change; the fills stay the brand's.
        expect(light.primary).toBe(dark.primary);
        expect(light.accent).toBe(dark.accent);
      }
    }
  });

  it('calls an overlay too weak below the safe strength, whichever way it is tinted', () => {
    for (const tint of [undefined, 'dark', 'light'] as const) {
      expect(photoNeedsDarkening(photo(0.2, tint))).toBe(true);
      expect(photoNeedsDarkening(photo(SAFE_PHOTO_OVERLAY, tint))).toBe(false);
    }
    expect(photoNeedsDarkening(slide({ kind: 'role', role: 'background' }))).toBe(false);
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
