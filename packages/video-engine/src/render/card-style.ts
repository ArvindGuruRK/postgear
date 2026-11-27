/**
 * How a card's line and logo sit on the canvas (Sprint 13, Module 10; Module
 * 11's montage title card uses the same). Pure numbers in canvas pixels,
 * shared by the render plan and the editor's preview, so both draw the card
 * the same way.
 *
 * - The line is a centred text, 86 percent of the canvas wide (libass wraps
 *   a long one), in the card's colour: the plain card text (Inter 700, 72
 *   canvas pixels, no outline, no box, no shadow), or a hook look when the
 *   card names one (its own style, as Add Hook Title draws it).
 * - The logo is 36 percent of the canvas's short side wide in the picture's
 *   own shape, never taller than 30 percent of the canvas.
 * - The logo and the line are one group, centred on the canvas, the logo
 *   above, 4 percent of the canvas height between them.
 */
import type { ClipCard, TextItem, TextStyle } from '../document/schema';
import { copyTextStyle, HOOK_STYLE_IDS, type HookStyleId, textStylePreset } from '../document/text';

/** The plain card text, before the card's colour. */
export const CARD_TEXT_STYLE: Readonly<TextStyle> = Object.freeze({
  font: 'Inter',
  size: 72,
  weight: 700,
  italic: false,
  colour: '#FFFFFF',
  align: 'center',
  outline: null,
  background: null,
  shadow: false,
  uppercase: false,
});

/** The card's line is this share of the canvas width. */
export const CARD_TEXT_WIDTH_SHARE = 0.86;
/** The logo's width, a share of the canvas's short side. */
export const CARD_LOGO_SHARE = 0.36;
/** The logo is never taller than this share of the canvas height. */
export const CARD_LOGO_MAX_HEIGHT_SHARE = 0.3;
/** The gap between the logo and the line, a share of the canvas height. */
export const CARD_GAP_SHARE = 0.04;
/** One line's height, as a multiple of the text size (for centring the group). */
const LINE_HEIGHT = 1.25;

function isHookStyleId(value: string): value is HookStyleId {
  return (HOOK_STYLE_IDS as readonly string[]).includes(value);
}

/** The style a card's line is drawn in: its hook look, or the plain card text in its colour. */
export function cardTextStyle(card: Pick<ClipCard, 'look' | 'colour'>): TextStyle {
  if (card.look !== null && isHookStyleId(card.look)) {
    return copyTextStyle(textStylePreset(card.look).style);
  }
  return { ...copyTextStyle(CARD_TEXT_STYLE as TextStyle), colour: card.colour.toUpperCase() };
}

/** The card's line, if it has one (a card may show only its logo). */
export function cardHasText(card: Pick<ClipCard, 'text'>): boolean {
  return card.text.trim().length > 0;
}

/** A box in canvas pixels. */
export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardLayout {
  /** The line as an ordinary text item on the card's own clock (0 to the card's length), or null. */
  text: TextItem | null;
  /** The logo's box, or null when the card has no logo or its picture size is not known. */
  logo: CardBox | null;
}

/**
 * Where a card's line and logo go on a canvas. `logo` is the logo picture's
 * size (from its file); without it the card is laid out with no logo.
 */
export function cardLayout(
  card: ClipCard,
  canvas: { width: number; height: number },
  logo: { width: number; height: number } | null,
  id = 'card_text',
): CardLayout {
  const W = canvas.width;
  const H = canvas.height;
  let logoW = 0;
  let logoH = 0;
  if (card.logo && logo && logo.width > 0 && logo.height > 0) {
    logoW = CARD_LOGO_SHARE * Math.min(W, H);
    logoH = (logoW * logo.height) / logo.width;
    const maxH = CARD_LOGO_MAX_HEIGHT_SHARE * H;
    if (logoH > maxH) {
      logoW = (logoW * maxH) / logoH;
      logoH = maxH;
    }
  }
  const hasLogo = logoW > 0;
  const hasText = cardHasText(card);
  const style = cardTextStyle(card);
  const lineH = hasText ? style.size * LINE_HEIGHT : 0;
  const gap = hasLogo && hasText ? CARD_GAP_SHARE * H : 0;
  const top = (H - (logoH + gap + lineH)) / 2;

  const text: TextItem | null = hasText
    ? {
        id,
        type: 'text',
        start: 0,
        duration: card.durationMs,
        anchor: 'clip',
        text: card.text.trim(),
        style,
        transform: {
          x: 0.5,
          y: (top + logoH + gap + lineH / 2) / H,
          scale: 1,
          rotation: 0,
          opacity: 1,
        },
        widthPx: Math.round(W * CARD_TEXT_WIDTH_SHARE),
        fadeInMs: 0,
        fadeOutMs: 0,
      }
    : null;
  return {
    text,
    logo: hasLogo ? { x: (W - logoW) / 2, y: top, w: logoW, h: logoH } : null,
  };
}
