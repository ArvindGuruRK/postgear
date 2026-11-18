/**
 * `kenney`: one of Kenney's 2D packs (the Emotes Pack first), unzipped by
 * the operator from the pack page by hand, never crawled. The pack's own
 * `License.txt` must say CC0, or the whole pack is refused (research 10).
 * Kenney asks that its logo is not used on its own, so pictures named like
 * a logo or a preview of the pack are left out.
 */
import { plainWords } from '../brands';
import { LibraryError, type StickerAdapter } from '../types';
import { licenceText, nameFromFile, pictureFiles, readInside } from './files';

export const KENNEY_EMOTES_URL = 'https://kenney.nl/assets/emotes-pack';
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

/** Whether a pack's licence text grants CC0. */
export function saysCc0(text: string): boolean {
  const words = plainWords(text);
  return (
    words.includes(' cc0 ') ||
    words.includes(' creative commons zero ') ||
    words.includes(' publicdomain zero ')
  );
}

export interface KenneyOptions {
  /** The pack page the operator downloaded it from. */
  packUrl?: string;
  /** The pack's name for the credits ("Kenney Emotes Pack"). */
  packName?: string;
  /** The category every picture goes in, when the pack's words do not say. */
  category?: string;
}

export function kenneyAdapter(folder: string, options: KenneyOptions = {}): StickerAdapter {
  const packUrl = options.packUrl ?? KENNEY_EMOTES_URL;
  const slug = packUrl.replace(/\/+$/, '').split('/').pop() ?? 'pack';
  return {
    origin: 'kenney',
    source: {
      code: `kenney-${slug}`,
      name: options.packName ?? 'Kenney Emotes Pack',
      author: 'Kenney',
      url: packUrl,
      licence: 'CC0-1.0',
      licenceUrl: CC0_URL,
      creditLine: `${options.packName ?? 'Emotes'}: Kenney (kenney.nl), CC0.`,
      changeNote: 'Resized',
      noticeText: null,
      requiresCredit: false,
      creditPerItem: false,
    },
    async candidates() {
      const licence = licenceText(folder);
      if (!licence || !saysCc0(licence)) {
        throw new LibraryError(
          "The pack's License.txt does not say CC0, so the whole pack is refused.",
        );
      }
      return pictureFiles(folder)
        .filter((file) => !/(?:^|\/)(?:preview|sample|logo|cover)[^/]*$/i.test(file))
        .map((file) => {
          const name = nameFromFile(file, ['emote', 'emotes']);
          const folders = file.split('/').slice(0, -1);
          return {
            name,
            tags: [
              ...new Set([
                ...name.toLowerCase().split(' '),
                ...folders.map((part) => part.toLowerCase()),
              ]),
            ].filter((word) => word.length > 1),
            category: options.category,
            categoryWords: ['emote', ...folders],
            creator: 'Kenney',
            creatorUrl: 'https://kenney.nl',
            licenceRaw: 'CC0 1.0',
            licenceUrl: CC0_URL,
            sourceUrl: packUrl,
            originId: `${slug}/${file}`,
            path: file,
            mature: false,
            emojiLike: true,
            originalWork: true,
          };
        });
    },
    async read(candidate, maxBytes) {
      return readInside(folder, candidate.path as string, maxBytes);
    },
  };
}
