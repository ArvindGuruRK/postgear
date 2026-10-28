/**
 * What the slides rail calls each slide (Sprint 9b, after CarouselClick).
 */
import { type DesignSlide, findLayout, SLIDE_ROLE_LABELS } from '@postgear/design-engine';

/**
 * "1. Cover", "4. Closing CTA": the slide's place and what kind of slide its
 * layout makes, the same words on screen and for a screen reader. A layout
 * this version does not know (a document from a newer one) still has its
 * number: "3. Slide".
 */
export function slideName(slide: Pick<DesignSlide, 'layoutId'>, index: number): string {
  const layout = findLayout(slide.layoutId);
  return `${index + 1}. ${layout ? SLIDE_ROLE_LABELS[layout.role] : 'Slide'}`;
}
