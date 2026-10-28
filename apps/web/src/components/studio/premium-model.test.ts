import {
  ART_STYLES,
  CLASSIC_THEME_IDS,
  LUXURY_THEME_IDS,
  SIGNATURE_THEME_IDS,
} from '@postgear/design-engine';
import {
  addsPremiumLook,
  isLookLocked,
  isPremiumArt,
  isPremiumTheme,
  lookTileName,
} from './premium-model';

const LUXURY_THEME = LUXURY_THEME_IDS[0] ?? '';
const OTHER_LUXURY_THEME = LUXURY_THEME_IDS[1] ?? '';
const FREE_THEME = 'ink';

describe('isPremiumTheme', () => {
  it('locks the Luxury collection only', () => {
    expect(LUXURY_THEME_IDS.length).toBeGreaterThan(0);
    expect(LUXURY_THEME_IDS.every(isPremiumTheme)).toBe(true);
    expect(CLASSIC_THEME_IDS.some(isPremiumTheme)).toBe(false);
    expect(SIGNATURE_THEME_IDS.some(isPremiumTheme)).toBe(false);
  });

  it('calls an id the library does not have free, as the API does', () => {
    expect(isPremiumTheme('no-such-theme')).toBe(false);
    expect(isPremiumTheme('toString')).toBe(false);
  });
});

describe('isPremiumArt', () => {
  it('locks the originals and the luxury set, never the patterns', () => {
    for (const art of ART_STYLES) {
      expect(isPremiumArt(art.id)).toBe(art.kind !== 'pattern');
    }
  });

  it('calls None and an unknown id free', () => {
    expect(isPremiumArt(null)).toBe(false);
    expect(isPremiumArt('no-such-art')).toBe(false);
  });
});

describe('isLookLocked', () => {
  const premium = { premium: true };
  const free = { premium: false };

  it('locks a premium look only where the plan is known not to include it', () => {
    expect(isLookLocked(false, premium, false)).toBe(true);
    expect(isLookLocked(true, premium, false)).toBe(false);
    // Not known yet: nothing is locked, and the API still has the last word.
    expect(isLookLocked(null, premium, false)).toBe(false);
  });

  it('never locks a free look, nor the one the design is on', () => {
    expect(isLookLocked(false, free, false)).toBe(false);
    expect(isLookLocked(false, {}, false)).toBe(false);
    expect(isLookLocked(false, premium, true)).toBe(false);
  });
});

describe('addsPremiumLook', () => {
  const saved = { themeId: FREE_THEME, art: null };

  it('is true when the theme or the art changes to a premium one', () => {
    expect(addsPremiumLook(saved, { themeId: LUXURY_THEME, art: null })).toBe(true);
    expect(addsPremiumLook(saved, { themeId: FREE_THEME, art: 'marble' })).toBe(true);
    expect(addsPremiumLook(saved, { themeId: FREE_THEME, art: 'cascade' })).toBe(true);
    // One premium look for another is still a premium look brought in.
    expect(
      addsPremiumLook(
        { themeId: LUXURY_THEME, art: 'marble' },
        { themeId: OTHER_LUXURY_THEME, art: 'marble' },
      ),
    ).toBe(true);
  });

  it('is false for a look the saved design already has, and for free looks', () => {
    const premiumSaved = { themeId: LUXURY_THEME, art: 'marble' };
    expect(addsPremiumLook(premiumSaved, { ...premiumSaved })).toBe(false);
    expect(addsPremiumLook(premiumSaved, { themeId: FREE_THEME, art: 'aurora' })).toBe(false);
    expect(addsPremiumLook(saved, { themeId: 'nocturne', art: 'aurora' })).toBe(false);
    expect(addsPremiumLook(saved, { ...saved })).toBe(false);
  });
});

describe('lookTileName', () => {
  it('says locked only on a locked tile', () => {
    expect(lookTileName('Gilded Noir', true)).toBe('Gilded Noir, locked');
    expect(lookTileName('Ink', false)).toBe('Ink');
  });
});
