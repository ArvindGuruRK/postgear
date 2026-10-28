/**
 * The words a slide starts with when it does not come from a template: a
 * slide added in the editor, a blank design, a layout switched to one with
 * slots the old one did not have.
 *
 * Generic on purpose. A preset's sample copy is written for its story; these
 * only have to show what each slot is for, in roughly the length it wants, so
 * the slide looks like a slide and not a set of empty boxes.
 */
import type { DesignSlide, ElementState, SlideLayout, SlotId } from './types';

const SAMPLE_TEXT: Partial<Record<SlotId, string>> = {
  eyebrow: 'Short label',
  headline: 'Your Headline Here',
  subheadline: 'A short line that adds to the headline.',
  body: 'Say the one thing this slide is for, in a sentence or two.',
  quote: '"A line worth repeating goes here."',
  attribution: 'Name, role',
  stat: '42%',
  statLabel: 'of the people you asked said something worth knowing',
  cta: 'Follow for more',
  footer: 'Swipe for more',
};

/**
 * A footer that a layout labels as a link (a Signature closing slide's) wants
 * an address, not a line: "Swipe for more" under "Book your call" reads wrong.
 */
const SAMPLE_LINK = 'yourbrand.com';

const SAMPLE_ITEMS: Partial<Record<SlotId, string[]>> = {
  list: ['The first point', 'The second point', 'The third point'],
};

/** The sample state for one slot, or nothing for a slot that has none. */
export function sampleState(layout: SlideLayout, slotId: SlotId): ElementState | null {
  const slot = layout.slots.find((entry) => entry.id === slotId);
  if (!slot) return null;

  const state: ElementState = {};

  const text = slot.label === 'Link' ? SAMPLE_LINK : SAMPLE_TEXT[slot.id];
  if (slot.kind === 'text' && !slot.bind && text !== undefined) {
    state.text = text;
  }

  if (slot.kind === 'list') {
    const items = SAMPLE_ITEMS[slot.id] ?? [];
    state.items = items.slice(0, slot.maxItems ?? items.length);
  }

  if (slot.optional && slot.defaultHidden) state.hidden = true;

  return Object.keys(state).length > 0 ? state : null;
}

/** Sample elements for every slot of a layout. */
export function sampleElements(layout: SlideLayout): DesignSlide['elements'] {
  const elements: DesignSlide['elements'] = {};

  for (const slot of layout.slots) {
    const state = sampleState(layout, slot.id);
    if (state) elements[slot.id] = state;
  }

  return elements;
}
