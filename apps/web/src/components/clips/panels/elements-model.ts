/**
 * The Elements tab's words and pure helpers (Module 12 section 9): the
 * tabs, the sentences, which kind each tab lists, and the sticker files a
 * clip draws as the preview wants them.
 *
 * The UI never says file, asset or upload check: a person sees stickers,
 * GIFs, their own stickers, and "Checking".
 */
import {
  BADGE_NAME_MAX,
  BADGE_PLATFORM_LOOK,
  BADGE_PLATFORMS,
  type BadgePlatform,
  type ClipDocument,
  type LibraryStickerView,
  MAX_STICKERS,
  type StickerFileView,
  type StickerItem,
  type StickerKind,
  type StickerUploadView,
  stickerFilesNeeded,
  stickerRefKey,
} from '@postgear/video-engine';
import type { StickerPicture } from '@postgear/video-preview';

export type ElementsTab = 'stickers' | 'gifs' | 'favourites' | 'uploaded';

export const ELEMENTS_TABS: ReadonlyArray<{ value: ElementsTab; label: string }> = [
  { value: 'stickers', label: 'Stickers' },
  { value: 'gifs', label: 'GIFs' },
  { value: 'favourites', label: 'Favourites' },
  { value: 'uploaded', label: 'Uploaded' },
];

export function isElementsTab(value: string): value is ElementsTab {
  return ELEMENTS_TABS.some((tab) => tab.value === value);
}

/** Stickers lists still pictures, GIFs moving ones; Favourites and Uploaded hold both. */
export function kindOfTab(tab: ElementsTab): StickerKind | undefined {
  if (tab === 'stickers') return 'static';
  if (tab === 'gifs') return 'animated';
  return undefined;
}

/** How long typing rests before the search runs. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Tiles loaded at a time. */
export const STICKERS_PAGE = 24;

export const SEARCH_PLACEHOLDER = 'Enter your search';
export const FAVOURITES_EMPTY = 'No favourites yet. Star a sticker to keep it here.';
export const UPLOADS_EMPTY = 'No stickers of your own yet. Upload a PNG, GIF or WebP.';
export const REMOVED_STICKER = 'This sticker was removed from the library.';
export const UPLOAD_GONE = 'This sticker was deleted from your workspace.';
export const LOAD_FAILED = 'We could not load the stickers. Try again in a moment.';
export const CHECKING = 'Checking';
export const TOO_MANY_STICKERS = `A clip holds up to ${MAX_STICKERS} stickers. Remove one to add another.`;

/** The sentence for a search that found nothing. */
export function noMatchSentence(query: string): string {
  const shown = query.trim().replace(/\s+/g, ' ');
  return shown
    ? `Nothing found for "${shown}". Try another word or pick a category.`
    : 'Nothing here yet. Pick another category.';
}

/** "Follow On Twitch" and the rest, for the badge form's platform list. */
export const BADGE_CHOICES: ReadonlyArray<{ value: BadgePlatform; label: string }> =
  BADGE_PLATFORMS.map((platform) => ({
    value: platform,
    label: BADGE_PLATFORM_LOOK[platform].label,
  }));

export function isBadgePlatform(value: string): value is BadgePlatform {
  return (BADGE_PLATFORMS as readonly string[]).includes(value);
}

/** The badge form's name, as it goes on the clip: one line, trimmed, at most 30 characters. */
export function badgeNameOf(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it takes out.
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, BADGE_NAME_MAX)
  );
}

// --- What the preview draws ----------------------------------------------------------

/** One sticker file as the editor keeps it: what the preview draws, and what the panel shows. */
export interface StickerFileInfo {
  missing: boolean;
  /** Null when missing. */
  picture: StickerPicture | null;
  name: string | null;
  previewUrl: string | null;
}

export const MISSING_FILE: StickerFileInfo = Object.freeze({
  missing: true,
  picture: null,
  name: null,
  previewUrl: null,
});

/** The preview's picture for a sticker the API described (a lookup row, a tile, an upload). */
export function pictureOf(view: {
  kind: StickerKind | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  frames: number | null;
  fileUrl: string | null;
}): StickerPicture | null {
  if (!view.fileUrl || !view.kind || !view.width || !view.height) return null;
  const animated = view.kind === 'animated';
  return {
    fileUrl: view.fileUrl,
    animated,
    width: view.width,
    height: view.height,
    fps: animated ? view.fps : null,
    frames: animated ? view.frames : null,
  };
}

export function fileInfoOf(file: StickerFileView): StickerFileInfo {
  if (file.missing) return MISSING_FILE;
  return {
    missing: false,
    picture: pictureOf(file),
    name: file.name,
    previewUrl: file.previewUrl,
  };
}

/** What a tile already says about its file, so a sticker shows the moment it is added. */
export function tileFileInfo(view: LibraryStickerView | StickerUploadView): StickerFileInfo {
  return {
    missing: false,
    picture: pictureOf(view),
    name: view.name,
    previewUrl: view.previewUrl,
  };
}

/** The key a tile's sticker is drawn by (`library:<id>` or `asset:<id>`). */
export function tileKey(
  view: LibraryStickerView | StickerUploadView,
  from: 'library' | 'upload',
): string {
  return from === 'library' ? `library:${view.id}` : `asset:${view.id}`;
}

/** The sticker files the clip uses that the editor does not know yet. */
export function unknownFiles(
  doc: Pick<ClipDocument, 'tracks'>,
  known: ReadonlyMap<string, StickerFileInfo>,
): { library: string[]; asset: string[] } {
  const library: string[] = [];
  const asset: string[] = [];
  for (const ref of stickerFilesNeeded(doc)) {
    if (known.has(ref.key)) continue;
    if ('library' in ref) library.push(ref.library);
    else asset.push(ref.asset);
  }
  return { library, asset };
}

/** The pictures the preview draws, by key (missing ones are left out: they draw nothing). */
export function previewPictures(
  files: ReadonlyMap<string, StickerFileInfo>,
): Map<string, StickerPicture> {
  const pictures = new Map<string, StickerPicture>();
  for (const [key, info] of files) if (info.picture) pictures.set(key, info.picture);
  return pictures;
}

/** The selected sticker's file, as the editor knows it (null for the badge, or while unknown). */
export function fileOfItem(
  item: StickerItem,
  files: ReadonlyMap<string, StickerFileInfo>,
): StickerFileInfo | null {
  const key = stickerRefKey(item.ref);
  return key ? (files.get(key) ?? null) : null;
}

/** What the selected sticker's section is called: its picture's name, or the badge's. */
export function stickerTitle(item: StickerItem, file: StickerFileInfo | null): string {
  if ('badge' in item.ref) return 'Follow Badge';
  return file?.name?.trim() || 'Sticker';
}
