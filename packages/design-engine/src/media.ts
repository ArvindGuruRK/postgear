/**
 * Which pictures a design draws.
 *
 * The exporter inlines exactly these, the share page turns exactly these into
 * URLs, and the API checks exactly these still exist before it renders. One
 * list, written to the same rules `SlideView` draws by:
 *
 * - a hidden slot draws nothing, so its picture is not needed;
 * - a logo slot with no picture of its own shows the brand kit's logo;
 * - a photo background is a picture like any other;
 * - a slide whose layout is no longer available draws a message, not its
 *   pictures.
 *
 * Over-collecting would inline megabytes a slide never shows and report a
 * deleted picture nobody can see; under-collecting would export a blank slot.
 * Keeping the rule here, beside the renderer, is what stops the three callers
 * drifting into either.
 */
import { findLayout, slotFrame } from './layouts';
import type { DesignDocument } from './types';

/** The media ids one slide draws, in the order the slide draws them. */
export function slideMediaIds(document: DesignDocument, slideIndex: number): string[] {
  const slide = document.slides[slideIndex];
  const layout = slide ? findLayout(slide.layoutId) : null;
  if (!slide || !layout) return [];

  const ids = new Set<string>();
  if (slide.background.kind === 'media') ids.add(slide.background.mediaId);

  for (const slot of layout.slots) {
    if (slot.kind !== 'image' && slot.kind !== 'logo') continue;

    const state = slide.elements[slot.id];
    if (state?.hidden) continue;
    if (!slotFrame(layout, slot, document.format, state)) continue;

    const mediaId = state?.mediaId ?? (slot.kind === 'logo' ? document.brand.logoMediaId : null);
    if (mediaId) ids.add(mediaId);
  }

  return [...ids];
}

/** Every media id the whole design draws, each once. */
export function designMediaIds(document: DesignDocument): string[] {
  const ids = new Set<string>();

  for (let index = 0; index < document.slides.length; index++) {
    for (const id of slideMediaIds(document, index)) ids.add(id);
  }

  return [...ids];
}
