/**
 * Cards in the render plan (Sprint 13, Module 10; Module 11's montage title
 * reuses the opening card). Research 09 section 8: a card is a `color`
 * source of the output size at the output rate for its length, the logo
 * overlaid, the line drawn by an `ass` filter reading the card's own small
 * ASS file, and `anullsrc` for its silent sound. The compiler joins it with
 * `concat` before (opening) or after (closing) the clip's finished picture
 * and sound.
 *
 * The line's numbers are canvas pixels (the card's ASS file has the canvas
 * as its `PlayRes`, as the clip's own does), the logo's are output pixels.
 */
import type { ClipCard, ClipDocument } from '../document/schema';
import { stickerRefKey } from '../document/sticker';
import { cardHasText, cardLayout } from './card-style';
import { RenderCompileError } from './errors';
import type { FontManifest } from './fonts';
import { evenPosition, evenSize } from './specs';
import type { RenderStickerAsset } from './sticker-plan';
import { type PlanText, planTextItem } from './text-plan';

export type CardPlace = 'opening' | 'closing';

/** The card's own ASS file: `card-opening.ass` or `card-closing.ass`. */
export function cardAssFile(place: CardPlace): string {
  return `card-${place}.ass`;
}

/** A card's logo, ready for its overlay. */
export interface PlanCardLogo {
  /** The `-i` it reads (after the video, the stickers, the mark and the sounds). */
  inputIndex: number;
  file: string;
  /** Its size and top left on the output, even pixels. */
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface PlanCard {
  place: CardPlace;
  durationMs: number;
  /** `#RRGGBB`. */
  background: string;
  /** The line, in canvas pixels on the card's own clock, or null for a logo-only card. */
  text: PlanText | null;
  /** The card's ASS file name when it has a line. */
  assFile: string | null;
  logo: PlanCardLogo | null;
}

/** The cards of a render, and the clip's own length between them. */
export interface PlanCards {
  /** The clip's own length (the time map's): fades, items, captions and bleeps are on it. */
  bodyMs: number;
  opening: PlanCard | null;
  closing: PlanCard | null;
}

function planCard(
  card: ClipCard,
  place: CardPlace,
  doc: ClipDocument,
  stickers: Readonly<Record<string, RenderStickerAsset>>,
  manifest: FontManifest | null,
  output: { width: number; height: number; scale: number },
  inputIndex: number,
): PlanCard {
  let picture: RenderStickerAsset | null = null;
  if (card.logo) {
    const key = stickerRefKey({ asset: card.logo.asset }) as string;
    const asset = stickers[key];
    if (!asset) {
      throw new RenderCompileError('sticker_missing', "The card's logo file was not handed in", {
        card: place,
        ref: key,
      });
    }
    if (
      !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(asset.file) ||
      asset.file.length > 120 ||
      !(Number.isInteger(asset.width) && asset.width > 0) ||
      !(Number.isInteger(asset.height) && asset.height > 0)
    ) {
      throw new RenderCompileError('invalid_context', "The card's logo file is not usable", {
        card: place,
        ref: key,
      });
    }
    picture = asset;
  }
  const layout = cardLayout(card, doc.canvas, picture, `card_${place}`);
  const text = layout.text ? planTextItem(layout.text, doc, manifest, 0) : null;
  let logo: PlanCardLogo | null = null;
  if (layout.logo && picture) {
    const width = Math.min(output.width, evenSize(layout.logo.w * output.scale));
    const height = Math.min(output.height, evenSize(layout.logo.h * output.scale));
    logo = {
      inputIndex,
      file: picture.file,
      width,
      height,
      x: Math.min(output.width - width, evenPosition((output.width - width) / 2)),
      y: Math.min(output.height - height, evenPosition(layout.logo.y * output.scale)),
    };
  }
  return {
    place,
    durationMs: card.durationMs,
    background: card.background.toUpperCase(),
    text,
    assFile: text && cardHasText(card) ? cardAssFile(place) : null,
    logo,
  };
}

/**
 * The document's cards, or null when it has none (the plan then has no
 * `cards` field at all, so a clip without cards plans as before). Logos read
 * the inputs from `firstInput` on, opening first.
 */
export function planCards(
  doc: ClipDocument,
  stickers: Readonly<Record<string, RenderStickerAsset>>,
  manifest: FontManifest | null,
  output: { width: number; height: number; scale: number },
  bodyMs: number,
  firstInput: number,
): PlanCards | null {
  const opening = doc.cards?.opening;
  const closing = doc.cards?.closing;
  if (!opening && !closing) return null;
  let next = firstInput;
  const plan = (card: ClipCard | undefined, place: CardPlace): PlanCard | null => {
    if (!card) return null;
    const planned = planCard(card, place, doc, stickers, manifest, output, next);
    if (planned.logo) next += 1;
    return planned;
  };
  const first = plan(opening, 'opening');
  const last = plan(closing, 'closing');
  return { bodyMs, opening: first, closing: last };
}

/** Both cards, opening first, leaving out the missing ones. */
export function cardsOf(cards: PlanCards | null | undefined): PlanCard[] {
  if (!cards) return [];
  return [cards.opening, cards.closing].filter((card): card is PlanCard => card !== null);
}

/** The clip's own length in a plan: the whole output, less its cards. */
export function planBodyMs(plan: {
  output: { durationMs: number };
  cards?: PlanCards | null;
}): number {
  return plan.cards ? plan.cards.bodyMs : plan.output.durationMs;
}

/** How long the opening card plays before the clip in a plan (0 without one). */
export function planOpeningMs(plan: { cards?: PlanCards | null }): number {
  return plan.cards?.opening?.durationMs ?? 0;
}
