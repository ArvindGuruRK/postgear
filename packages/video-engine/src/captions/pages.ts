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
}

export const PAGE_MAX_GAP_MS = 700;
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
function fits(texts: readonly string[], lineWidth: number, measure: (text: string) => number): boolean {
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
    return {
      index,
      start: first.start,
      end: Math.max(first.start + 1, next ? Math.min(end, next.start) : end),
      words: group,
      lines: breakLines(
        group.map((item) => display(item.text)),
        options.lineWidth,
        options.measure,
      ),
      marks: group.map((item, position) => (position === 0 ? first.start : item.start)),
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
