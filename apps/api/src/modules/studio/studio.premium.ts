/**
 * Premium looks (Sprint 9b): which looks a workspace may start from, and the
 * one refusal when it may not.
 *
 * The luxury collection, its themes and art, and the hand-made originals are
 * premium (`isPresetPremium`, `Theme.premium`, `ArtStyle.premium` in the
 * engine say which). A workspace on any paid tier, a trial included, may use
 * them: the same `resolveEntitlement` rule premium appearance themes follow,
 * but per workspace, because a design belongs to the workspace rather than
 * to the person editing it.
 *
 * ## What is gated, and what never is
 *
 * Only *starting from* a premium look is refused: creating a design from a
 * premium template, or a save that changes a design's theme or art *to* a
 * premium one. A design that already has a premium look (made while the plan
 * was live) keeps saving after a downgrade, edits and all, and can still be
 * exported, sent and duplicated. A downgrade never takes work away; it only
 * stops new premium work from starting.
 *
 * The refusal mirrors `PremiumThemeRequiredException` in
 * `users/appearance.controller.ts`: a 402 whose `code` the exception filter
 * passes through to the web app's `ApiError.code`, so the editor and the
 * gallery open the lock dialog rather than showing an error.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { artById, type DesignDocument, themeById } from '@postgear/design-engine';
import { STUDIO_MESSAGES } from './studio.messages';

export const PREMIUM_LOOK_REQUIRED_CODE = 'premium_look_requires_plan';

/** A 402 with a machine-readable code; the exception filter passes `code` through. */
export class PremiumLookRequiredException extends HttpException {
  constructor() {
    super(
      { message: STUDIO_MESSAGES.PREMIUM_LOCKED, code: PREMIUM_LOOK_REQUIRED_CODE },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Whether a document draws with a premium theme or premium art. An id the
 * library no longer has is not premium: `themeById` falls back to the
 * default theme, and the renderer draws no art for an unknown one.
 */
export function hasPremiumLook(document: DesignDocument): boolean {
  return themeById(document.themeId).premium === true || artById(document.art)?.premium === true;
}

/**
 * Whether a save brings in a premium look the stored design did not have:
 * its theme changes to a premium one, or its art does. `before` is null when
 * the stored document cannot be read by this version, and then everything in
 * `after` counts as new.
 */
export function premiumLookAdded(before: DesignDocument | null, after: DesignDocument): boolean {
  const themeAdded = after.themeId !== before?.themeId && themeById(after.themeId).premium === true;
  const artAdded = after.art !== (before?.art ?? null) && artById(after.art)?.premium === true;

  return themeAdded || artAdded;
}
