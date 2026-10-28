/**
 * What Sprint 9b adds to a brand kit, as the kit dialog edits it: the kit's
 * heading and body fonts, Lock Brand Look, and the call to action a new
 * design's closing slide starts with.
 *
 * Kept beside the Sprint 9 form (`BrandKitDraft` in `studio-view-model.ts`)
 * and spread into the same request body. The limits and the link rule are
 * the API's own (`studio.schema.ts`, `brand-kits.service.ts`), checked here
 * first so the dialog can say what is wrong at the field, where the API
 * could only answer the whole form.
 */
import { FONT_IDS, type FontId } from '@postgear/design-engine';
import type { BrandKitView } from '@/types/studio';

/** The closing layouts give a call to action about 36 characters before its text starts to shrink. */
export const MAX_CTA_TEXT_LENGTH = 60;
/** Shown on the slide as text under the call to action, never followed. */
export const MAX_CTA_URL_LENGTH = 60;
export const CTA_URL_ERROR = 'Enter the link without spaces, like yourbrand.com/offer.';

/** What Lock Brand Look does, in one sentence beside its switch. */
export const LOCK_LOOK_NOTE = "Designs that use this kit can't change its colours, logo or fonts.";

/** These fields as a kit has them, and as the request body (`BrandKitBody`) sends them. */
export type KitExtras = Pick<
  BrandKitView,
  'headingFont' | 'bodyFont' | 'lockLook' | 'ctaText' | 'ctaUrl'
>;

/** The fields as the form holds them: the call to action as typed. */
export interface KitExtrasDraft {
  headingFont: FontId | null;
  bodyFont: FontId | null;
  lockLook: boolean;
  ctaText: string;
  ctaUrl: string;
}

/** A font the library has, or null: a family removed since the kit was saved falls back to the theme's. */
function knownFont(id: string | null | undefined): FontId | null {
  return id && (FONT_IDS as readonly string[]).includes(id) ? (id as FontId) : null;
}

/** The form for a kit, or for a new one (no fonts, unlocked, no call to action). */
export function extrasDraft(kit: BrandKitView | null): KitExtrasDraft {
  return {
    headingFont: knownFont(kit?.headingFont),
    bodyFont: knownFont(kit?.bodyFont),
    lockLook: kit?.lockLook ?? false,
    ctaText: kit?.ctaText ?? '',
    ctaUrl: kit?.ctaUrl ?? '',
  };
}

/** The link's problem, in the API's words: it must be one word. Empty is fine; it is optional. */
export function ctaUrlProblem(value: string): string | null {
  return /\s/.test(value.trim()) ? CTA_URL_ERROR : null;
}

/** What is saved: the call to action on one line, empty fields as null. */
export function extrasBody(draft: KitExtrasDraft): KitExtras {
  return {
    headingFont: draft.headingFont,
    bodyFont: draft.bodyFont,
    lockLook: draft.lockLook,
    ctaText: draft.ctaText.replace(/\s+/g, ' ').trim().slice(0, MAX_CTA_TEXT_LENGTH) || null,
    ctaUrl: draft.ctaUrl.trim().slice(0, MAX_CTA_URL_LENGTH) || null,
  };
}
