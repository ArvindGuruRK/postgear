import { splitByTerms, termsOf } from './highlight';

describe('termsOf', () => {
  it('lower-cases, splits on whitespace and drops repeats', () => {
    expect(termsOf('Summer  SALE summer')).toEqual(['summer', 'sale']);
  });
});

describe('splitByTerms', () => {
  it('marks the matches and keeps the original casing', () => {
    expect(splitByTerms('Big SALE this summer', ['sale', 'summer'])).toEqual([
      { text: 'Big ', match: false },
      { text: 'SALE', match: true },
      { text: ' this ', match: false },
      { text: 'summer', match: true },
    ]);
  });

  it('returns the text whole when nothing matches', () => {
    expect(splitByTerms('Hello', ['zzz'])).toEqual([{ text: 'Hello', match: false }]);
  });

  it('returns the text whole for no terms', () => {
    expect(splitByTerms('Hello', [])).toEqual([{ text: 'Hello', match: false }]);
  });

  it('prefers the longer word when one contains another', () => {
    expect(splitByTerms('summer', ['sum', 'summer'])).toEqual([{ text: 'summer', match: true }]);
  });

  it('treats regular-expression characters as plain text', () => {
    expect(splitByTerms('50% off (today) [now] a.b', ['(today)', '[now]', 'a.b', '%'])).toEqual([
      { text: '50', match: false },
      { text: '%', match: true },
      { text: ' off ', match: false },
      { text: '(today)', match: true },
      { text: ' ', match: false },
      { text: '[now]', match: true },
      { text: ' ', match: false },
      { text: 'a.b', match: true },
    ]);
    expect(splitByTerms('axb', ['a.b'])).toEqual([{ text: 'axb', match: false }]);
  });

  it('handles empty text', () => {
    expect(splitByTerms('', ['a'])).toEqual([{ text: '', match: false }]);
  });
});
