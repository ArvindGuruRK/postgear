/**
 * Length, as each platform counts it.
 *
 * The X cases are the ones X's own `twitter-text` library gives for the same
 * input. Where PostGear's implementation deliberately differs, the test says
 * so and asserts the difference is an over-count — the safe direction.
 */
import { measureLength, overflowIndex, utf16Length, X_URL_LENGTH, xWeightedLength } from './length';
import { styleText } from './unicode';

describe('xWeightedLength', () => {
  it('counts Latin text one per character', () => {
    expect(xWeightedLength('hello world')).toBe(11);
    expect(xWeightedLength('a'.repeat(280))).toBe(280);
  });

  it('counts CJK as two per character', () => {
    expect(xWeightedLength('日本語')).toBe(6);
  });

  it('counts an emoji as two however many code points it spans', () => {
    expect(xWeightedLength('😀')).toBe(2);
    // Family: three pictographs joined by zero-width joiners.
    expect(xWeightedLength('👨‍👩‍👧')).toBe(2);
    // A flag is two regional indicators.
    expect(xWeightedLength('🇮🇳')).toBe(2);
  });

  it('counts the light punctuation ranges as one', () => {
    // Em dash (U+2014), curly quotes (U+201C/D), prime (U+2032).
    expect(xWeightedLength('—“”′')).toBe(4);
  });

  it('counts every URL as 23, however long', () => {
    expect(xWeightedLength('https://postgear.test/a/very/long/path/that/goes/on/and/on')).toBe(
      X_URL_LENGTH,
    );
    expect(xWeightedLength('http://a.io')).toBe(X_URL_LENGTH);
    expect(xWeightedLength('www.postgear.test')).toBe(X_URL_LENGTH);
  });

  it('recognises bare domains on country and common generic TLDs', () => {
    expect(xWeightedLength('postgear.io')).toBe(X_URL_LENGTH);
    expect(xWeightedLength('postgear.com/pricing')).toBe(X_URL_LENGTH);
    expect(xWeightedLength('see example.co.uk now')).toBe(4 + X_URL_LENGTH + 4);
  });

  it('does not mistake a framework name for a domain', () => {
    expect(xWeightedLength('Node.js and Next.js')).toBe('Node.js and Next.js'.length);
  });

  it('counts sentence punctuation after a URL separately, as X does', () => {
    expect(xWeightedLength('Go to https://postgear.test.')).toBe(6 + X_URL_LENGTH + 1);
  });

  it('counts Unicode bold letters as two each', () => {
    expect(xWeightedLength(styleText('bold', { bold: true }))).toBe(8);
  });

  it('normalises before counting, so composed and decomposed accents agree', () => {
    expect(xWeightedLength('café')).toBe(4);
    // `e` plus a combining acute accent: two code points until NFC joins them.
    expect(xWeightedLength('café')).toBe(4);
  });

  it('over-counts, never under-counts, the domain part of an email address', () => {
    // twitter-text reports 14 here. PostGear counts the domain as a link — a
    // deliberate simplification in the safe direction.
    expect(xWeightedLength('me@example.com')).toBeGreaterThanOrEqual(14);
  });
});

describe('utf16Length', () => {
  it('counts astral characters as two, the conservative reading of "characters"', () => {
    expect(utf16Length('abc')).toBe(3);
    expect(utf16Length('😀')).toBe(2);
    expect(utf16Length(styleText('a', { bold: true }))).toBe(2);
  });
});

describe('overflowIndex', () => {
  it('is null for text that fits', () => {
    expect(overflowIndex('hello', 5, 'utf16')).toBeNull();
  });

  it('points at the first character past the limit', () => {
    expect(overflowIndex('hello world', 5, 'utf16')).toBe(5);
  });

  it('uses the platform weighting, so CJK overflows twice as early on X', () => {
    expect(overflowIndex('日本語テキスト', 6, 'x-weighted')).toBe(3);
  });

  it('never cuts an astral character in half', () => {
    const bold = styleText('abc', { bold: true });
    const index = overflowIndex(bold, 3, 'utf16');

    expect(index).toBe(2);
    expect(Array.from(bold.slice(0, index ?? 0))).toHaveLength(1);
  });
});

describe('measureLength', () => {
  it('dispatches on the method', () => {
    expect(measureLength('日本', 'utf16')).toBe(2);
    expect(measureLength('日本', 'x-weighted')).toBe(4);
  });
});
