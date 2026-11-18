/**
 * `openpeeps`: Open Peeps by Pablo Stanley, the CC0 download unzipped by the
 * operator ("even for commercial purposes, without asking permission",
 * openpeeps.com). Only its PNG pictures are read; a licence file in the
 * download that does not say CC0 refuses it.
 */
import { LibraryError, type StickerAdapter } from '../types';
import { licenceText, nameFromFile, pictureFiles, readInside } from './files';
import { saysCc0 } from './kenney';

const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';
export const OPEN_PEEPS_URL = 'https://www.openpeeps.com';

export function openPeepsAdapter(folder: string): StickerAdapter {
  return {
    origin: 'openpeeps',
    source: {
      code: 'openpeeps',
      name: 'Open Peeps',
      author: 'Pablo Stanley',
      url: OPEN_PEEPS_URL,
      licence: 'CC0-1.0',
      licenceUrl: CC0_URL,
      creditLine: 'People drawings: Open Peeps by Pablo Stanley (openpeeps.com), CC0.',
      changeNote: 'Resized',
      noticeText: null,
      requiresCredit: false,
      creditPerItem: false,
    },
    async candidates() {
      const licence = licenceText(folder);
      if (licence !== null && !saysCc0(licence)) {
        throw new LibraryError(
          'The download has a licence file that does not say CC0, so it is refused.',
        );
      }
      return pictureFiles(folder)
        .filter((file) => /\.png$/i.test(file))
        .map((file) => {
          const name = `${nameFromFile(file, ['peep', 'peeps', 'open'])} Person`.trim();
          return {
            name,
            tags: [
              'people',
              'person',
              'character',
              ...name
                .toLowerCase()
                .split(' ')
                .filter((word) => word.length > 1),
            ],
            category: 'reactions',
            creator: 'Pablo Stanley',
            creatorUrl: OPEN_PEEPS_URL,
            licenceRaw: 'CC0',
            licenceUrl: CC0_URL,
            sourceUrl: OPEN_PEEPS_URL,
            originId: file,
            path: file,
            mature: false,
            emojiLike: false,
            originalWork: true,
          };
        });
    },
    async read(candidate, maxBytes) {
      return readInside(folder, candidate.path as string, maxBytes);
    },
  };
}
