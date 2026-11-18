/**
 * `kenney` for sounds: one of Kenney's audio packs (Impact Sounds, Interface
 * Sounds, UI Audio, Sci-fi Sounds, Digital Audio, RPG Audio, Casino Audio,
 * Music Jingles, the Voiceover Pack), unzipped by the operator from the pack
 * page by hand, never crawled. The pack's own `License.txt` must say CC0, or
 * the whole pack is refused (Module 14). The pack's name is a strong
 * category hint; music too short for music becomes a Reactions effect.
 */
import * as path from 'node:path';
import { kenneyPackHint } from '../sound-taxonomy';
import { LibraryError, type SoundAdapter } from '../types';
import { licenceText, readInside, soundFiles, soundNameFromFile } from './files';
import { saysCc0 } from './kenney';

const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

/**
 * Kenney's file words that read better spelled out, or that name a console
 * for a style (Music Jingles' "NES" set is chiptune Kenney made, so it keeps
 * the style and drops the brand).
 */
const WORD_NAMES: Readonly<Record<string, string>> = {
  nes: 'Chiptune',
  snes: 'Chiptune',
  pizzi: 'Pizzicato',
  sfx: 'Effect',
};

/** The file's name with Kenney's words spelled out. */
export function kenneySoundName(file: string): string {
  return soundNameFromFile(file)
    .split(' ')
    .map((word) => WORD_NAMES[word.toLowerCase()] ?? word)
    .join(' ');
}

export interface KenneySoundsOptions {
  /** The pack page the operator downloaded it from; by default made from the folder's name. */
  packUrl?: string;
  /** The pack's name for the credits ("Kenney Impact Sounds"); by default made from the folder's name. */
  packName?: string;
  /** The category every sound goes in, when the pack's name does not say. */
  category?: string;
}

/** `kenney_impact-sounds` or `impact-sounds` to `impact-sounds`. */
export function kenneyPackSlug(folder: string): string {
  return path
    .basename(path.resolve(folder))
    .toLowerCase()
    .replace(/^kenney[_-]?/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleOf(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => (word === 'ui' ? 'UI' : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

export function kenneySoundsAdapter(
  folder: string,
  options: KenneySoundsOptions = {},
): SoundAdapter {
  const slug = kenneyPackSlug(folder);
  if (!slug) throw new LibraryError('The Kenney pack folder needs a name, like impact-sounds');
  const packUrl = options.packUrl ?? `https://kenney.nl/assets/${slug}`;
  const packName = options.packName ?? `Kenney ${titleOf(slug)}`;
  const hint = kenneyPackHint(packName);
  return {
    origin: 'kenney',
    source: {
      code: `kenney-${slug}`,
      name: packName,
      author: 'Kenney',
      url: packUrl,
      licence: 'CC0-1.0',
      licenceUrl: CC0_URL,
      creditLine: `${packName}: Kenney (kenney.nl), CC0.`,
      changeNote: 'Trimmed, levelled and converted to AAC',
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
      return soundFiles(folder)
        .filter((file) => !/(?:^|\/)(?:preview|sample|demo|logo)[^/]*$/i.test(file))
        .map((file) => {
          const name = kenneySoundName(file);
          const folders = file
            .split('/')
            .slice(0, -1)
            .map((part) => part.toLowerCase())
            .filter((part) => !['audio', 'sounds', 'ogg', 'wav', 'mp3'].includes(part));
          const words = name
            .toLowerCase()
            .split(' ')
            .filter((word) => word.length > 1 && !/^\d+$/.test(word));
          return {
            name,
            tags: [...new Set([...words, ...folders])],
            category: options.category ?? hint?.category,
            categoryWords: [...folders, ...(hint?.words ?? [])],
            kindHint: hint?.kind,
            shortCategory: hint?.shortCategory,
            creator: 'Kenney',
            creatorUrl: 'https://kenney.nl',
            licenceRaw: 'CC0 1.0',
            licenceUrl: CC0_URL,
            sourceUrl: packUrl,
            originId: `${slug}/${file}`,
            path: file,
            mature: false,
            originalWork: true,
          };
        });
    },
    async read(candidate, maxBytes) {
      return readInside(folder, candidate.path as string, maxBytes);
    },
  };
}
