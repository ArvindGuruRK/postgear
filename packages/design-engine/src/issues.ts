/**
 * Things worth telling the user before a design goes out.
 *
 * None of these stops an export: the stories ask Export and Send to *warn*
 * and name the slide (DS-4.4), never to refuse. The same list feeds the
 * editor's slide rail, the export dialog and the warnings the API streams
 * while it renders, so a problem is described in the same words everywhere.
 *
 * Text that is too long is the one issue this file cannot see: whether words
 * fit is a question for a browser with the real fonts. The in-page fitter
 * answers it (`render/fit-runtime.ts`) and its answer is reported through
 * `issueMessage` like the rest.
 */

import { slotText } from './bindings';
import { photoNeedsDarkening } from './brand';
import { inkOf } from './ink';
import { findLayout } from './layouts';
import type { DesignDocument, SlotId } from './types';

export type DesignIssueKind =
  /** Text that still overflows its slot at the smallest size. */
  | 'overflow'
  /** A colour the user chose that does not read on its ground. */
  | 'unreadable'
  /** A picture slot with nothing in it. */
  | 'emptyPicture'
  /** A picture, logo or photo whose media item has been deleted. */
  | 'missingPicture'
  /** A photo background whose overlay is too weak to promise readable text. */
  | 'photoTooLight';

export interface DesignIssue {
  kind: DesignIssueKind;
  /** Zero-based. */
  slideIndex: number;
  /** The slot it is about; null for one about the slide's background. */
  slot: SlotId | null;
}

/**
 * Every issue a design has that can be found without rendering it.
 *
 * `mediaExists` says whether a media id still points at something: the API
 * answers from the workspace's library, the editor from the pictures it has
 * loaded. A logo slot that shows the brand kit's logo is checked against the
 * kit's logo too.
 */
export function findDesignIssues(
  document: DesignDocument,
  mediaExists: (mediaId: string) => boolean,
): DesignIssue[] {
  const issues: DesignIssue[] = [];

  for (const [slideIndex, slide] of document.slides.entries()) {
    const layout = findLayout(slide.layoutId);
    if (!layout) continue;

    if (slide.background.kind === 'media') {
      if (!mediaExists(slide.background.mediaId)) {
        issues.push({ kind: 'missingPicture', slideIndex, slot: null });
      } else if (photoNeedsDarkening(slide)) {
        issues.push({ kind: 'photoTooLight', slideIndex, slot: null });
      }
    }

    for (const slot of layout.slots) {
      const state = slide.elements[slot.id];
      if (state?.hidden) continue;

      if (slot.kind === 'image') {
        const mediaId = state?.mediaId ?? null;
        if (!mediaId) issues.push({ kind: 'emptyPicture', slideIndex, slot: slot.id });
        else if (!mediaExists(mediaId))
          issues.push({ kind: 'missingPicture', slideIndex, slot: slot.id });
        continue;
      }

      if (slot.kind === 'logo') {
        const mediaId = state?.mediaId ?? document.brand.logoMediaId;
        if (mediaId && !mediaExists(mediaId)) {
          issues.push({ kind: 'missingPicture', slideIndex, slot: slot.id });
        }
        continue;
      }

      const shown =
        slot.kind === 'list'
          ? (state?.items ?? []).some((item) => item.trim() !== '')
          : slotText(document, slideIndex, slot).trim() !== '';
      if (!shown) continue;

      const ink = inkOf(document, slide, slot.id);
      if (ink && !ink.readable) issues.push({ kind: 'unreadable', slideIndex, slot: slot.id });
    }
  }

  return issues;
}

/**
 * The sentence for an issue, naming the slide by the number the user sees
 * and the element by its panel name.
 */
export function issueMessage(document: DesignDocument, issue: DesignIssue): string {
  const slide = `Slide ${issue.slideIndex + 1}`;
  const layout = findLayout(document.slides[issue.slideIndex]?.layoutId ?? '');
  const label = issue.slot
    ? (layout?.slots.find((slot) => slot.id === issue.slot)?.label ?? 'text').toLowerCase()
    : null;

  switch (issue.kind) {
    case 'overflow':
      return `${slide}: the ${label ?? 'text'} is too long for its space.`;
    case 'unreadable':
      return `${slide}: the ${label ?? 'text'} is hard to read on its background.`;
    case 'emptyPicture':
      return `${slide}: the ${label ?? 'picture'} is empty.`;
    case 'missingPicture':
      return label
        ? `${slide}: the ${label} was deleted.`
        : `${slide}: the background photo was deleted.`;
    case 'photoTooLight':
      return `${slide}: text may be hard to read on the photo.`;
  }
}
