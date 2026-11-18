/**
 * The shared library's ingest (Modules 12 and 14): the shapes every source
 * adapter returns and the engines work with. Stickers and sounds share the
 * candidate, the source, the run, the report and the deny list; each has
 * its own licence allow-list, guard, adapters and engine.
 *
 * The ingest is an operator's command, never a user's (README rules): items
 * come in through it with the licence guard, and nothing a user uploads ever
 * enters the shared catalogue.
 */

/** The sticker categories (slugs) and their names are the engine's, shared with the API and the web. */
export { STICKER_CATEGORIES, type StickerCategory } from '@postgear/video-engine';

/** The licences a sticker may have (SPDX ids, plus OWN for PostGear's own art). */
export const ALLOWED_STICKER_LICENCES = [
  'OWN',
  'CC0-1.0',
  'PDM-1.0',
  'CC-BY-4.0',
  'MIT',
  'Apache-2.0',
] as const;
export type StickerLicence = (typeof ALLOWED_STICKER_LICENCES)[number];

/** Why a candidate was turned away (research 10 section 8.2), each counted in the report. */
export const REJECTION_REASONS = [
  'licence_not_allowed',
  'licence_url_mismatch',
  'missing_metadata',
  'mature',
  'brand_name',
  'derivative_signal',
  'no_category',
  'duplicate',
  'denied',
  'not_a_picture',
  'unusable',
  'too_large',
  'fetch_failed',
  // Sounds (Module 14).
  'not_a_sound',
  'too_short',
  'too_long',
  /** The source does not show it is an original work: reported for a person to look at, never added. */
  'needs_review',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** One item a source offers, before any check. */
export interface LibraryCandidate {
  name: string;
  tags: string[];
  /** A category slug the source gives, or words the taxonomy maps. */
  category?: string;
  /** Extra words for the taxonomy (a source's own categories). */
  categoryWords?: string[];
  creator: string;
  creatorUrl: string | null;
  /** The licence exactly as the source states it. */
  licenceRaw: string;
  /** The licence's own page, as the source links it; null only for OWN. */
  licenceUrl: string | null;
  /** The item's own page (for OWN, a stable `own://` name). */
  sourceUrl: string;
  /** The source's own id for the item; with the origin, unique. */
  originId: string;
  /** Where the bytes are: a URL fetched through the safe fetch, or a file inside the source folder. */
  downloadUrl?: string;
  path?: string;
  mature: boolean;
  /** Emoji-like art is normalised to 256 px, the rest to 512. */
  emojiLike?: boolean;
  /** The source judged this an original work (not a copy of someone else's). */
  originalWork: boolean;
  /** Sounds: the source's description, read for derivative signals too. */
  description?: string;
  /** Sounds: what the source says it is (music or an effect), when it says. */
  kindHint?: 'sfx' | 'music';
  /** Sounds: beats a minute, when the source says. */
  bpm?: number | null;
  /** Sounds: the effect category a music candidate takes when it is too short for music (Kenney's jingles). */
  shortCategory?: string;
}

/** The collection a source's items share a credit with (one `ClipLibrarySource` row). */
export interface LibrarySourceMeta {
  code: string;
  name: string;
  author: string;
  url: string;
  licence: StickerLicence;
  licenceUrl: string;
  creditLine: string | null;
  changeNote: string | null;
  noticeText: string | null;
  requiresCredit: boolean;
  creditPerItem: boolean;
}

/** The origins that may publish without a review (`--auto-publish`); an open aggregator never may. */
export const AUTO_PUBLISH_ORIGINS = ['own', 'kenney', 'noto'] as const;

/** One source of stickers. Its fetch is injected; nothing here reaches the network on its own. */
export interface StickerAdapter {
  /** `own`, `kenney`, `openpeeps`, `noto`. */
  origin: string;
  source: LibrarySourceMeta;
  /** Every candidate the source offers. Throws a `LibraryError` when the source itself is refused (a pack that is not CC0). */
  candidates(): Promise<LibraryCandidate[]>;
  /** The candidate's bytes, at most `maxBytes`. */
  read(candidate: LibraryCandidate, maxBytes: number): Promise<Buffer>;
}

/** A download, injected (the worker binds `fetchBinarySafely`; tests bind recorded files). */
export type FetchBinary = (
  url: string,
  options: { maxBytes: number; timeoutMs: number },
) => Promise<Buffer>;

/** The ingest refused to start, or refused a whole source. The message is for the operator's console. */
export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

// --- Sounds (Module 14) ---------------------------------------------------------

/** The sound categories and their names are the engine's, shared with the API and the web. */
export {
  isSoundCategory,
  SOUND_CATEGORIES,
  type SoundCategory,
  type SoundKind,
  soundKindOfCategory,
} from '@postgear/video-engine';

/**
 * The licences a sound may have: our own, CC0 and the Public Domain Mark.
 * Never CC BY: a credit cannot ride along inside a sound in a finished video.
 */
export const ALLOWED_SOUND_LICENCES = ['OWN', 'CC0-1.0', 'PDM-1.0'] as const;
export type SoundLicence = (typeof ALLOWED_SOUND_LICENCES)[number];

/** The origins whose sounds may publish without a review (`--auto-publish`). */
export const AUTO_PUBLISH_SOUND_ORIGINS = ['own', 'kenney'] as const;

/** One source of sounds. Its fetch is injected; nothing here reaches the network on its own. */
export interface SoundAdapter {
  /** `own`, `kenney`, `opengameart`, `openverse`, `freesound`. */
  origin: string;
  source: LibrarySourceMeta;
  /** Every candidate the source offers. Throws a `LibraryError` when the source itself is refused. */
  candidates(): Promise<LibraryCandidate[]>;
  /** The candidate's bytes, at most `maxBytes`. */
  read(candidate: LibraryCandidate, maxBytes: number): Promise<Buffer>;
}
