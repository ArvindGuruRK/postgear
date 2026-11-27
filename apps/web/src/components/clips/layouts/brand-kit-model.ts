/**
 * The Layouts tab's Brand Kit section (Sprint 13, Module 10): its copy and
 * the parts a kit offers a clip, kept pure so they are tested on their own.
 */
import type { BrandParts, ClipBrandKit } from '@postgear/video-engine';

export const BRAND_KIT_NONE = 'none';
/** A kit the clip names that is no longer in the workspace's list. */
export const BRAND_KIT_GONE = '__gone';

export const BRAND_KITS_FAILED = 'We could not load your brand kits.';
export const NO_BRAND_KITS =
  'Make a brand kit in Design Studio to add your logo, intro and outro to clips.';
export const OUTRO_CARD_PREVIEW_NOTE = 'The closing card shows in Preview Export.';
export const BRAND_KIT_USE_FAILED = 'We could not use that brand kit. Try again.';

export type BrandToggle = 'logo' | 'intro' | 'outro';

export const BRAND_TOGGLE_NAMES: Readonly<Record<BrandToggle, string>> = {
  logo: 'Logo',
  intro: 'Intro',
  outro: 'Outro',
};

/** Which parts a kit has to give: a logo with a place, an intro, an outro. */
export function kitOffers(kit: ClipBrandKit): Record<BrandToggle, boolean> {
  return {
    logo: kit.logo !== null && kit.logoPosition !== null,
    intro: kit.intro !== null,
    outro: kit.outro !== null,
  };
}

/** The parts a freshly picked kit brings: everything it has, and its caption style. */
export function partsOnPick(kit: ClipBrandKit): BrandParts {
  return { ...kitOffers(kit), captions: true };
}

/** What a screen reader hears after a switch. */
export function brandToggleSentence(part: BrandToggle, on: boolean): string {
  return `${BRAND_TOGGLE_NAMES[part]} ${on ? 'on' : 'off'}.`;
}

/** "Card" or "Video", beside the Outro switch. */
export function outroKindName(kit: ClipBrandKit): string | null {
  if (!kit.outro) return null;
  return kit.outro.kind === 'card' ? 'Card' : 'Video';
}
