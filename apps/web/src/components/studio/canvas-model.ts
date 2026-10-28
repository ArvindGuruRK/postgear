/**
 * The canvas's view and keys (Sprint 9b): how far it is zoomed, and which
 * keys end typing on the slide.
 *
 * A zoom level is a share of the slide's real size: at 100% a square slide
 * is 1080 pixels across, as it exports. Fit is not a level but a rule (as
 * large as the canvas can show the slide whole), which is what the canvas
 * did before zoom and what it goes back to; it follows the window as it
 * resizes, where a chosen level stays put. The slide is never drawn smaller
 * than Fit, since a smaller slide only shows less of itself.
 */
import { type TypingKeyPress, typingKeyAction } from '@postgear/design-engine';

/** The levels Zoom In and Zoom Out stop at, as shares of the slide's real size. */
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * How much larger (or smaller) the next level must be than the scale on
 * screen. Without it, a Fit of 49% would step to 50%, a click that changes
 * nothing anyone can see.
 */
const MIN_STEP = 1.1;

export type Zoom = 'fit' | number;

/** True when the canvas is showing the slide whole: Fit, or a level Fit has outgrown. */
export function isFitted(zoom: Zoom, fit: number): boolean {
  return zoom === 'fit' || zoom <= fit;
}

/** The scale the slide is drawn at. */
export function zoomScale(zoom: Zoom, fit: number): number {
  return isFitted(zoom, fit) ? fit : (zoom as number);
}

/** The next level up, or null at the top. */
export function zoomIn(zoom: Zoom, fit: number): number | null {
  const scale = zoomScale(zoom, fit);
  return ZOOM_LEVELS.find((level) => level >= scale * MIN_STEP) ?? null;
}

/**
 * The next level down, Fit once the next level would be little larger than
 * Fit itself, or null when the slide is already whole.
 */
export function zoomOut(zoom: Zoom, fit: number): Zoom | null {
  if (isFitted(zoom, fit)) return null;

  const scale = zoom as number;
  const lower = [...ZOOM_LEVELS].reverse().find((level) => level <= scale / MIN_STEP);
  return lower !== undefined && lower >= fit * MIN_STEP ? lower : 'fit';
}

/** "51%": the level as the canvas shows it. */
export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export type ZoomKey = 'in' | 'out' | 'fit';

/** The parts of a key press `zoomKeyOf` reads; a `KeyboardEvent` has them all. */
export interface ZoomKeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Plus zooms in, minus out, 0 fits, without Ctrl, Cmd or Alt: with Ctrl or
 * Cmd the same keys are the browser's own page zoom, which stays the
 * browser's. Equals and underscore are where plus and minus sit without
 * Shift on many keyboards. Arrows, Delete, Enter and Escape are the canvas's
 * element keys, and Z and Y are Undo and Redo, so none of those is used.
 */
export function zoomKeyOf(press: ZoomKeyPress): ZoomKey | null {
  if (press.ctrlKey || press.metaKey || press.altKey) return null;

  switch (press.key) {
    case '+':
    case '=':
      return 'in';
    case '-':
    case '_':
      return 'out';
    case '0':
      return 'fit';
    default:
      return null;
  }
}

/** Where the middle of a scrolling box is, as shares of everything it scrolls over. */
export interface ScrollAnchor {
  x: number;
  y: number;
}

export interface ScrollBox {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

/** The point of the slide in the middle of the view, taken before a zoom changes it. */
export function scrollAnchor(box: ScrollBox): ScrollAnchor {
  return {
    x: (box.scrollLeft + box.clientWidth / 2) / Math.max(box.scrollWidth, 1),
    y: (box.scrollTop + box.clientHeight / 2) / Math.max(box.scrollHeight, 1),
  };
}

/** The scroll that puts the same point back in the middle once the slide has its new size. */
export function scrollToAnchor(
  box: Pick<ScrollBox, 'scrollWidth' | 'scrollHeight' | 'clientWidth' | 'clientHeight'>,
  anchor: ScrollAnchor,
): { left: number; top: number } {
  const clamp = (value: number, most: number) => Math.min(Math.max(0, value), Math.max(0, most));

  return {
    left: clamp(
      anchor.x * box.scrollWidth - box.clientWidth / 2,
      box.scrollWidth - box.clientWidth,
    ),
    top: clamp(
      anchor.y * box.scrollHeight - box.clientHeight / 2,
      box.scrollHeight - box.clientHeight,
    ),
  };
}

/**
 * Whether a key ends typing on the slide, so the element should have focus
 * back once it has: Escape, Ctrl or Cmd with Enter, or Enter alone on a
 * one-line slot. It asks the renderer's own `typingKeyAction`, so the two
 * never disagree; the canvas only needs to know that the typing ends, not
 * how. Enter in a multi-line slot is a new line, and while an input method
 * composes, both keys are its own.
 */
export function endsTyping(press: TypingKeyPress, multiline: boolean): boolean {
  return typingKeyAction(press, multiline) !== null;
}
