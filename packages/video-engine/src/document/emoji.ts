/**
 * Emoji in text.
 *
 * libass draws a colour emoji as a plain one-colour outline (cookbook
 * section 6), so the export could never show what the editor shows. Emoji
 * are stickers instead (Module 12), and the schema refuses them in a text.
 *
 * What counts as an emoji here is what a phone keyboard inserts: a character
 * shown as an emoji by default (`Emoji_Presentation`), any pictograph asked
 * to show as one (followed by U+FE0F), flags (regional indicator pairs),
 * keycaps (`1` U+FE0F U+20E3), skin tones, and the joiners and selectors
 * that glue them into one picture. Characters that are text by default
 * (the copyright sign, the trademark sign, digits, `#`, `*`) stay allowed.
 *
 * Pure: no Node built-ins, the browser and the API run the same check.
 */

/** One emoji with everything glued to it, or a stray selector, keycap mark or skin tone. */
const EMOJI_PATTERN =
  '(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)(?:\\uFE0F|\\p{Emoji_Modifier})*' +
  '(?:\\u200D(?:\\p{Extended_Pictographic}|\\p{Emoji_Presentation})(?:\\uFE0F|\\p{Emoji_Modifier})*)*' +
  '|[#*0-9]\\uFE0F?\\u20E3' +
  '|\\p{Regional_Indicator}' +
  '|\\p{Emoji_Modifier}' +
  '|[\\uFE0F\\u20E3]';

const HAS_EMOJI = new RegExp(EMOJI_PATTERN, 'u');

/** Whether the text holds an emoji (or a piece of one). */
export function hasEmoji(text: string): boolean {
  return HAS_EMOJI.test(text);
}

/**
 * The text with every emoji removed, and any joiner left dangling by the
 * removal (U+200D between two removed pictures) taken out with it.
 */
export function stripEmoji(text: string): string {
  const pattern = new RegExp(EMOJI_PATTERN, 'gu');
  return text.replace(pattern, '').replace(/‍+/g, (joiners, offset: number, whole: string) => {
    // A zero width joiner is only kept between two letters of a script that uses it.
    const before = whole[offset - 1];
    const after = whole[offset + joiners.length];
    return before && after && /\p{L}|\p{M}/u.test(before) && /\p{L}|\p{M}/u.test(after)
      ? joiners
      : '';
  });
}
