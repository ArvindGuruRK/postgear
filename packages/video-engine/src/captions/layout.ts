/**
 * Where a clip's captions sit and how each page breaks: the one definition
 * the browser preview and the export both read, so a page shown in the editor
 * is the page libass draws.
 *
 * The caption block is centred on the track's `position`. Its wrapping width
 * is a share of the canvas (the block never reaches the edges), and the pager
 * is handed a line width a little inside that, so a small error in the width
 * estimate never makes libass wrap a line the pager thought would fit.
 */
import type { CaptionsTrack, ClipDocument } from '../document/schema';
import { outputDuration } from '../time/time-map';
import type { Transcript } from '../transcript/types';
import { type CaptionWord, captionWords } from './map';
import { type CaptionPage, captionPages } from './pages';
import { type CaptionScript, hasLetterCase, marksSingleWords, scriptOf, withoutEmoji } from './script';
import { type CaptionLook, type CaptionMarkKind, trackLook } from './styles';
import { measureWith } from './width';

/** The caption block's wrapping width, as a share of the canvas width. */
export const CAPTION_BLOCK_SHARE = 0.86;
/** The pager fills a line only this far, so libass never wraps what the pager fitted. */
export const CAPTION_FILL = 0.92;
/** Pages of scripts whose width is estimated loosely hold fewer words. */
const LOOSE_SCRIPT_FEWER_WORDS = 1;

export interface CaptionGeometry {
  /** The block's centre, canvas pixels. */
  cx: number;
  cy: number;
  /** The wrapping box: its left edge and width, canvas pixels. */
  boxLeft: number;
  boxWidth: number;
  /** The text's size, canvas pixels (the canvas's short side is 1080). */
  sizePx: number;
  /** Outline width or box padding, canvas pixels. */
  backingPx: number;
}

export function captionGeometry(
  track: Pick<CaptionsTrack, 'position' | 'sizePx'>,
  look: Pick<CaptionLook, 'outline' | 'box' | 'mark'>,
  canvas: { width: number; height: number },
): CaptionGeometry {
  const boxWidth = Math.round(canvas.width * CAPTION_BLOCK_SHARE);
  const cx = track.position.x * canvas.width;
  // The block stays on the canvas however far it was dragged.
  const boxLeft = Math.min(canvas.width - boxWidth, Math.max(0, cx - boxWidth / 2));
  const backing = look.outline
    ? look.outline.width
    : look.box
      ? look.box.pad
      : look.mark.kind === 'box'
        ? MARK_BOX_PAD
        : 0;
  return {
    cx: boxLeft + boxWidth / 2,
    cy: Math.round(track.position.y * canvas.height * 100) / 100,
    boxLeft,
    boxWidth,
    sizePx: track.sizePx,
    backingPx: backing,
  };
}

/** The padding of the box behind a spoken word (`mark.kind: 'box'`), canvas pixels. */
export const MARK_BOX_PAD = 10;

/** A word as written: its emoji taken out, in the look's letter case when its script has one. */
export function displayWord(text: string, letterCase: CaptionLook['letterCase']): string {
  const clean = withoutEmoji(text).trim();
  if (letterCase === 'as_spoken' || !hasLetterCase(scriptOf(clean))) return clean;
  return letterCase === 'upper' ? clean.toLocaleUpperCase('en') : clean.toLocaleLowerCase('en');
}

export interface CaptionLayout {
  geometry: CaptionGeometry;
  /** The look the pages are drawn with (the style's, with the track's choices on top). */
  look: CaptionLook;
  /** How the spoken word is really marked: the look's kind, or `none` when words cannot be marked one by one. */
  mark: CaptionMarkKind;
  script: CaptionScript;
  /** Every word shown, on the clip's clock. */
  words: CaptionWord[];
  pages: CaptionPage[];
}

export interface CaptionLayoutInput {
  doc: Pick<ClipDocument, 'segments' | 'canvas'>;
  track: CaptionsTrack;
  /** The style's look, already resolved (`resolveStyle`). */
  look: CaptionLook;
  /** The transcript, with the video's word fixes applied. */
  transcript: Pick<Transcript, 'words' | 'language'>;
  /**
   * False when the word times are not real (a file the person supplied, or a
   * translation: each line's time was spread over its words), so the page is
   * the unit of highlight.
   */
  wordTimed: boolean;
  /** Only the words of this source are shown (a montage has several). */
  sourceId?: string;
}

/**
 * Everything needed to draw a clip's captions: the words on the clip's
 * clock, their pages and lines, where the block sits, and how the spoken word
 * is marked. Pure, and cheap enough to run again on every edit.
 */
export function captionLayout(input: CaptionLayoutInput): CaptionLayout {
  const look = trackLook(input.track, input.look);
  const geometry = captionGeometry(input.track, look, input.doc.canvas);
  const mapped = captionWords(input.doc, input.track, input.transcript, {
    sourceId: input.sourceId,
  });
  // A word that is nothing but emoji has nothing left to draw as text.
  const words = mapped.filter((word) => displayWord(word.text, look.letterCase).length > 0);
  const script = scriptOf(words.map((word) => word.text).join(' '));
  const single = input.wordTimed && marksSingleWords(script);
  const mark: CaptionMarkKind = single ? look.mark.kind : 'none';
  const display = (text: string) => displayWord(text, look.letterCase);
  const pages = captionPages(words, {
    maxWords: Math.max(
      1,
      input.track.maxWords - (script === 'latin' ? 0 : LOOSE_SCRIPT_FEWER_WORDS),
    ),
    lineWidth: geometry.boxWidth * CAPTION_FILL,
    measure: measureWith({
      font: look.font,
      weight: look.weight,
      sizePx: geometry.sizePx,
      backingPx: geometry.backingPx,
    }),
    clipMs: outputDuration(input.doc),
    display,
  });
  return { geometry, look, mark, script, words, pages };
}
