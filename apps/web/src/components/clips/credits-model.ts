/**
 * The Clips credits page's words (Module 12 section 9, sounds from Module
 * 14): the four groups' names, a licence's name, how many stickers and
 * sounds a source gave, and which addresses may be links. Our own art's and
 * sounds' sources have an `own://` address, which is never a link.
 */
import type { LibraryCreditGroup, LibraryCreditSource } from '@postgear/video-engine';

/** The groups' names; our own group is drawn with the wordmark, so it has no plain name here. */
export const CREDIT_GROUP_NAMES: Readonly<Record<Exclude<LibraryCreditGroup, 'own'>, string>> = {
  attribution: 'Attribution Required',
  notices: 'Notices',
  'public-domain': 'Public Domain And CC0',
};

export const CREDITS_INTRO =
  'Where the stickers and sounds in the Clips library come from, who made them, and the licence each is shared under.';
export const CREDITS_EMPTY = 'The Clips library is empty right now.';
export const CREDITS_FAILED = 'We could not load this page. Try again in a moment.';

/** An address a person may follow: http or https only. */
export function linkable(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** "CC-BY-4.0" as "CC BY 4.0"; our own art has no licence to name. */
export function licenceName(code: string): string | null {
  if (code === 'OWN') return null;
  return code.replace(/-/g, ' ');
}

/** "193 stickers", "1 sticker". */
export function stickerCount(count: number): string {
  return `${count} ${count === 1 ? 'sticker' : 'stickers'}`;
}

/** "92 sounds", "1 sound". */
export function soundCount(count: number): string {
  return `${count} ${count === 1 ? 'sound' : 'sounds'}`;
}

/** What a source gave: "193 stickers", "130 sounds", or "193 stickers and 92 sounds". */
export function sourceCounts(
  source: Pick<LibraryCreditSource, 'stickers'> & { sounds?: number },
): string {
  const sounds = source.sounds ?? 0;
  if (sounds > 0 && source.stickers > 0) {
    return `${stickerCount(source.stickers)} and ${soundCount(sounds)}`;
  }
  return sounds > 0 ? soundCount(sounds) : stickerCount(source.stickers);
}

/** The small line under a source's name: its maker and how many stickers and sounds it gave. */
export function sourceByline(
  source: Pick<LibraryCreditSource, 'author' | 'stickers'> & { sounds?: number },
): string {
  const author = source.author.trim();
  return author ? `By ${author}, ${sourceCounts(source)}` : sourceCounts(source);
}
