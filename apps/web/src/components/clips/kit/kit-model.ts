/**
 * Recipes And Brand Kit (Sprint 13, Module 10): the kit page's copy and the
 * small rules it follows, kept pure so they are tested on their own.
 *
 * - The open tab lives in `?tab=` (`recipes`, the default and left out of
 *   the address, or `brand-kit`), like the Clips page's own views.
 * - An intro or outro video is checked in the browser before a byte is sent:
 *   a video file we read, at most 50 MB and at most 5 seconds (the API checks
 *   the real video again once it is in).
 */
import {
  BRAND_VIDEO_MAX_BYTES,
  BRAND_VIDEO_MAX_MS,
  LOGO_POSITIONS,
  type LogoPosition,
  RECIPE_NAME_MAX,
} from '@postgear/video-engine';
import { UPLOAD_NOT_VIDEO, uploadTypeOf } from '../home/home-model';

export const KIT_TABS = ['recipes', 'brand-kit'] as const;
export type KitTab = (typeof KIT_TABS)[number];
export const DEFAULT_KIT_TAB: KitTab = 'recipes';

export const KIT_TAB_NAMES: Record<KitTab, string> = {
  recipes: 'Recipes',
  'brand-kit': 'Brand Kit',
};

/** The tab a `?tab=` value names, or Recipes for anything else. */
export function kitTabFrom(value: string | string[] | undefined | null): KitTab {
  return typeof value === 'string' && (KIT_TABS as readonly string[]).includes(value)
    ? (value as KitTab)
    : DEFAULT_KIT_TAB;
}

export function kitHref(orgId: string, tab: KitTab = DEFAULT_KIT_TAB): string {
  const base = `/${encodeURIComponent(orgId)}/clips/kit`;
  return tab === DEFAULT_KIT_TAB ? base : `${base}?tab=${tab}`;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export { RECIPE_NAME_MAX };

export const RECIPES_FAILED = 'We could not load your recipes. Try again.';
export const NO_RECIPES_SENTENCE = 'No recipes yet.';
export const NO_RECIPES_HELP =
  "Set a clip up the way you like, then save it as a recipe from the editor's menu.";
export const RECIPE_NAME_EMPTY = 'Enter a name for the recipe.';
export const RECIPE_ACTION_FAILED = 'That did not work. Try again.';

/** "3 of 50 recipes". */
export function recipeCountLine(own: number, max: number): string {
  return `${own} of ${max} ${max === 1 ? 'recipe' : 'recipes'}`;
}

export function deleteRecipeSentence(name: string): string {
  return `Delete "${name}"? Clips already made with it keep their edits.`;
}

/** "Made by Priya", or null when nobody is named (a member who left). */
export function madeByLine(name: string | null): string | null {
  return name ? `Made by ${name}` : null;
}

/** A name as it will be saved: one line, trimmed, at most 60 characters. */
export function cleanRecipeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, RECIPE_NAME_MAX);
}

// ---------------------------------------------------------------------------
// Brand Kit
// ---------------------------------------------------------------------------

export const KITS_FAILED = 'We could not load your brand kits. Try again.';
export const NO_KITS_SENTENCE = 'No brand kits yet.';
export const NO_KITS_HELP =
  'Make a brand kit in Design Studio, then come back to set its logo, intro and outro for clips.';
export const NO_LOGO_NOTE = 'This kit has no logo. Add one in Design Studio.';
export const KIT_SAVED = 'Brand kit saved.';
export const OUTRO_LINE_MAX = 80;
export const OUTRO_CARD_NOTE = "A 2 second card in the kit's colours, with its logo and your line.";
export const OUTRO_VIDEO_NOTE = 'A short video played after the clip.';
export const INTRO_NOTE = 'A short video played before the clip.';
export const BRAND_VIDEO_WAITING = 'Getting your video ready';
export const BRAND_VIDEO_FAILED = 'We could not read that video. Try another file.';

/** The Segmented's value: a corner, or Off. */
export type LogoChoice = LogoPosition | 'off';

export const LOGO_CHOICES: ReadonlyArray<{ value: LogoChoice; label: string }> = [
  { value: 'off', label: 'Off' },
  ...LOGO_POSITIONS.map((position) => ({ value: position, label: logoPositionName(position) })),
];

/** "Top Left". */
export function logoPositionName(position: LogoPosition): string {
  return position
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const BRAND_VIDEO_MAX_SECONDS = Math.round(BRAND_VIDEO_MAX_MS / 1000);

/** "3 seconds", "4.5 seconds". */
export function secondsWords(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100) / 10;
  const text = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
  return `${text} ${tenths === 1 ? 'second' : 'seconds'}`;
}

/** "60 MB", counted the way the 50 MB limit is (1,048,576 bytes a megabyte). */
function megabytes(bytes: number, round: (value: number) => number = Math.round): string {
  return `${Math.max(1, round(bytes / (1024 * 1024))).toLocaleString('en-GB')} MB`;
}

export function brandVideoTooBig(bytes: number): string {
  // Rounded up, so a file just over the limit never reads as the limit itself.
  return `This video is ${megabytes(bytes, Math.ceil)}. An intro or outro can be at most ${megabytes(BRAND_VIDEO_MAX_BYTES)}.`;
}

export function brandVideoTooLong(ms: number): string {
  return `This video is ${secondsWords(ms)} long. An intro or outro can be at most ${BRAND_VIDEO_MAX_SECONDS} seconds.`;
}

/** Why a file cannot be an intro or outro, before anything is read, or null. */
export function brandFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!uploadTypeOf(file) || file.size <= 0) return UPLOAD_NOT_VIDEO;
  if (file.size > BRAND_VIDEO_MAX_BYTES) return brandVideoTooBig(file.size);
  return null;
}

/** Why a length is too long, or null (an unknown length goes through: the API checks it again). */
export function brandLengthProblem(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  return durationMs > BRAND_VIDEO_MAX_MS ? brandVideoTooLong(durationMs) : null;
}

/** A closing line as it will be saved: one line, trimmed, at most 80 characters; empty is null. */
export function cleanOutroLine(value: string): string | null {
  const line = value.replace(/\s+/g, ' ').trim().slice(0, OUTRO_LINE_MAX);
  return line.length > 0 ? line : null;
}
