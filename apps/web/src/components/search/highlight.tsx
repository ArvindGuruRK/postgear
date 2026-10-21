import { Fragment } from 'react';

/** The search's words, lower-cased and de-duplicated, as the API reads them. */
export function termsOf(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 6);
}

export interface TextPart {
  text: string;
  match: boolean;
}

/**
 * `text` cut into runs, marking those that are one of the search's words
 * (ignoring case). Longer words are tried first, so "summer" is one match and
 * not "sum" plus a stray "mer" when both were typed.
 */
export function splitByTerms(text: string, terms: string[]): TextPart[] {
  const usable = terms
    .filter((term) => term !== '')
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (usable.length === 0 || text === '') {
    return [{ text, match: false }];
  }

  const pattern = new RegExp(`(${usable.join('|')})`, 'gi');

  // `split` with one capture group alternates between plain runs (even
  // indexes) and matches (odd indexes), so no position bookkeeping is needed.
  return text
    .split(pattern)
    .map((part, index) => ({ text: part, match: index % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/** The text with the search's words marked, for a result row. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {splitByTerms(text, terms).map((part, index) => (
        // The runs are positional and never reorder, so the index is a stable key.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <Fragment key={index}>
          {part.match ? (
            // Tinted from the row's own text colour, not a fixed one: the row
            // turns blue when selected, and a fixed colour read badly on it.
            <mark className="rounded-sm bg-current/20 text-inherit underline decoration-2 underline-offset-2">
              {part.text}
            </mark>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </>
  );
}
