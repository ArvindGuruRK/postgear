/**
 * The ASS lines that draw a clip's captions (Sprint 13, Module 03): one
 * `Style` and the `Dialogue` events, written into the same file as the texts.
 *
 * Every pattern here was verified on FFmpeg 9.0.2 (research 09, sections 2
 * to 4), and the rules are the ones that research found the hard way:
 *
 * - **One event per word** for a mark on only the spoken word (`colour`,
 *   `box`, `reveal`): each event shows the whole page, so the layout never
 *   moves. **One event per page** for `fill` (`\k`: said words keep the
 *   colour) and for `none`.
 * - **Times are absolute**, each rounded to a centisecond on its own. `\k`
 *   lengths are differences of rounded starts, never rounded lengths, so
 *   error cannot build up over a page.
 * - **A style change happens only at a word's edge.** Inside a Tamil or Hindi
 *   letter cluster it would draw dotted circles, so nothing here ever changes
 *   colour, size or alpha inside a word. A font switch for another script is
 *   written per run, never left to a silent fallback.
 * - **`\q2` is never written** (it turns wrapping off and a long line runs
 *   past the frame); the pager has already broken the lines, with `\N`.
 * - After a marked word the style is put back with `{\r}`: a `\t` transform
 *   left running would leak into the words after it.
 * - Letter case is done here (ASS has no case attribute), and a person's text
 *   is escaped so it can never become an override block.
 */
import { CAPTION_WORD_POP_PERCENT, MARK_BOX_PAD } from '../captions/layout';
import type { CaptionPage } from '../captions/pages';
import { TEXT_SHADOW } from '../document/text';
import {
  assAlpha,
  assColour,
  assColourTag,
  assNumber,
  assTime,
  assWeight,
  escapeAssText,
} from './ass';
import type { PlanCaptionWord, PlanCaptions } from './caption-plan';
import type { PlanTextRun } from './text-plan';

/** The ASS layer captions are drawn on: under every text and badge a person placed. */
export const CAPTION_LAYER = 0;

/** A page that pops in grows from this size, over this long. */
const PAGE_POP = { fromPercent: 82, ms: 110 };
/** A marked word that pops starts this large and settles over this long. */
const WORD_POP = { fromPercent: CAPTION_WORD_POP_PERCENT, ms: 90 };
const PAGE_FADE_MS = 120;
/** The caption shadow's offset, as a share of the text size (so it scales with it). */
export const CAPTION_SHADOW_SHARE = 0.045;
const SHADOW_SHARE = CAPTION_SHADOW_SHARE;

/** The `Style:` line's fields after the name. */
export function captionStyleFields(captions: PlanCaptions): string {
  const { look, mark, geometry } = captions.layout;
  // The style's own kind, not the effective one: a `box` style whose words cannot be marked one
  // by one (Tamil, a supplied file) keeps its box, behind the whole page.
  const markBox = look.mark.kind === 'box';
  const outlineColour = look.outline
    ? assColour(look.outline.colour)
    : look.box
      ? assColour(look.box.colour)
      : markBox
        ? assColour(look.mark.colour)
        : assColour('#000000');
  const borderStyle = look.box || markBox ? 3 : 1;
  const outline = look.outline
    ? look.outline.width
    : look.box
      ? look.box.pad
      : markBox
        ? MARK_BOX_PAD
        : 0;
  // `fill`: the words are in the colour they will have once said (Primary) and wait in Secondary.
  const primary = mark === 'fill' ? look.mark.colour : look.colour;
  const shadow = look.shadow && borderStyle === 1 ? geometry.sizePx * SHADOW_SHARE : 0;
  return [
    captions.main.assName,
    assNumber(captions.main.fontSize),
    assColour(primary),
    assColour(look.colour),
    outlineColour,
    assColour(TEXT_SHADOW.colour, TEXT_SHADOW.opacity),
    assWeight(captions.main.weight),
    look.italic ? '-1' : '0',
    '0',
    '0',
    '100',
    '100',
    '0',
    '0',
    String(borderStyle),
    assNumber(outline),
    assNumber(shadow),
    // Centred on `\pos`, the block's own centre.
    '5',
    '0',
    '0',
    '0',
    '1',
  ].join(',');
}

function sameFont(a: PlanTextRun, b: PlanTextRun): boolean {
  return a.assName === b.assName && a.fontSize === b.fontSize && a.weight === b.weight;
}

function fontTag(run: PlanTextRun): string {
  return `\\fn${run.assName}\\fs${assNumber(run.fontSize)}\\b${assWeight(run.weight)}`;
}

/**
 * The font every word of a page is drawn in, when they all share one that is
 * not the style's own (a Tamil page in a Latin style): it is switched to once,
 * at the start of the page, so the page stays one run and a box behind it is
 * one box. Null when the page mixes fonts.
 */
function pageFont(words: readonly PlanCaptionWord[], main: PlanTextRun): PlanTextRun {
  const first = words[0]?.runs[0];
  if (!first || sameFont(first, main)) return main;
  for (const word of words) {
    for (const run of word.runs) {
      if (!sameFont(run, first)) return main;
    }
  }
  return first;
}

/**
 * One word's text. A run in another font than the page's (`main` here) is
 * switched to explicitly and switched back after the word, so the switch sits
 * at the word's edge and never depends on what came before.
 */
function wordText(word: PlanCaptionWord, main: PlanTextRun): string {
  let out = '';
  let switched = false;
  for (const run of word.runs) {
    if (!sameFont(run, main)) {
      out += `{${fontTag(run)}}`;
      switched = true;
    } else if (switched) {
      out += `{${fontTag(main)}}`;
      switched = false;
    }
    out += escapeAssText(run.text);
  }
  if (switched) out += `{${fontTag(main)}}`;
  return out;
}

/** The page's words joined into its lines, each word passed through `each`. */
function pageBody(
  page: CaptionPage,
  words: readonly PlanCaptionWord[],
  main: PlanTextRun,
  each: (position: number, text: string) => string,
): string {
  return page.lines
    .map((line) =>
      line
        .map((position) => each(position, wordText(words[position] as PlanCaptionWord, main)))
        .join(' '),
    )
    .join('\\N');
}

/** Whole centiseconds of an absolute time. */
function centis(ms: number): number {
  return Math.max(0, Math.round(ms / 10));
}

/**
 * The `Dialogue:` lines of the captions, in time order, with `styleName` as
 * their style. Events that would last less than a centisecond are left out
 * (libass would never draw them).
 */
export function captionDialogues(
  captions: PlanCaptions,
  styleName: string,
  canvasWidth: number,
): string[] {
  const { layout } = captions;
  const { look, mark, geometry } = layout;
  const marginL = Math.round(geometry.boxLeft);
  const marginR = Math.round(canvasWidth - geometry.boxLeft - geometry.boxWidth);
  const placeAt = `\\an5\\pos(${assNumber(geometry.cx)},${assNumber(geometry.cy)})`;
  const lines: string[] = [];

  const event = (startMs: number, endMs: number, text: string) => {
    if (centis(endMs) <= centis(startMs)) return;
    lines.push(
      `Dialogue: ${CAPTION_LAYER},${assTime(startMs)},${assTime(endMs)},${styleName},,` +
        `${marginL},${marginR},0,,${text}`,
    );
  };

  /** The entrance of a page, written once, on the event that starts it. */
  const entrance = (popAllowed: boolean): string => {
    if (look.entrance === 'fade') return `\\fad(${PAGE_FADE_MS},0)`;
    if (look.entrance === 'pop' && popAllowed) {
      return `\\fscx${PAGE_POP.fromPercent}\\fscy${PAGE_POP.fromPercent}\\t(0,${PAGE_POP.ms},\\fscx100\\fscy100)`;
    }
    return '';
  };

  layout.pages.forEach((page, pageIndex) => {
    // Module 16: a page whose one word is wider than the box is drawn smaller
    // (`page.scale`), every run of it, so it never runs past the box.
    const scale = page.scale ?? 1;
    const sized = (run: PlanTextRun): PlanTextRun =>
      scale === 1 ? run : { ...run, fontSize: run.fontSize * scale };
    const words = (captions.words[pageIndex] ?? []).map((word) =>
      scale === 1 ? word : { runs: word.runs.map(sized) },
    );
    const until = (position: number): number => page.marks[position + 1] ?? page.end;
    // The page's own font: the style's, or the one script font all its words share.
    const base = pageFont(words, sized(captions.main));
    // A smaller page always names its size, so `\r` (which puts the style's size back) never undoes it.
    const baseFont = scale === 1 && sameFont(base, captions.main) ? '' : fontTag(base);
    const main = base;
    const place = `${placeAt}${baseFont}`;
    // `\r` puts the style back, and with it the style's font: the page's own font goes back on.
    const reset = `{\\r${baseFont}}`;

    if (mark === 'none') {
      event(
        page.start,
        page.end,
        `{${place}${entrance(true)}}${pageBody(page, words, main, (_position, text) => text)}`,
      );
      return;
    }

    if (mark === 'fill') {
      // `\k` lengths: differences of absolute starts, each rounded on its own.
      const body = pageBody(page, words, main, (position, text) => {
        const length = centis(until(position)) - centis(page.marks[position] as number);
        return `{\\k${Math.max(0, length)}}${text}`;
      });
      event(page.start, page.end, `{${place}${entrance(true)}}${body}`);
      return;
    }

    page.words.forEach((_word, active) => {
      const first = active === 0;
      let body: string;
      if (mark === 'colour') {
        const pop = look.mark.pop
          ? `\\fscx${WORD_POP.fromPercent}\\fscy${WORD_POP.fromPercent}\\t(0,${WORD_POP.ms},\\fscx100\\fscy100)`
          : '';
        body = pageBody(page, words, main, (position, text) =>
          position === active
            ? `{\\1c${assColourTag(look.mark.colour)}${pop}}${text}${reset}`
            : text,
        );
        // A page pop would be undone by the `\r` after the marked word, so a page with marked words only fades.
        body = `{${place}${first ? entrance(false) : ''}}${body}`;
      } else if (mark === 'box') {
        body = pageBody(page, words, main, (position, text) =>
          position === active ? `{\\3a${assAlpha(1)}}${text}{\\3a${assAlpha(0)}}` : text,
        );
        // Every other word's box is fully transparent, so the layout never shifts.
        body = `{${place}\\3a${assAlpha(0)}${first ? entrance(false) : ''}}${body}`;
      } else {
        // reveal: words said so far show; the rest keep their place, invisible.
        body = pageBody(page, words, main, (position, text) =>
          position === active + 1 ? `{\\alpha${assAlpha(0)}}${text}` : text,
        );
        body = `{${place}}${body}`;
      }
      event(page.marks[active] as number, until(active), body);
    });
  });
  return lines;
}
