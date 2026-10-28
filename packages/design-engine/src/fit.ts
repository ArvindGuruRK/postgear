/**
 * Making text fit its slot, and saying so honestly when it will not.
 *
 * ## Why this is not "just use CSS"
 *
 * A slot is a fixed rectangle on a fixed-size canvas. CSS can clip the
 * overflow, scroll it, or let it spill over the next element; none of those is
 * acceptable on an image that is about to be published. So the size is
 * computed: shrink in small steps until the text fits, and if the smallest
 * step still does not fit, stop and tell the user. **Nothing is ever cut
 * silently** (DS-4.4), including at export, which renders anyway but warns
 * and names every slide whose text still overflows.
 *
 * ## Why the measuring is injected
 *
 * The browser measures with a canvas 2D context; a test measures with a plain
 * character-width model; the export measures in a real Chromium at the export
 * size. All three call the same `fitText`, with a different `measure`. That
 * is what makes the preview honest: the editor and the exporter run the same
 * search and only disagree about the last fraction of a pixel.
 */
import type { SizeStep, TypeStyle } from './types';
import { SIZE_STEPS } from './types';

/** Measures one line of text at a given pixel size. Pure as far as this file knows. */
export type MeasureText = (text: string, style: MeasuredStyle) => number;

export interface MeasuredStyle {
  fontFamily: string;
  fontWeight: number;
  /** Pixels. */
  fontSize: number;
  letterSpacing: number;
  italic?: boolean;
}

export interface FitInput {
  text: string;
  /** The box, in pixels, at the size the canvas is being drawn at. */
  width: number;
  height: number;
  style: MeasuredStyle;
  lineHeight: number;
  /** How far the search may shrink, as a fraction of the starting size. */
  minScale?: number;
  measure: MeasureText;
}

export interface FitResult {
  /** The size to draw at, in pixels. */
  fontSize: number;
  /** The lines the text broke into at that size. */
  lines: string[];
  /** True when even the smallest size overflowed. The warning ring. */
  overflows: boolean;
  /** How tall the text ended up, in pixels. */
  height: number;
}

/** The smallest a slot may shrink to before it warns instead. */
export const MIN_FIT_SCALE = 0.62;

/** Steps the search tries, largest first. Twelve is enough to look continuous. */
const STEPS = 12;

/**
 * Finds the largest size at which `text` fits the box, and the lines it makes.
 *
 * A plain descending search rather than a binary one: the number of steps is
 * twelve, each step is one wrap pass, and a linear walk returns the *largest*
 * fitting size without the off-by-one that a binary search over a non-monotone
 * wrap can produce when a word hops a line.
 */
export function fitText(input: FitInput): FitResult {
  const minScale = input.minScale ?? MIN_FIT_SCALE;
  const base = input.style.fontSize;
  let last: FitResult | null = null;

  for (let step = 0; step < STEPS; step++) {
    const scale = 1 - ((1 - minScale) * step) / (STEPS - 1);
    const fontSize = base * scale;
    const lines = wrapText(input.text, input.width, { ...input.style, fontSize }, input.measure);
    const height = lines.length * fontSize * input.lineHeight;

    last = { fontSize, lines, overflows: false, height };

    if (
      height <= input.height &&
      widest(lines, { ...input.style, fontSize }, input.measure) <= input.width
    ) {
      return last;
    }
  }

  // Nothing fit. Draw it at the smallest size and let the caller warn: the
  // user sees their whole sentence, too big for its box, which is a far more
  // useful thing to look at than a sentence with its end missing.
  return { ...(last as FitResult), overflows: true };
}

/**
 * Greedy word wrap. Breaks on spaces, keeps explicit newlines, and splits a
 * single word that is wider than the box so one long URL cannot push the
 * whole line out of the slot.
 */
export function wrapText(
  text: string,
  width: number,
  style: MeasuredStyle,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let current = '';

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current === '' ? word : `${current} ${word}`;

      if (measure(candidate, style) <= width || current === '') {
        // A single word wider than the box still has to go somewhere: break it.
        if (current === '' && measure(word, style) > width) {
          const pieces = breakWord(word, width, style, measure);
          lines.push(...pieces.slice(0, -1));
          current = pieces[pieces.length - 1];
          continue;
        }
        current = candidate;
        continue;
      }

      lines.push(current);
      current = word;
    }

    lines.push(current);
  }

  return lines;
}

function breakWord(
  word: string,
  width: number,
  style: MeasuredStyle,
  measure: MeasureText,
): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const character of word) {
    const candidate = current + character;

    if (measure(candidate, style) > width && current !== '') {
      pieces.push(current);
      current = character;
      continue;
    }

    current = candidate;
  }

  pieces.push(current);
  return pieces;
}

function widest(lines: string[], style: MeasuredStyle, measure: MeasureText): number {
  return lines.reduce((max, line) => Math.max(max, measure(line, style)), 0);
}

/**
 * A measurer with no browser: an average character width per weight, scaled by
 * the font size. Used by the unit tests and by any code path that needs a
 * rough answer without a DOM. It is deliberately a little pessimistic (wider
 * than most real faces), so a slot that fits under this model fits in a real
 * one too.
 */
export function approximateMeasure(text: string, style: MeasuredStyle): number {
  const weightFactor = 0.5 + (style.fontWeight - 400) / 4_000;
  return text.length * style.fontSize * weightFactor + text.length * style.letterSpacing;
}

/**
 * The font size a slot starts at, before any fitting: the theme's size (a
 * percentage of the canvas's short edge) times the user's size step.
 */
export function baseFontSize(style: TypeStyle, shortEdgePx: number, step?: SizeStep): number {
  return (style.size / 100) * shortEdgePx * SIZE_STEPS[step ?? 'md'];
}
