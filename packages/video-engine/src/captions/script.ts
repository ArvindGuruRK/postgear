/**
 * Which script a caption is written in, so it is drawn in a font that has it
 * and marked in a way that script can take.
 *
 * libass shapes one run of one style at a time (research 09, section 3): a
 * colour or size change inside a Tamil or Hindi letter cluster draws dotted
 * circles. So only Latin text may be styled finer than a whole word, and only
 * scripts with capital letters are ever upper-cased.
 */

export const CAPTION_SCRIPTS = ['latin', 'tamil', 'devanagari', 'other'] as const;
export type CaptionScript = (typeof CAPTION_SCRIPTS)[number];

function scriptOfCodePoint(codePoint: number): CaptionScript | null {
  if (codePoint >= 0x0b80 && codePoint <= 0x0bff) return 'tamil';
  if (codePoint >= 0x0900 && codePoint <= 0x097f) return 'devanagari';
  if (codePoint >= 0xa8e0 && codePoint <= 0xa8ff) return 'devanagari';
  if (
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    (codePoint >= 0xc0 && codePoint <= 0x24f) ||
    (codePoint >= 0x1e00 && codePoint <= 0x1eff)
  ) {
    return 'latin';
  }
  return null;
}

/**
 * The script most of a text's letters are in. Digits, spaces and punctuation
 * do not count; a text with no letters at all reads as Latin (it is drawn in
 * the style's own font). A letter outside the scripts we ship fonts for makes
 * the text `other` when it is the majority.
 */
export function scriptOf(text: string): CaptionScript {
  const counts: Record<CaptionScript, number> = { latin: 0, tamil: 0, devanagari: 0, other: 0 };
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number;
    const script = scriptOfCodePoint(codePoint);
    if (script) counts[script] += 1;
    else if (/\p{L}/u.test(char)) counts.other += 1;
  }
  let best: CaptionScript = 'latin';
  for (const script of CAPTION_SCRIPTS) {
    if (counts[script] > counts[best]) best = script;
  }
  return best;
}

/** True for a script with capital letters: only those are ever upper or lower cased. */
export function hasLetterCase(script: CaptionScript): boolean {
  return script === 'latin';
}

/**
 * True when the spoken word may be marked on its own in this script. Tamil
 * and Devanagari word times are looser and a mark inside a cluster cannot be
 * drawn, so their captions mark the whole page (decision D13-05).
 */
export function marksSingleWords(script: CaptionScript): boolean {
  return script === 'latin';
}

/** True for a pictograph libass would draw in one flat colour: left out of caption text. */
export function isEmojiChar(char: string): boolean {
  return /\p{Extended_Pictographic}/u.test(char);
}

/** A word with its emoji (and the joiners and selectors that go with them) taken out. */
export function withoutEmoji(text: string): string {
  let out = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number;
    if (isEmojiChar(char)) continue;
    // Variation selector 16 and the zero width joiner only make sense beside an emoji.
    if (codePoint === 0xfe0f || codePoint === 0x200d) continue;
    out += char;
  }
  return out;
}
