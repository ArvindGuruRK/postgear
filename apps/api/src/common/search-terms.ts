/**
 * How a typed search becomes something to match (2026-10-21, global search).
 *
 * A search is split into words and a row matches when **every** word appears
 * somewhere in it, in any order, ignoring case. "summer sale" finds a post
 * that says "Big sale this summer", which is what people expect from a search
 * box and what a plain `contains "summer sale"` would miss.
 *
 * The database only narrows the candidates (one `contains` on the longest
 * word, which is the most selective). The exact check is done here, on the
 * text a person actually sees, because a stored post is a JSON document: a
 * `contains "text"` over it would match every post, since `"type":"text"` is
 * in all of them. Prisma also does not escape `%` and `_` in `contains`, so
 * the same second look keeps those characters from acting as wildcards.
 */

/** A search with more words than this ignores the rest. */
export const MAX_SEARCH_TERMS = 6;

/** The longest search accepted, in characters. */
export const MAX_SEARCH_LENGTH = 100;

/** The shortest search that runs. One letter matches nearly everything. */
export const MIN_SEARCH_LENGTH = 2;

/**
 * The lower-cased, de-duplicated words of a search, in the order typed.
 * Empty for a blank search.
 */
export function searchTerms(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_SEARCH_TERMS);
}

/** The word to narrow the database query by: the longest, the first one on a tie. */
export function selectiveTerm(terms: string[]): string {
  return terms.reduce((best, term) => (term.length > best.length ? term : best), terms[0] ?? '');
}

/** Every term appears in `haystack`, case-insensitively. */
export function matchesAllTerms(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) {
    return false;
  }

  const lowered = haystack.toLowerCase();
  return terms.every((term) => lowered.includes(term));
}

/** Runs of whitespace (newlines included) as one space, ends trimmed. */
export function foldWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The words of `text` around its first match, for a result row.
 *
 * Starts a little before the match so it is read in context, and marks a cut
 * with "..." at that end. Text with no match gives its own start.
 */
export function snippetAround(text: string, terms: string[], maxLength = 140): string {
  const folded = foldWhitespace(text);

  if (folded.length <= maxLength) {
    return folded;
  }

  const lowered = folded.toLowerCase();
  const positions = terms.map((term) => lowered.indexOf(term)).filter((index) => index >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;

  const start = Math.max(0, Math.min(first - 40, folded.length - maxLength));
  const end = Math.min(folded.length, start + maxLength);

  return `${start > 0 ? '...' : ''}${folded.slice(start, end).trim()}${end < folded.length ? '...' : ''}`;
}
