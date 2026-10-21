/**
 * The search words and the exact check behind every workspace search: every
 * word must be found, case and order do not matter, and a result's snippet
 * starts near the match.
 */
import {
  foldWhitespace,
  MAX_SEARCH_TERMS,
  matchesAllTerms,
  searchTerms,
  selectiveTerm,
  snippetAround,
} from './search-terms';

describe('searchTerms', () => {
  it('splits on whitespace, lower-cases and drops repeats, keeping the order typed', () => {
    expect(searchTerms('Summer  SALE summer\tdeals')).toEqual(['summer', 'sale', 'deals']);
  });

  it('is empty for a blank search', () => {
    expect(searchTerms('   ')).toEqual([]);
  });

  it('keeps only the first words of a very long search', () => {
    const words = Array.from({ length: 20 }, (_, index) => `word${index}`).join(' ');
    expect(searchTerms(words)).toHaveLength(MAX_SEARCH_TERMS);
    expect(searchTerms(words)[0]).toBe('word0');
  });
});

describe('selectiveTerm', () => {
  it('is the longest word, and the first of equals', () => {
    expect(selectiveTerm(['big', 'launch', 'sale', 'event'])).toBe('launch');
    expect(selectiveTerm(['aaa', 'bbb'])).toBe('aaa');
  });
});

describe('matchesAllTerms', () => {
  it('needs every word, in any order and any case', () => {
    expect(matchesAllTerms('Big SALE this Summer', ['summer', 'sale'])).toBe(true);
    expect(matchesAllTerms('Big sale', ['summer', 'sale'])).toBe(false);
  });

  it('never matches an empty search', () => {
    expect(matchesAllTerms('anything', [])).toBe(false);
  });

  it('treats % and _ as plain characters', () => {
    expect(matchesAllTerms('50% off', ['%'])).toBe(true);
    expect(matchesAllTerms('plain text', ['%'])).toBe(false);
    expect(matchesAllTerms('plain text', ['_'])).toBe(false);
  });
});

describe('foldWhitespace', () => {
  it('turns newlines and runs of spaces into single spaces', () => {
    expect(foldWhitespace('  one\n\n two   three ')).toBe('one two three');
  });
});

describe('snippetAround', () => {
  it('returns short text whole', () => {
    expect(snippetAround('Hello\nworld', ['world'])).toBe('Hello world');
  });

  it('starts shortly before the first match and marks both cuts', () => {
    const text = `${'a '.repeat(80)}launch day ${'b '.repeat(80)}`;
    const snippet = snippetAround(text, ['launch']);

    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.endsWith('...')).toBe(true);
    expect(snippet).toContain('launch day');
  });

  it('starts at the beginning when the match is early, with no leading mark', () => {
    const snippet = snippetAround(`launch ${'x '.repeat(200)}`, ['launch']);

    expect(snippet.startsWith('launch')).toBe(true);
    expect(snippet.endsWith('...')).toBe(true);
  });

  it('shows the end of the text when the match is there, without a trailing mark', () => {
    const snippet = snippetAround(`${'x '.repeat(200)}the launch`, ['launch']);

    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.endsWith('the launch')).toBe(true);
  });

  it('falls back to the start of the text when nothing matches', () => {
    expect(snippetAround(`start ${'x '.repeat(200)}`, ['zzz']).startsWith('start')).toBe(true);
  });
});
