/**
 * The theme catalog: the shipped light and dark sets, their free/premium
 * split, the fallback a premium or retired id reads as, and that every entry
 * matches its block in colors.css.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DARK_THEMES,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  effectiveTheme,
  isPremiumTheme,
  isThemeId,
  LIGHT_THEMES,
  type Theme,
  THEMES,
} from './appearance.catalog';

describe('appearance catalog', () => {
  it('ships six free light themes, Classic first, then six premium ones', () => {
    expect(LIGHT_THEMES.map((theme) => theme.id)).toEqual([
      'classic',
      'cream',
      'paper',
      'white',
      'cool',
      'lilac',
      'mint',
      'grape',
      'peach',
      'sky',
      'rose',
      'lemon',
    ]);
    expect(LIGHT_THEMES.filter((theme) => !theme.premium)).toHaveLength(6);
    expect(LIGHT_THEMES.filter((theme) => theme.premium)).toHaveLength(6);
    expect(LIGHT_THEMES.slice(6).every((theme) => theme.premium)).toBe(true);
    expect(DEFAULT_LIGHT_THEME).toBe('classic');
    expect(isPremiumTheme('light', DEFAULT_LIGHT_THEME)).toBe(false);
  });

  it('ships six free dark themes, Classic first, then six premium ones', () => {
    expect(DARK_THEMES.map((theme) => theme.id)).toEqual([
      'classic',
      'midnight',
      'forest',
      'plum',
      'ocean',
      'mocha',
      'obsidian',
      'nebula',
      'ember',
      'aurora',
      'slate',
      'orchid',
    ]);
    expect(DARK_THEMES.filter((theme) => !theme.premium)).toHaveLength(6);
    expect(DARK_THEMES.filter((theme) => theme.premium)).toHaveLength(6);
    expect(DARK_THEMES.slice(6).every((theme) => theme.premium)).toBe(true);
    expect(DEFAULT_DARK_THEME).toBe('classic');
    expect(isPremiumTheme('dark', DEFAULT_DARK_THEME)).toBe(false);
  });

  it('serves both lists as one, light first, each entry tagged with its mode', () => {
    expect(THEMES).toEqual([...LIGHT_THEMES, ...DARK_THEMES]);
    expect(LIGHT_THEMES.every((theme) => theme.mode === 'light')).toBe(true);
    expect(DARK_THEMES.every((theme) => theme.mode === 'dark')).toBe(true);
  });

  it('gives every theme a complete seven-hex swatch and the brand blue as its accent', () => {
    for (const theme of THEMES) {
      expect(Object.keys(theme.swatch).sort()).toEqual(
        ['accent', 'card', 'chrome', 'field', 'ink', 'outline', 'page'].sort(),
      );
      for (const value of Object.values(theme.swatch)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(theme.swatch.accent).toBe('#1d4ed8');
    }
  });

  it('knows its own ids, per mode, and nothing else', () => {
    expect(isThemeId('light', 'mint')).toBe(true);
    expect(isThemeId('dark', 'mint')).toBe(false);
    expect(isThemeId('dark', 'nebula')).toBe(true);
    expect(isThemeId('light', 'nebula')).toBe(false);
    expect(isThemeId('light', 'classic')).toBe(true);
    expect(isThemeId('dark', 'classic')).toBe(true);
    expect(isThemeId('light', 'Mint')).toBe(false);
    expect(isThemeId('light', 'neon')).toBe(false);
    expect(isThemeId('dark', undefined)).toBe(false);
    expect(isThemeId('dark', 3)).toBe(false);
  });

  it('serves a premium id as Classic unless unlocked, and a retired id as Classic always', () => {
    expect(effectiveTheme('light', 'grape', false)).toBe('classic');
    expect(effectiveTheme('light', 'grape', true)).toBe('grape');
    expect(effectiveTheme('light', 'paper', false)).toBe('paper');
    expect(effectiveTheme('light', 'cream', false)).toBe('cream');
    expect(effectiveTheme('light', 'trial-sunset', true)).toBe('classic');
    expect(effectiveTheme('dark', 'nebula', false)).toBe('classic');
    expect(effectiveTheme('dark', 'nebula', true)).toBe('nebula');
    expect(effectiveTheme('dark', 'forest', false)).toBe('forest');
    // An id from the other mode is not a theme in this one.
    expect(effectiveTheme('dark', 'paper', true)).toBe('classic');
  });

  // The swatch is a hand-kept copy of colors.css; this is what keeps the two
  // from drifting. Classic is the base `.light` / `.dark` system, spread over
  // the file's several base blocks, so it is checked against all of them
  // together; every other theme against its own attribute block.
  describe('colors.css', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../../../../../packages/ui/src/styles/colors.css'),
      'utf8',
    );

    function expectSwatch(body: string, theme: Theme) {
      expect(body).toContain(`--color-primary: ${theme.swatch.page};`);
      expect(body).toContain(`--color-chrome: ${theme.swatch.chrome};`);
      expect(body).toContain(`--color-secondary: ${theme.swatch.card};`);
      expect(body).toContain(`--color-field: ${theme.swatch.field};`);
      expect(body).toContain(`--color-ink: ${theme.swatch.ink};`);
      expect(body).toContain(`--color-outline: ${theme.swatch.outline};`);
    }

    it.each([
      ['light', LIGHT_THEMES],
      ['dark', DARK_THEMES],
    ] as const)('has a matching %s block for every theme, with the same hexes', (mode, themes) => {
      const base = [...css.matchAll(new RegExp(`\\.${mode}\\s*\\{([^}]*)\\}`, 'g'))]
        .map((match) => match[1])
        .join('\n');

      for (const theme of themes) {
        if (theme.id === 'classic') {
          expectSwatch(base, theme);
          continue;
        }

        const block = css.match(
          new RegExp(`\\.${mode}\\[data-${mode}-theme='${theme.id}'\\]\\s*\\{([^}]*)\\}`),
        );
        expect(block).not.toBeNull();
        expectSwatch(block?.[1] ?? '', theme);
      }
    });

    it('has no attribute block for a theme the catalog does not ship', () => {
      for (const mode of ['light', 'dark'] as const) {
        const ids = [
          ...css.matchAll(new RegExp(`\\.${mode}\\[data-${mode}-theme='([a-z]+)'\\]`, 'g')),
        ].map((match) => match[1]);
        expect(ids.every((id) => isThemeId(mode, id) && id !== 'classic')).toBe(true);
      }
    });
  });
});
