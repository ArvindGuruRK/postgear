/**
 * Guards the one promise a theme makes: everything it pairs can be read.
 *
 * A new theme is a palette somebody chose by eye, and an eye is exactly what
 * misses a 4.1:1 pairing. This runs the numbers on every role combination the
 * layouts actually draw, so a theme that cannot be read never reaches a user.
 */
import { AA_CONTRAST, contrastRatio } from '../color';
import { FONTS } from '../fonts';
import { COLOR_ROLES, type ColorRole } from '../types';
import { DEFAULT_THEME_ID, fontsOf, isThemeId, THEMES, themeById } from './index';

/** The pairings the layouts use: ink on the ground it is drawn on. */
const PAIRS: Array<[ink: ColorRole, ground: ColorRole]> = [
  ['text', 'background'],
  ['textMuted', 'background'],
  ['accent', 'background'],
  ['primary', 'background'],
  ['onPrimary', 'primary'],
  ['onAccent', 'accent'],
  ['onSurface', 'surface'],
];

describe('every theme', () => {
  it('states every colour role', () => {
    for (const theme of THEMES) {
      for (const role of COLOR_ROLES) {
        expect(theme.colors[role]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it('clears WCAG AA on every pairing a layout draws', () => {
    const failures: string[] = [];

    for (const theme of THEMES) {
      for (const [ink, ground] of PAIRS) {
        const ratio = contrastRatio(theme.colors[ink], theme.colors[ground]);
        if (ratio < AA_CONTRAST) {
          failures.push(`${theme.id}: ${ink} on ${ground} is ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('names only fonts the package bundles', () => {
    for (const theme of THEMES) {
      for (const font of fontsOf(theme)) {
        expect(FONTS[font]).toBeDefined();
      }
    }
  });

  it('has a unique id and a name', () => {
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
    for (const theme of THEMES) expect(theme.name.trim()).not.toBe('');
  });

  it('covers all three styles the gallery filters by', () => {
    const styles = new Set(THEMES.map((theme) => theme.style));
    expect(styles).toEqual(new Set(['light', 'dark', 'colourful']));
  });

  it('sizes a headline larger than its body copy', () => {
    for (const theme of THEMES) {
      expect(theme.type.headline.size).toBeGreaterThan(theme.type.body.size);
      expect(theme.type.stat.size).toBeGreaterThan(theme.type.headline.size);
      expect(theme.type.footer.size).toBeLessThan(theme.type.body.size);
    }
  });
});

describe('themeById', () => {
  it('falls back rather than returning nothing', () => {
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true);
    expect(themeById('not-a-theme').id).toBe(DEFAULT_THEME_ID);
  });

  it('never finds a name from the object prototype', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(isThemeId(name)).toBe(false);
      expect(themeById(name).id).toBe(DEFAULT_THEME_ID);
    }
  });
});
