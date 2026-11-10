/**
 * The scripts X counts double, checked against the composer's own counter,
 * and the languages that land on them.
 */
import { xWeightedLength } from '@postgear/social-core';
import { strictestLimit } from './ai.service';
import { writtenHeavyOnX, X_HEAVY_SCRIPTS } from './x-heavy-scripts';

/** One ordinary letter of each listed script. */
const HEAVY_SAMPLES: Record<string, string> = {
  Bopo: 'ㄅ',
  Cans: 'ᐃ',
  Cher: 'Ꭰ',
  Ethi: 'አ',
  Hang: '한',
  Hani: '字',
  Hans: '汉',
  Hant: '漢',
  Hira: 'あ',
  Jpan: 'カ',
  Kana: 'カ',
  Khmr: 'ក',
  Kore: '한',
  Mong: 'ᠮ',
  Olck: 'ᱚ',
  Tfng: 'ⵜ',
  Vaii: 'ꕙ',
  Yiii: 'ꆈ',
};

/** Letters of common scripts X counts as 1, which must stay off the list. */
const LIGHT_SAMPLES: Record<string, string> = {
  Arab: 'ع',
  Armn: 'ա',
  Beng: 'ক',
  Cyrl: 'д',
  Deva: 'क',
  Geor: 'ა',
  Grek: 'α',
  Hebr: 'ש',
  Latn: 'a',
  Mymr: 'က',
  Sinh: 'ස',
  Taml: 'த',
  Thai: 'ก',
  Tibt: 'ཀ',
};

describe('X_HEAVY_SCRIPTS', () => {
  it('lists only scripts the composer counts as 2 a letter', () => {
    for (const script of X_HEAVY_SCRIPTS) {
      const sample = HEAVY_SAMPLES[script];
      expect(sample).toBeDefined();
      expect([script, xWeightedLength(sample)]).toEqual([script, 2]);
    }
  });

  it('leaves out scripts the composer counts as 1', () => {
    for (const [script, sample] of Object.entries(LIGHT_SAMPLES)) {
      expect([script, xWeightedLength(sample)]).toEqual([script, 1]);
      expect(X_HEAVY_SCRIPTS.has(script)).toBe(false);
    }
  });
});

describe('writtenHeavyOnX', () => {
  it('places a language by its usual script', () => {
    for (const language of ['ja', 'ko', 'zh', 'zh-Hant', 'yue', 'am', 'ti', 'km', 'mn-Mong']) {
      expect([language, writtenHeavyOnX(language)]).toEqual([language, true]);
    }
    for (const language of ['en', 'ta', 'hi', 'th', 'ar', 'mn', 'my', 'ka', 'es-419', 'pt-BR']) {
      expect([language, writtenHeavyOnX(language)]).toEqual([language, false]);
    }
  });

  it('keeps the full limit without a language, or for one it cannot read', () => {
    expect(writtenHeavyOnX(undefined)).toBe(false);
    expect(writtenHeavyOnX('')).toBe(false);
    expect(writtenHeavyOnX('not a tag')).toBe(false);
  });
});

describe('strictestLimit with a language', () => {
  const providers = [
    { identifier: 'x', rules: { maxLength: 280, lengthMethod: 'x-weighted' } },
    { identifier: 'linkedin', rules: { maxLength: 3000, lengthMethod: 'utf16' } },
  ];

  it("halves X's limit for a language X counts double", () => {
    expect(strictestLimit(providers, ['x', 'linkedin'], 'ja')).toBe(140);
    expect(strictestLimit(providers, ['x'], 'zh-Hant')).toBe(140);
  });

  it('keeps every other limit as it is', () => {
    expect(strictestLimit(providers, ['x', 'linkedin'], 'ta')).toBe(280);
    expect(strictestLimit(providers, ['x', 'linkedin'])).toBe(280);
    expect(strictestLimit(providers, ['linkedin'], 'ja')).toBe(3000);
  });
});
