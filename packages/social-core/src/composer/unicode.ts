/**
 * Bold, italic and underline for platforms that have none of them.
 *
 * X, LinkedIn, Instagram, Facebook, TikTok, YouTube and Pinterest all accept
 * plain text only. The established workaround (used by the reference and by
 * every scheduler in this space) is to swap ASCII letters for their lookalikes
 * in Unicode's Mathematical Alphanumeric Symbols block, which every platform
 * displays as styled text.
 *
 * ## The costs, stated rather than hidden
 *
 * - **Screen readers** read some of these as individual mathematical symbols.
 *   Formatting is a choice the author makes per word; it is never applied
 *   automatically, and plain text is always one click away.
 * - **Search** on most platforms does not match `𝗯𝗼𝗹𝗱` against `bold`.
 * - **Length.** Each styled letter is outside the Basic Multilingual Plane:
 *   two UTF-16 units, and weight 2 in X's counter. This is why every character
 *   count in PostGear is taken from the *rendered* text, never from what the
 *   editor shows.
 *
 * Only unaccented Latin letters and digits have styled forms. Everything else
 * (accented letters, other scripts, punctuation, emoji) passes through
 * unchanged, which is the correct behaviour rather than a gap.
 *
 * The Sans-Serif ranges are used because they are complete. The Serif italic
 * range has a hole at `h` (U+1D455 is unassigned; the letter lives at U+210E),
 * which is the classic bug in hand-rolled versions of this table.
 */

const UPPER_A = 0x41;
const LOWER_A = 0x61;
const DIGIT_0 = 0x30;

/** Start of each styled alphabet: capitals, then lowercase 26 code points later. */
const SANS_BOLD = 0x1d5d4;
const SANS_ITALIC = 0x1d608;
const SANS_BOLD_ITALIC = 0x1d63c;

/** Mathematical Sans-Serif Bold digits. There is no italic digit set. */
const SANS_BOLD_DIGIT = 0x1d7ec;

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
}

export function styleText(text: string, style: TextStyle): string {
  if (!style.bold && !style.italic) {
    return text;
  }

  const letterBase =
    style.bold && style.italic ? SANS_BOLD_ITALIC : style.bold ? SANS_BOLD : SANS_ITALIC;

  let output = '';

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    if (code >= UPPER_A && code < UPPER_A + 26) {
      output += String.fromCodePoint(letterBase + (code - UPPER_A));
    } else if (code >= LOWER_A && code < LOWER_A + 26) {
      output += String.fromCodePoint(letterBase + 26 + (code - LOWER_A));
    } else if (style.bold && code >= DIGIT_0 && code < DIGIT_0 + 10) {
      output += String.fromCodePoint(SANS_BOLD_DIGIT + (code - DIGIT_0));
    } else {
      output += character;
    }
  }

  return output;
}

/** U+0332 COMBINING LOW LINE: drawn under the character before it. */
export const COMBINING_LOW_LINE = '̲';

/**
 * A letter or digit, with any accents it carries. An enclosing mark (the
 * keycap in 1️⃣) is deliberately not accepted, so emoji built on a digit are
 * left whole rather than split by a line.
 */
const UNDERLINABLE = /^[\p{L}\p{N}][\p{Mn}\p{Mc}]*$/u;

/**
 * Underline for platforms that have none, as Postiz does it: a combining low
 * line after each letter and digit. Spaces and punctuation are left bare, so
 * words read as underlined words rather than one ruled line.
 *
 * Applied to already-styled text, so a bold underlined word is the bold
 * letters each followed by the line; the Mathematical Alphanumeric letters
 * are letters to Unicode too. The line goes after a character's own accents,
 * keeping each user-perceived character in one piece.
 *
 * Every line is one more UTF-16 unit, and weighs 1 on X (U+0332 sits in X's
 * light range), which `length.ts` counts without knowing about it because
 * lengths are always taken from rendered text.
 */
export function underlineText(text: string): string {
  let output = '';

  for (const grapheme of graphemes(text)) {
    output += UNDERLINABLE.test(grapheme) ? `${grapheme}${COMBINING_LOW_LINE}` : grapheme;
  }

  return output;
}

/** User-perceived characters; code points where `Intl.Segmenter` is missing. */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }

  return Array.from(text);
}
