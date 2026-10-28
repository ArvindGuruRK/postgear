/**
 * Premium looks in the editor (Sprint 9b, section 9), kept pure so they are
 * tested without a browser: which theme and art tiles wear the lock, and
 * which save the API will refuse.
 *
 * The API is the authority (`studio.premium.ts`): in a workspace whose plan
 * does not include premium looks it refuses a save that changes a design's
 * theme or art *to* a premium one, and lets a design that already had the
 * look keep saving. These functions say the same thing on the web side, so
 * the panel locks what the API would refuse and the autosave holds a refused
 * change instead of sending it again.
 */
import { artById, type DesignDocument, isThemeId, themeById } from '@postgear/design-engine';

/** True for a theme locked to paid plans. An id the library does not have is not one. */
export function isPremiumTheme(themeId: string): boolean {
  return isThemeId(themeId) && themeById(themeId).premium === true;
}

/** True for background art locked to paid plans. None, and an id the library does not have, are not. */
export function isPremiumArt(artId: string | null): boolean {
  return artById(artId)?.premium === true;
}

/**
 * Whether choosing a look opens the lock dialog instead of applying it: a
 * premium theme or art style, in a workspace whose plan is known not to
 * include them. `premium` is null until that is known, and then nothing is
 * locked (the API still refuses what it does not allow). The look the design
 * is on is never locked, because a design keeps a premium look it already
 * had after a downgrade.
 */
export function isLookLocked(
  premium: boolean | null,
  look: { premium?: boolean },
  current: boolean,
): boolean {
  return premium === false && look.premium === true && !current;
}

/**
 * True when `screen` brings in a premium theme or art that `saved` does not
 * have: the save the API refuses in a workspace without a paid plan (the
 * same rule as `premiumLookAdded` in the API's `studio.premium.ts`).
 */
export function addsPremiumLook(
  saved: Pick<DesignDocument, 'themeId' | 'art'>,
  screen: Pick<DesignDocument, 'themeId' | 'art'>,
): boolean {
  const theme = screen.themeId !== saved.themeId && isPremiumTheme(screen.themeId);
  const art = screen.art !== saved.art && isPremiumArt(screen.art);
  return theme || art;
}

/** A tile's accessible name: its own, with ", locked" while choosing it opens the lock dialog. */
export function lookTileName(name: string, locked: boolean): string {
  return locked ? `${name}, locked` : name;
}
