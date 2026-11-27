/**
 * The words a slot shows.
 *
 * Most slots show their own text, stored on the slide. Three show the
 * design's instead (`SlotDef.bind`):
 *
 * - **brand name** and **handle** are typed once and the same on every slide,
 *   so a carousel cannot end up with a different handle on slide four;
 * - **slide number** is counted, never typed, so it is right after every add,
 *   delete and reorder, and a single post shows none at all.
 * - **schedule zone** (Sprint 13) is worked out from the design's schedule:
 *   "All times Asia/Kolkata", or "On a break until Mon 23 Nov" while Twitch
 *   says the streamer is away, so changing the zone changes the line.
 *
 * The renderer, the editor's panel, the fit checks and the export warnings
 * all read text through `slotText`, so none of them can disagree about what
 * a bound slot says.
 */
import { scheduleZoneLine } from './schedule/zone-line';
import type { DesignDocument, SlotBinding, SlotDef } from './types';

type BindingSource = Pick<DesignDocument, 'brand' | 'handle' | 'slides' | 'schedule'>;

export function boundText(
  document: BindingSource,
  slideIndex: number,
  binding: SlotBinding,
): string {
  switch (binding) {
    case 'brandName':
      return document.brand.name ?? '';
    case 'handle':
      return document.handle;
    case 'slideNumber':
      return document.slides.length > 1 ? `${slideIndex + 1}/${document.slides.length}` : '';
    case 'scheduleZone':
      return document.schedule ? scheduleZoneLine(document.schedule) : '';
  }
}

/** What a text slot on a slide shows: its own words, or the design's. */
export function slotText(document: BindingSource, slideIndex: number, slot: SlotDef): string {
  if (slot.bind) return boundText(document, slideIndex, slot.bind);
  return document.slides[slideIndex]?.elements[slot.id]?.text ?? '';
}

/**
 * Whether the user can type into a slot: every text slot except a counted one
 * and the schedule's zone line, which the schedule's own settings write.
 */
export function isTypeable(slot: SlotDef): boolean {
  return slot.kind === 'text' && slot.bind !== 'slideNumber' && slot.bind !== 'scheduleZone';
}

/** One line: a brand name or a handle cannot hold a line break. */
export function singleLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * Cuts text to a length limit without splitting an emoji, or any other
 * character written as two UTF-16 units, in half. Limits count those units
 * because that is what the schema (and `String.length`) counts.
 */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;

  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);

  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
