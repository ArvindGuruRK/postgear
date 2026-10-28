/**
 * The Slide tab's photo controls (Sprint 9b): the tint, and one photo for
 * every slide.
 *
 * A photo behind a slide is always overlaid so its text reads. The dark tint
 * (Sprint 9's only one) lays the overlay in black under light text; the
 * light tint lays it in white under dark text. The engine picks the inks
 * from the tint (`paletteForSlide`), and the overlay strength that makes
 * either readable on any photo is the same `SAFE_PHOTO_OVERLAY`, so the
 * slider and its warning only change their words.
 */
import {
  applyPhotoToAllSlides,
  type DesignDocument,
  type PhotoTint,
  type SlideBackground,
  setBackground,
} from '@postgear/design-engine';
import { findSlide } from './editor-panel-model';

export const TINT_OPTIONS: readonly { value: PhotoTint; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/** A photo's tint. No tint is the dark one, as every Sprint 9 photo was. */
export function tintOf(background: SlideBackground): PhotoTint {
  return background.kind === 'media' ? (background.tint ?? 'dark') : 'dark';
}

/** The slide's photo under the other tint. Only a photo has one. */
export function withTint(
  document: DesignDocument,
  slideId: string,
  tint: PhotoTint,
): DesignDocument {
  const background = findSlide(document, slideId)?.slide.background;
  if (background?.kind !== 'media' || tintOf(background) === tint) return document;

  return setBackground(document, slideId, { ...background, tint });
}

/** What the overlay controls say under each tint. */
export interface TintWords {
  /** The slider's name. */
  strength: string;
  /** The warning below the safe strength. */
  warning: (safePercent: number) => string;
  /** The warning's button, which raises the overlay to the safe strength. */
  fix: string;
}

export function tintWords(tint: PhotoTint): TintWords {
  return tint === 'light'
    ? {
        strength: 'Lightening',
        warning: (safe) =>
          `Dark text can be hard to read on a dark photo. Lighten it to at least ${safe}%.`,
        fix: 'Lighten Photo',
      }
    : {
        strength: 'Darkening',
        warning: (safe) =>
          `White text can be hard to read on a light photo. Darken it to at least ${safe}%.`,
        fix: 'Darken Photo',
      };
}

/**
 * Whether Apply To All Slides has work to do: another slide without exactly
 * this photo, overlay and tint. Asked of the engine's own operation, which
 * hands back the same design when it would change nothing.
 */
export function canApplyPhotoToAll(document: DesignDocument, slideId: string): boolean {
  return document.slides.length > 1 && applyPhotoToAllSlides(document, slideId) !== document;
}
