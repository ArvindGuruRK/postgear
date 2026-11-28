/**
 * The clip's captions in the editor's preview (Sprint 13, Module 03).
 *
 * Drawn as DOM inside the overlay layer's canvas box, from the same
 * `captionLayout` the export's ASS writer reads: the same words on the
 * clip's clock, the same pages and line breaks, the same block position and
 * size, and the same way of marking the spoken word. So what is on screen at
 * a moment in the editor is what libass draws at that moment.
 *
 * ```
 * block        the wrapping box, centred on the track's position
 *   line       one per line the pager made (it never wraps on its own)
 *     run      the line's words; carries a page box when the look has one
 *       word   one span a word; the spoken one is restyled as time passes
 * ```
 *
 * How each mark is drawn, beside its ASS pattern (`render/caption-ass.ts`):
 * - `colour`: the spoken word takes the mark colour; with `pop` it starts at
 *   116 % and settles to 100 % in 90 ms (`\fscx116\t(0,90,...)`). libass
 *   scales the word's advance too, so the line widens and its neighbours
 *   move aside; the preview grows the word's `font-size` for the same reason
 *   (a CSS `transform` would leave its layout box at 100 % and draw the word
 *   over the spaces either side, most visibly when paused on a word's start).
 * - `box`: a box of the mark colour behind the spoken word (`\3a` on one
 *   word of a `BorderStyle 3` line).
 * - `fill`: every word up to the spoken one has the mark colour (`\k`).
 * - `reveal`: words after the spoken one are there but invisible (`\alpha`),
 *   so nothing moves as they appear.
 * - `none`: the page shows as it is.
 *
 * A page is rebuilt only when it changes; between pages only the few style
 * values that depend on time are touched. The known differences from the
 * export (an outline is a pixel or two off, a box hugs a line a little
 * differently) are why Preview Export exists.
 */
import {
  CAPTION_SHADOW_SHARE,
  type CaptionLayout,
  type CaptionMoment,
  type CaptionPage,
  captionAt,
  displayWord,
  type FontManifest,
  lineHeightEm,
  MARK_BOX_PAD,
  resolveTextFont,
  TEXT_SHADOW,
} from '@postgear/video-engine';

/** The spoken word starts this much larger and settles in `POP_MS` (the ASS writer's numbers). */
export const POP_SCALE = 1.16;
export const POP_MS = 90;
/** A page that pops in starts at this size and settles in `ENTRANCE_POP_MS`. */
export const ENTRANCE_POP_SCALE = 0.82;
export const ENTRANCE_POP_MS = 110;
export const ENTRANCE_FADE_MS = 120;

function hexToRgba(hex: string, opacity: number): string {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1] ?? '000000';
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export interface CaptionCss {
  /** The wrapping box: place, width, font. */
  block: Record<string, string>;
  /** A line's run of words: the outline or the page box, and the shadow. */
  run: Record<string, string>;
}

/** The CSS that does not change while a look and a position stay the same. Pure. */
export function captionCss(
  layout: Pick<CaptionLayout, 'geometry' | 'look' | 'mark'>,
  manifest: FontManifest,
  fontFamily: (family: string) => string,
): CaptionCss {
  const { geometry: g, look } = layout;
  const font = resolveTextFont(manifest, look.font, look.weight);
  // The export draws a caption shadow only on outlined (or bare) text, never under a box.
  const boxed = Boolean(look.box) || look.mark.kind === 'box';
  const shadowPx = Math.round(g.sizePx * CAPTION_SHADOW_SHARE * 100) / 100;
  const shadow =
    look.shadow && !boxed
      ? `${shadowPx}px ${shadowPx}px 0 ${hexToRgba(TEXT_SHADOW.colour, TEXT_SHADOW.opacity)}`
      : '';
  const block: Record<string, string> = {
    left: `${g.boxLeft}px`,
    top: `${g.cy}px`,
    width: `${g.boxWidth}px`,
    'font-family': fontFamily(look.font),
    'font-size': `${g.sizePx}px`,
    'font-weight': String(font?.weight ?? look.weight),
    'font-style': look.italic ? 'italic' : 'normal',
    'line-height': String(font ? lineHeightEm(font) : 1.2),
    color: look.colour,
  };
  const run: Record<string, string> = { 'text-shadow': shadow };
  if (look.outline) {
    // ASS grows the outline outward; a CSS stroke is centred on the edge, so twice as wide, under the fill.
    run['-webkit-text-stroke'] = `${g.backingPx * 2}px ${look.outline.colour}`;
    run['paint-order'] = 'stroke fill';
  } else if (look.box) {
    run.background = look.box.colour;
    run.padding = `${g.backingPx}px`;
  } else if (look.mark.kind === 'box' && layout.mark === 'none') {
    // Words that cannot be marked one by one keep the box, behind the whole page.
    run.background = look.mark.colour;
    run.padding = `${MARK_BOX_PAD}px`;
  }
  return { block, run };
}

/** What changes on one word as time passes. Empty strings mean "as the page has it". */
export interface WordPaint {
  color: string;
  background: string;
  /** A box that grows around the word without moving its neighbours. */
  boxShadow: string;
  visibility: '' | 'hidden';
  /**
   * The pop, as a font size in ems of the line ("1.160em"). It changes the
   * word's layout box, as `\fscx`/`\fscy` change its advance in libass, so
   * the spaces either side stay whole.
   */
  fontSize: string;
}

const PLAIN: WordPaint = Object.freeze({
  color: '',
  background: '',
  boxShadow: '',
  visibility: '',
  fontSize: '',
});

/** Each word of the page at a clip moment. Pure: the layer writes exactly this. */
export function captionWordPaints(
  layout: Pick<CaptionLayout, 'look' | 'mark'>,
  moment: CaptionMoment,
  outputMs: number,
): WordPaint[] {
  const { look, mark } = layout;
  const { page, active } = moment;
  return page.words.map((_word, position) => {
    if (mark === 'none') return PLAIN;
    if (mark === 'colour') {
      if (position !== active) return PLAIN;
      let fontSize = '';
      if (look.mark.pop) {
        const since = Math.max(0, outputMs - (page.marks[active] as number));
        const left = 1 - Math.min(1, since / POP_MS);
        const scale = 1 + (POP_SCALE - 1) * left;
        fontSize = scale > 1.0005 ? `${scale.toFixed(3)}em` : '';
      }
      return { ...PLAIN, color: look.mark.colour, fontSize };
    }
    if (mark === 'box') {
      if (position !== active) return PLAIN;
      return {
        ...PLAIN,
        background: look.mark.colour,
        boxShadow: `0 0 0 ${MARK_BOX_PAD}px ${look.mark.colour}`,
      };
    }
    if (mark === 'fill') {
      return position <= active ? { ...PLAIN, color: look.mark.colour } : PLAIN;
    }
    // reveal
    return position <= active ? PLAIN : { ...PLAIN, visibility: 'hidden' };
  });
}

/** How far a page has arrived at a clip moment. Pure. */
export function captionEntrance(
  look: Pick<CaptionLayout['look'], 'entrance'>,
  page: Pick<CaptionPage, 'start'>,
  outputMs: number,
): { opacity: number; scale: number } {
  const since = Math.max(0, outputMs - page.start);
  if (look.entrance === 'fade') {
    return { opacity: Math.min(1, since / ENTRANCE_FADE_MS), scale: 1 };
  }
  if (look.entrance === 'pop') {
    const done = Math.min(1, since / ENTRANCE_POP_MS);
    return { opacity: 1, scale: ENTRANCE_POP_SCALE + (1 - ENTRANCE_POP_SCALE) * done };
  }
  return { opacity: 1, scale: 1 };
}

function apply(el: HTMLElement, css: Record<string, string>): void {
  for (const [name, value] of Object.entries(css)) {
    if (value === '') el.style.removeProperty(name);
    else el.style.setProperty(name, value);
  }
}

/** The captions block of one overlay layer. */
export class CaptionsNode {
  readonly block: HTMLDivElement;
  private layout: CaptionLayout | null = null;
  private page: CaptionPage | null = null;
  private words: HTMLSpanElement[] = [];
  private painted: WordPaint[] = [];
  private entrance = '';
  private shown: boolean | null = null;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
    private readonly manifest: FontManifest,
    private readonly fontFamily: (family: string) => string,
  ) {
    const block = doc.createElement('div');
    block.dataset.previewLayer = 'captions';
    block.style.position = 'absolute';
    block.style.textAlign = 'center';
    block.style.whiteSpace = 'pre';
    block.style.pointerEvents = 'none';
    block.style.transformOrigin = '50% 50%';
    // Over every picture sticker (negative levels). Texts and badges start at this level too,
    // and the block is first in the box, so each of them is drawn over the captions.
    block.style.zIndex = '0';
    block.dir = 'auto';
    block.style.visibility = 'hidden';
    parent.insertBefore(block, parent.firstChild);
    this.block = block;
  }

  /**
   * Draws the captions of `layout` at `outputMs`; `ready` is false while the
   * look's font is still loading (the block then waits, as texts do).
   */
  update(layout: CaptionLayout | null, outputMs: number, ready: boolean): void {
    const moment = layout ? captionAt(layout.pages, outputMs) : null;
    const show = Boolean(layout && moment && ready);
    if (this.shown !== show) {
      this.block.style.visibility = show ? 'visible' : 'hidden';
      this.shown = show;
    }
    if (!layout || !moment) {
      if (!layout) this.layout = null;
      return;
    }

    if (this.layout !== layout) {
      const css = captionCss(layout, this.manifest, this.fontFamily);
      apply(this.block, css.block);
      this.layout = layout;
      this.page = null;
    }
    if (this.page !== moment.page) {
      this.build(layout, moment.page);
      this.page = moment.page;
    }

    const paints = captionWordPaints(layout, moment, outputMs);
    paints.forEach((paint, position) => {
      const before = this.painted[position];
      const el = this.words[position];
      if (!el || before === paint) return;
      if (before?.color !== paint.color) el.style.color = paint.color;
      if (before?.background !== paint.background) el.style.background = paint.background;
      if (before?.boxShadow !== paint.boxShadow) el.style.boxShadow = paint.boxShadow;
      if (before?.visibility !== paint.visibility) el.style.visibility = paint.visibility;
      if (before?.fontSize !== paint.fontSize) el.style.fontSize = paint.fontSize;
    });
    this.painted = paints;

    const arrived = captionEntrance(layout.look, moment.page, outputMs);
    const entrance = `${arrived.opacity.toFixed(3)}|${arrived.scale.toFixed(3)}`;
    if (entrance !== this.entrance) {
      this.block.style.opacity = arrived.opacity >= 1 ? '' : arrived.opacity.toFixed(3);
      this.block.style.transform =
        arrived.scale >= 0.9995
          ? 'translateY(-50%)'
          : `translateY(-50%) scale(${arrived.scale.toFixed(3)})`;
      this.entrance = entrance;
    }
  }

  remove(): void {
    this.block.remove();
    this.words = [];
    this.painted = [];
    this.layout = null;
    this.page = null;
  }

  /** The page's lines and words as nodes, exactly as the pager broke them. */
  private build(layout: CaptionLayout, page: CaptionPage): void {
    const css = captionCss(layout, this.manifest, this.fontFamily);
    this.block.textContent = '';
    this.words = [];
    this.painted = [];
    this.entrance = '';
    // A page whose widest word would leave the box is drawn smaller, as the
    // export names `\fs` at the page's scale (Module 16); the pop is in ems,
    // so it shrinks with it.
    const pageSize = page.scale !== undefined && page.scale < 1 ? `${page.scale}em` : '';
    for (const line of page.lines) {
      const row = this.doc.createElement('div');
      if (pageSize) row.style.fontSize = pageSize;
      const run = this.doc.createElement('span');
      run.style.display = 'inline-block';
      apply(run, css.run);
      line.forEach((position, at) => {
        if (at > 0) run.appendChild(this.doc.createTextNode(' '));
        const word = this.doc.createElement('span');
        word.dataset.captionWord = String(position);
        word.style.display = 'inline-block';
        word.textContent = displayWord(
          (page.words[position] as CaptionPage['words'][number]).text,
          layout.look.letterCase,
        );
        run.appendChild(word);
        this.words[position] = word;
      });
      row.appendChild(run);
      this.block.appendChild(row);
    }
  }
}
