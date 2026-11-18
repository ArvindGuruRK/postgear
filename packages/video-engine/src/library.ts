/**
 * The shared sticker library as the API, the web and the worker see it
 * (Module 12): the five categories and their names, the credit groups of the
 * public credits page, and the shapes the library and upload routes answer.
 *
 * Module 14 adds the sounds beside the stickers: their fourteen categories
 * (eight for effects, six for music), the search answer, the workspace's
 * own sounds and the files a clip's sounds play from.
 */

/** The sticker categories, in the order the chips show them. */
export const STICKER_CATEGORIES = [
  'reactions',
  'arrows-shapes',
  'social',
  'gaming',
  'animated-emoji',
] as const;
export type StickerCategory = (typeof STICKER_CATEGORIES)[number];

export const STICKER_CATEGORY_NAMES: Readonly<Record<StickerCategory, string>> = Object.freeze({
  reactions: 'Reactions',
  'arrows-shapes': 'Arrows And Shapes',
  social: 'Social',
  gaming: 'Gaming',
  'animated-emoji': 'Animated Emoji',
});

export function isStickerCategory(value: unknown): value is StickerCategory {
  return typeof value === 'string' && (STICKER_CATEGORIES as readonly string[]).includes(value);
}

/** Still pictures are the Stickers tab, moving ones the GIFs tab. */
export const STICKER_KINDS = ['static', 'animated'] as const;
export type StickerKind = (typeof STICKER_KINDS)[number];

/** Results a page, at most. */
export const LIBRARY_PAGE_SIZE_MAX = 60;
export const LIBRARY_PAGE_SIZE_DEFAULT = 24;

/** The credit line one item carries, when its source needs one. */
export interface LibraryCredit {
  line: string;
  url: string;
}

/** One sticker in a search answer. */
export interface LibraryStickerView {
  id: string;
  name: string;
  kind: StickerKind;
  category: StickerCategory;
  tags: string[];
  width: number;
  height: number;
  /** Moving stickers only. */
  durationMs: number | null;
  fps: number | null;
  frames: number | null;
  /** The 128 px WebP for the grid (moving ones play it on hover). */
  previewUrl: string | null;
  /** The PNG or APNG the editor and the export draw. */
  fileUrl: string;
  isFavourite: boolean;
  credit: LibraryCredit | null;
}

export interface LibraryCategoryCount {
  slug: StickerCategory;
  name: string;
  count: number;
}

/** `GET /clips/library/stickers`. `suggest` is set only when a search found nothing. */
export interface LibrarySearchPage {
  items: LibraryStickerView[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  suggest?: LibraryCategoryCount[];
}

/** The four groups of the public credits page, in order. */
export const LIBRARY_CREDIT_GROUPS = ['attribution', 'notices', 'public-domain', 'own'] as const;
export type LibraryCreditGroup = (typeof LIBRARY_CREDIT_GROUPS)[number];

export interface LibraryCreditSource {
  name: string;
  author: string;
  url: string;
  licence: string;
  licenceUrl: string;
  creditLine: string | null;
  changeNote: string | null;
  noticeText: string | null;
  stickers: number;
  /** Sounds from this source in the catalogue (Module 14). */
  sounds: number;
}

/** `GET /clips/library/credits`: only sources with items in use, grouped. */
export interface LibraryCreditsView {
  groups: Array<{ group: LibraryCreditGroup; sources: LibraryCreditSource[] }>;
}

/** Which credit group a source belongs in. */
export function creditGroupFor(source: {
  licence: string;
  requiresCredit: boolean;
  noticeText: string | null;
}): LibraryCreditGroup {
  if (source.licence === 'OWN') return 'own';
  if (source.requiresCredit) return 'attribution';
  if (source.noticeText || source.licence === 'MIT' || source.licence === 'Apache-2.0') return 'notices';
  return 'public-domain';
}

/** One of the workspace's own stickers in the Uploaded tab. */
export interface StickerUploadView {
  id: string;
  name: string;
  status: 'checking' | 'ready' | 'failed';
  /** The sentence for a failed one. */
  error: string | null;
  kind: StickerKind | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  frames: number | null;
  /** Signed, six hours; null until it is ready. */
  previewUrl: string | null;
  fileUrl: string | null;
  createdAt: string;
}

/**
 * What the editor needs to draw a sticker a clip already has: its file and
 * facts, or `missing` (removed from the library, a deleted or failed upload).
 */
export type StickerFileView =
  | {
      key: string;
      missing: false;
      name: string;
      kind: StickerKind;
      width: number;
      height: number;
      durationMs: number | null;
      fps: number | null;
      frames: number | null;
      fileUrl: string;
      previewUrl: string | null;
      credit: LibraryCredit | null;
    }
  | { key: string; missing: true };

// --- Module 14: sounds ---------------------------------------------------------

/** Effects and music: the Sound Effects and Music tabs. */
export const SOUND_KINDS = ['sfx', 'music'] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

export function isSoundKind(value: unknown): value is SoundKind {
  return typeof value === 'string' && (SOUND_KINDS as readonly string[]).includes(value);
}

/** The effect categories, in the order the chips show them. */
export const SFX_CATEGORIES = [
  'alerts',
  'ambient',
  'reactions',
  'transitions',
  'gaming',
  'comedy',
  'impacts',
  'whooshes',
] as const;
/** The music categories, in the order the chips show them. */
export const MUSIC_CATEGORIES = ['calm', 'upbeat', 'tense', 'cinematic', 'lofi', 'epic'] as const;
/** Every sound category: an effect's slug never names a music one, and back (`reactions` and `gaming` are the effects'). */
export const SOUND_CATEGORIES = [...SFX_CATEGORIES, ...MUSIC_CATEGORIES] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];
export type MusicCategory = (typeof MUSIC_CATEGORIES)[number];
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

export const SOUND_CATEGORY_NAMES: Readonly<Record<SoundCategory, string>> = Object.freeze({
  alerts: 'Alerts And Notifications',
  ambient: 'Ambient Sounds',
  reactions: 'Reactions',
  transitions: 'Transitions',
  gaming: 'Gaming',
  comedy: 'Comedy',
  impacts: 'Impacts',
  whooshes: 'Whooshes',
  calm: 'Calm',
  upbeat: 'Upbeat',
  tense: 'Tense',
  cinematic: 'Cinematic',
  lofi: 'Lo-Fi',
  epic: 'Epic',
});

export function isSoundCategory(value: unknown): value is SoundCategory {
  return typeof value === 'string' && (SOUND_CATEGORIES as readonly string[]).includes(value);
}

/** The kind a category belongs to. */
export function soundKindOfCategory(category: SoundCategory): SoundKind {
  return (MUSIC_CATEGORIES as readonly string[]).includes(category) ? 'music' : 'sfx';
}

/** The categories of one kind. */
export function soundCategoriesOf(kind: SoundKind): readonly SoundCategory[] {
  return kind === 'music' ? MUSIC_CATEGORIES : SFX_CATEGORIES;
}

/** Waveform peaks a sound row and an uploaded sound carry: 100 values, 0 to 255. */
export const SOUND_PEAKS = 100;

/** Where a library sound came from, for its details line ("i"). */
export interface LibrarySoundDetails {
  /** The source collection's name, e.g. "PostGear Sounds" or "Kenney Impact Sounds". */
  source: string;
  author: string;
  /** The SPDX id (`CC0-1.0`, `PDM-1.0`) or `OWN`. */
  licence: string;
  licenceUrl: string;
  /** The item's own page (an `own://` name for ours). */
  sourceUrl: string;
}

/** One sound in a search answer. */
export interface LibrarySoundView {
  id: string;
  name: string;
  kind: SoundKind;
  category: SoundCategory;
  tags: string[];
  durationMs: number;
  bpm: number | null;
  /** The AAC `.m4a` the row plays, the Add button adds and the export mixes (public, cached a year). */
  previewUrl: string;
  /** `SOUND_PEAKS` values, 0 to 255. */
  peaks: number[];
  isFavourite: boolean;
  /** Always null: a sound that needs a credit is never in the catalogue. */
  credit: null;
  details: LibrarySoundDetails;
}

export interface SoundCategoryCount {
  slug: SoundCategory;
  name: string;
  count: number;
}

/** `GET /clips/library/sounds`. `suggest` is set only when a search found nothing. */
export interface LibrarySoundPage {
  items: LibrarySoundView[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  suggest?: SoundCategoryCount[];
}

/** One of the workspace's own sounds in the Uploaded tab (`GET /clips/sounds/uploads`). */
export interface SoundUploadView {
  id: string;
  name: string;
  status: 'checking' | 'ready' | 'failed';
  /** The sentence for a failed one. */
  error: string | null;
  durationMs: number | null;
  /** `SOUND_PEAKS` values once ready, else null. */
  peaks: number[] | null;
  /** Signed, six hours; null until it is ready. */
  fileUrl: string | null;
  createdAt: string;
}

/**
 * What the editor needs to play a sound a clip already has (`GET
 * /clips/sounds/files`): its file and facts, or `missing`. `removed` is true
 * only for a library sound taken out after a rights request, whose item says
 * "This sound was removed from the library."; a hidden one keeps playing.
 */
export type SoundFileView =
  | {
      key: string;
      missing: false;
      name: string;
      kind: SoundKind;
      durationMs: number;
      fileUrl: string;
      peaks: number[];
    }
  | { key: string; missing: true; removed: boolean };
