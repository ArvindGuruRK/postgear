/**
 * Cards on the rendered clock (Sprint 13, Module 10).
 *
 * A card (`doc.cards.opening`, `doc.cards.closing`) is a scene the compiler
 * draws with no video. It sits OUTSIDE the clip's own time: the time map,
 * every item, caption, bleep, zoom and the clip's fades are in the clip's
 * time, which starts after the opening card. The rendered file is
 *
 *   opening card | the clip (its own time, `outputDuration`) | closing card
 *
 * so a moment of the file is `renderedMs = openingMs + clipMs`.
 */
import type { ClipDocument } from '../document/schema';
import { outputDuration } from './time-map';

type CardsDocument = Partial<Pick<ClipDocument, 'cards'>>;

/** How long the opening card plays before the clip (0 without one). */
export function openingCardMs(doc: CardsDocument): number {
  return doc.cards?.opening?.durationMs ?? 0;
}

/** How long the closing card plays after the clip (0 without one). */
export function closingCardMs(doc: CardsDocument): number {
  return doc.cards?.closing?.durationMs ?? 0;
}

/** Both cards' length: what the rendered file adds to the clip's own length. */
export function cardsMs(doc: CardsDocument): number {
  return openingCardMs(doc) + closingCardMs(doc);
}

/** The rendered file's length: the clip's own length plus its cards. */
export function renderedDuration(doc: Pick<ClipDocument, 'segments'> & CardsDocument): number {
  return outputDuration(doc) + cardsMs(doc);
}

/** Where a moment of the rendered file is: in a card (ms into it) or in the clip (clip ms). */
export type RenderedMoment =
  | { card: 'opening' | 'closing'; cardMs: number; clipMs: null }
  | { card: null; cardMs: null; clipMs: number };

/**
 * A moment of the rendered file on the clip's clock. A moment before 0 is
 * the file's start, after the end the file's end; a card's last moment
 * belongs to the card (half-open ranges, like segments, except the very end).
 */
export function renderedMoment(
  doc: Pick<ClipDocument, 'segments'> & CardsDocument,
  renderedMs: number,
): RenderedMoment {
  const opening = openingCardMs(doc);
  const clip = outputDuration(doc);
  const closing = closingCardMs(doc);
  const total = opening + clip + closing;
  const t = Math.min(total, Math.max(0, Number.isFinite(renderedMs) ? renderedMs : 0));
  if (opening > 0 && t < opening) return { card: 'opening', cardMs: t, clipMs: null };
  if (closing > 0 && t >= opening + clip) {
    return { card: 'closing', cardMs: t - opening - clip, clipMs: null };
  }
  return { card: null, cardMs: null, clipMs: t - opening };
}
