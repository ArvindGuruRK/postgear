/**
 * Paging: which words are on screen together, and on which line.
 *
 * Paging by time alone gives ugly pages (a lone "the" at the end of one, a
 * sentence cut in half), so a page breaks, in this order of force:
 *
 * 1. always at a part's edge (a cut in the clip is a cut in the captions);
 * 2. after a pause longer than `maxGapMs` (the speaker stopped);
 * 3. after a word that ends a sentence;
 * 4. at the word limit (`maxWords`);
 * 5. when one more word would not fit on two lines.
 *
 * The pager breaks lines itself (at most two, as even as it can), before
 * libass would wrap, so the browser preview and the export break the same
 * way. Width comes from a measuring function, so this file knows no font.
 *
 * A page stays on screen until the next page starts when the two are close,
 * and leaves a moment after its last word otherwise. The spoken word is the
 * one whose time holds the playhead; between two words of a page the earlier
 * one stays marked, so the mark never flickers off mid-page.
 */
import { endsSentence } from '../transcript/sentences';
import type { CaptionWord } from './map';

export interface CaptionPage {
  index: number;
  /** Clip time, whole milliseconds, `end` exclusive. */
  start: number;
  end: number;
  words: CaptionWord[];
  /** The page's lines, as positions into `words`: one or two lines. */
  lines: number[][];
  /**
   * When each word becomes the spoken one, clip time: its own start, except
   * that the first is the page's start. Word `k` is marked from `marks[k]` to
   * `marks[k + 1]` (the last until the page ends).
   */
  marks: number[];
  /**
   * Module 16: the share of the track's text size this page is drawn at,
   * set (below 1) only when one word alone is wider than a line: a very long
   * word, a caption with no spaces, a long Tamil word. Breaking lines cannot
   * help such a page, so it is drawn smaller until it fits, never past the
   * box. Absent on every page that fits at the track's size.
   */
  scale?: number;
}

export interface PageOptions {
  /** Words on a page at once. */
  maxWords: number;
  /** The width one line may take, in the measuring function's units. */
  lineWidth: number;
  /** How wide a line of text draws. */
  measure: (text: string) => number;
  /** A silence this long ends the page. Default 700 ms. */
  maxGapMs?: number;
  /** A page whose last word is this far from the next page leaves early. Default the same as `maxGapMs`. */
  lingerMs?: number;
  /** The clip's length, so the last page never outlives the clip. */
  clipMs: number;
  /** How a word is written when measured and drawn (letter case). */
  display?: (text: string) => string;
  /**
   * The part of a measured line that does not grow with the text size (the
   * outline or box on both sides), so a page that must be drawn smaller is
   * shrunk by exactly enough. Default 0.
   */
  fixedWidth?: number;
  /**
   * How much larger the spoken word briefly draws (the word pop, 1.16), so a
   * page drawn smaller still fits while its word pops. Default 1.
   */
  wordGrowth?: number;
  /**
   * The caption box, which a line with its spoken word popped must stay
   * inside (`lineWidth` is a little inside it). Default `lineWidth`.
   */
  boxWidth?: number;
}

export const PAGE_MAX_GAP_MS = 700;
/**
 * The smallest share a page is drawn at. Only reached when the outline alone
 * is nearly as wide as a line; the longest word a transcript or an edit can
 * hold (80 letters) at the largest size still fits well above it.
 */
export const PAGE_MIN_SCALE = 0.01;

/** One drawn line as `pageScale` sees it: its width, and its widest word's. */
export interface MeasuredLine {
  width: number;
  widestWord: number;
}

/**
 * The share of its size a page is drawn at: 1 for every page that fits as it
 * is. Below 1 only when a line at rest is wider than `lineWidth` (the pager
 * makes that only for a line of one word: a very long word, a caption with no
 * spaces), or when its widest word, popped, would carry it past the box
 * (`boxWidth`). Breaking lines cannot help such a page, so it is drawn smaller.
 */
export function pageScale(
  lines: MeasuredLine[],
  options: Pick<PageOptions, 'lineWidth' | 'boxWidth' | 'fixedWidth' | 'wordGrowth'>,
): number {
  const fixed = Math.max(0, options.fixedWidth ?? 0);
  const growth = Math.max(1, options.wordGrowth ?? 1);
  const box = Math.max(options.lineWidth, options.boxWidth ?? options.lineWidth);
  let scale = 1;
  for (const line of lines) {
    const text = line.width - fixed;
    if (!(text > 0)) continue;
    const popped = text + (growth - 1) * Math.max(0, line.widestWord - fixed);
    scale = Math.min(scale, (options.lineWidth - fixed) / text, (box - fixed) / popped);
  }
  if (!(scale < 1)) return 1;
  // Rounded down, so the page is never a rounding error wider than its room.
  return Math.max(PAGE_MIN_SCALE, Math.floor(scale * 1000) / 1000);
}
/** How long a page stays after its last word when nothing follows closely. */
export const PAGE_LINGER_MS = 260;
export const PAGE_MAX_LINES = 2;

/** The page's words split into at most two lines, as even as the measure allows. */
export function breakLines(
  texts: readonly string[],
  lineWidth: number,
  measure: (text: string) => number,
): number[][] {
  const all = texts.map((_, index) => index);
  if (texts.length <= 1 || measure(texts.join(' ')) <= lineWidth) return [all];
  let best = 1;
  let bestWidest = Number.POSITIVE_INFINITY;
  for (let split = 1; split < texts.length; split += 1) {
    const top = measure(texts.slice(0, split).join(' '));
    const bottom = measure(texts.slice(split).join(' '));
    const widest = Math.max(top, bottom);
    // Prefer the most even pair; on a tie, the longer top line reads better.
    if (widest < bestWidest - 0.5) {
      bestWidest = widest;
      best = split;
    }
  }
  return [all.slice(0, best), all.slice(best)];
}

/** True when these words fit on at most two lines of `lineWidth`. */
function fits(
  texts: readonly string[],
  lineWidth: number,
  measure: (text: string) => number,
): boolean {
  if (measure(texts.join(' ')) <= lineWidth) return true;
  for (let split = 1; split < texts.length; split += 1) {
    if (
      measure(texts.slice(0, split).join(' ')) <= lineWidth &&
      measure(texts.slice(split).join(' ')) <= lineWidth
    ) {
      return true;
    }
  }
  return false;
}

/** The words grouped into pages, in order. Every word is on exactly one page. */
export function captionPages(words: readonly CaptionWord[], options: PageOptions): CaptionPage[] {
  const maxWords = Math.max(1, Math.floor(options.maxWords));
  const maxGapMs = options.maxGapMs ?? PAGE_MAX_GAP_MS;
  const lingerMs = options.lingerMs ?? PAGE_LINGER_MS;
  const display = options.display ?? ((text: string) => text);
  const groups: CaptionWord[][] = [];
  let current: CaptionWord[] = [];

  const close = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous) {
      const texts = [...current, word].map((item) => display(item.text));
      if (
        word.segmentIndex !== previous.segmentIndex ||
        word.start - previous.end > maxGapMs ||
        endsSentence(previous.text) ||
        current.length >= maxWords ||
        // A word that no longer fits starts the next page; a single word always gets one.
        !fits(texts, options.lineWidth, options.measure)
      ) {
        close();
      }
    }
    current.push(word);
  }
  close();

  return groups.map((group, index) => {
    const first = group[0] as CaptionWord;
    const last = group[group.length - 1] as CaptionWord;
    const next = groups[index + 1]?.[0];
    const stays = next !== undefined && next.start - last.end <= maxGapMs;
    const end = Math.min(
      options.clipMs,
      Math.max(last.end, stays ? (next as CaptionWord).start : last.end + lingerMs),
    );
    const texts = group.map((item) => display(item.text));
    const lines = breakLines(texts, options.lineWidth, options.measure);
    const scale = pageScale(
      lines.map((line) => ({
        width: options.measure(line.map((position) => texts[position]).join(' ')),
        widestWord: Math.max(...line.map((position) => options.measure(texts[position] ?? ''))),
      })),
      options,
    );
    return {
      index,
      start: first.start,
      end: Math.max(first.start + 1, next ? Math.min(end, next.start) : end),
      words: group,
      lines,
      marks: group.map((item, position) => (position === 0 ? first.start : item.start)),
      ...(scale < 1 ? { scale } : {}),
    };
  });
}

export interface CaptionMoment {
  page: CaptionPage;
  /** The position in `page.words` of the word being said. */
  active: number;
}

/** The page on screen at a clip moment and its spoken word, or null between pages. */
export function captionAt(pages: readonly CaptionPage[], outputMs: number): CaptionMoment | null {
  let low = 0;
  let high = pages.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((pages[mid] as CaptionPage).start <= outputMs) low = mid + 1;
    else high = mid;
  }
  const page = pages[low - 1];
  if (!page || outputMs >= page.end) return null;
  let active = 0;
  for (let position = 0; position < page.marks.length; position += 1) {
    if ((page.marks[position] as number) <= outputMs) active = position;
  }
  return { page, active };
}
