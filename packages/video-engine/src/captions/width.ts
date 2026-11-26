/**
 * A pure estimate of how wide a caption will draw, in canvas pixels.
 *
 * It only chooses page and line breaks, so it may be a few percent off:
 * libass makes the final wrap inside the caption's margins, and the pager
 * keeps a margin of its own. A letter's advance comes from its class (narrow,
 * ordinary, wide, capital, digit, a Tamil or Devanagari letter or mark), times
 * a factor for the font (a condensed face is narrower, a typewriter face
 * wider) and its weight, plus the outline on both sides.
 *
 * No per-font metrics table: the classes were tuned against frames libass
 * drew for the shipped faces (`media-tools` caption parity test), which is
 * all the accuracy a page break needs. Tamil lines are wide (research 09,
 * section 3), so their letters carry a larger advance.
 */

/** Advance of a letter class, in ems of the font size. */
const ADVANCE = {
  space: 0.28,
  narrow: 0.3,
  punctuation: 0.34,
  lower: 0.55,
  digit: 0.6,
  upper: 0.69,
  wide: 0.88,
  tamil: 0.92,
  tamilMark: 0.42,
  devanagari: 0.66,
  devanagariMark: 0.16,
  other: 0.62,
} as const;

const NARROW = new Set("iIljtfr1.,:;!|'`()[]");
const WIDE = new Set('mwMW@%&');

/** How much wider or narrower than an ordinary sans a family draws. */
const FAMILY_FACTORS: Readonly<Record<string, number>> = Object.freeze({
  anton: 0.74,
  'bebas neue': 0.72,
  oswald: 0.8,
  'archivo black': 1.08,
  'jetbrains mono': 1.12,
  unbounded: 1.25,
  'titan one': 1.06,
  'luckiest guy': 1.02,
  bangers: 0.86,
});

function advanceOf(char: string): number {
  const codePoint = char.codePointAt(0) as number;
  if (char === ' ' || codePoint === 0xa0) return ADVANCE.space;
  if (codePoint >= 0x0b80 && codePoint <= 0x0bff) {
    return /\p{M}/u.test(char) ? ADVANCE.tamilMark : ADVANCE.tamil;
  }
  if (codePoint >= 0x0900 && codePoint <= 0x097f) {
    return /\p{M}/u.test(char) ? ADVANCE.devanagariMark : ADVANCE.devanagari;
  }
  if (/\p{M}/u.test(char)) return 0;
  if (NARROW.has(char)) return ADVANCE.narrow;
  if (WIDE.has(char)) return ADVANCE.wide;
  if (codePoint >= 0x30 && codePoint <= 0x39) return ADVANCE.digit;
  if (/\p{Lu}/u.test(char)) return ADVANCE.upper;
  if (/\p{Ll}/u.test(char)) return ADVANCE.lower;
  if (/\p{P}|\p{S}/u.test(char)) return ADVANCE.punctuation;
  return ADVANCE.other;
}

export interface WidthStyle {
  font: string;
  weight: number;
  /** The text's size in canvas pixels. */
  sizePx: number;
  /** Outline width or box padding in canvas pixels (drawn on both sides). */
  backingPx: number;
}

/** The factor a family and weight scale the class advances by. */
export function fontWidthFactor(font: string, weight: number): number {
  const family = FAMILY_FACTORS[font.trim().toLowerCase()] ?? 1;
  // A heavier weight of the same face is a little wider.
  const heavy = 1 + (Math.min(900, Math.max(100, weight)) - 400) * 0.00022;
  return family * heavy;
}

/** The estimated width of one line of text, in canvas pixels. */
export function textWidth(text: string, style: WidthStyle): number {
  let ems = 0;
  for (const char of text) ems += advanceOf(char);
  const factor = fontWidthFactor(style.font, style.weight);
  return ems * style.sizePx * factor + (text.length > 0 ? style.backingPx * 2 : 0);
}

/** A measuring function for one style: the pager is handed this, so it stays unaware of fonts. */
export function measureWith(style: WidthStyle): (text: string) => number {
  return (text) => textWidth(text, style);
}
