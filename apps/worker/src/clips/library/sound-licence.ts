/**
 * The sound guard (Module 14), run on a candidate's own words before
 * anything is downloaded. Sounds are stricter than stickers:
 *
 * - only `OWN`, `CC0-1.0` and `PDM-1.0`: a credit cannot ride along inside a
 *   sound in a finished video, so CC BY (and MIT, Apache) is refused;
 * - the brand list adds the words only a sound is refused for ("Windows 10
 *   Notification" is that company's sound);
 * - the derivative signals are music's (cover, remix, OST, "by <artist>");
 * - the original-work rule: an item the source does not show is an original
 *   work goes to the report as `needs_review` and never into the catalogue.
 */
import { brandIn, plainWords, soundBrands } from './brands';
import { licenceFor, licenceUrlMatches, MATURE_WORDS } from './licence';
import { soundCategoryFor, soundTags } from './sound-taxonomy';
import {
  ALLOWED_SOUND_LICENCES,
  type LibraryCandidate,
  type RejectionReason,
  type SoundCategory,
  type SoundKind,
  type SoundLicence,
  soundKindOfCategory,
} from './types';

/** Signs a sound copies someone else's work (Module 14 doc, step 2), as plain words. */
export const SOUND_DERIVATIVE_SIGNALS = [
  'cover',
  'covers',
  'remix',
  'remixed',
  'bootleg',
  'ripped from',
  'ripped by',
  'from the game',
  'from the movie',
  'from the film',
  'from the show',
  'from the series',
  'theme from',
  'theme song',
  'ost',
  'soundtrack',
  'sample from',
  'sampled from',
  'mashup',
  'mash up',
  'parody',
  'fan made',
  'fanmade',
  'fan art',
  'in the style of',
  'inspired by',
  'karaoke',
  'tribute',
  'soundalike',
  'sound alike',
  'ringtone',
  'official',
  'trademark',
] as const;

/** Words before "by" that make it a movement, not a credit ("Fly By", "Pass By"). */
const MOVEMENT_BY = new Set([
  'fly',
  'flew',
  'pass',
  'passing',
  'drive',
  'driving',
  'go',
  'stand',
  'swing',
  'zip',
  'rush',
  'roll',
  'run',
  'walk',
  'whoosh',
  'swoosh',
  'step',
  'side',
  'close',
  'near',
]);

/** "<title> by <Artist>" in a name: someone else's piece, named after its author. */
export function namesAnArtist(name: string): boolean {
  const words = name.split(/[^A-Za-z0-9']+/).filter(Boolean);
  for (let k = 1; k < words.length - 1; k += 1) {
    if ((words[k] as string).toLowerCase() !== 'by') continue;
    const before = (words[k - 1] as string).toLowerCase();
    const after = words[k + 1] as string;
    if (MOVEMENT_BY.has(before)) continue;
    if (['the', 'a', 'an', 'step', 'night', 'day'].includes(after.toLowerCase())) continue;
    if (/^[A-Z]/.test(after)) return true;
  }
  return false;
}

export interface SoundGuardOptions {
  /** The shared brand list (`loadBrands`); the sound-only words are added here. */
  brands: readonly string[];
}

export type SoundGuardResult =
  | {
      ok: true;
      licence: SoundLicence;
      category: SoundCategory;
      kind: SoundKind;
      tags: string[];
    }
  | { ok: false; reason: RejectionReason; detail: string };

/** Runs every check in order and returns the first reason that turns the candidate away. */
export function guardSoundCandidate(
  candidate: LibraryCandidate,
  options: SoundGuardOptions,
): SoundGuardResult {
  const no = (reason: RejectionReason, detail: string): SoundGuardResult => ({
    ok: false,
    reason,
    detail,
  });

  const stated = licenceFor(candidate.licenceRaw);
  if (!stated) return no('licence_not_allowed', candidate.licenceRaw || 'no licence');
  if (!(ALLOWED_SOUND_LICENCES as readonly string[]).includes(stated)) {
    return no('licence_not_allowed', `${stated} is not allowed for sounds`);
  }
  const licence = stated as SoundLicence;
  if (!licenceUrlMatches(licence, candidate.licenceUrl)) {
    return no('licence_url_mismatch', `${licence} links to ${candidate.licenceUrl ?? 'nothing'}`);
  }

  const name = candidate.name.trim();
  if (!name || !candidate.originId.trim() || !candidate.sourceUrl.trim()) {
    return no('missing_metadata', 'a name, an id and a page are needed');
  }
  if (licence !== 'OWN' && !candidate.creator.trim()) return no('missing_metadata', 'no creator');
  if (!candidate.downloadUrl && !candidate.path) return no('missing_metadata', 'no file');

  const texts = [name, ...candidate.tags, candidate.description ?? ''];
  const plain = texts.map(plainWords).join(' ');
  if (candidate.mature) return no('mature', 'the source marks it mature');
  const matureWord = MATURE_WORDS.find((word) => plain.includes(` ${word} `));
  if (matureWord) return no('mature', matureWord);

  const brands = soundBrands(options.brands);
  const brand = brandIn(texts, brands);
  if (brand) return no('brand_name', brand);

  const signal = SOUND_DERIVATIVE_SIGNALS.find((word) => plain.includes(` ${word} `));
  if (signal) return no('derivative_signal', signal);
  if (namesAnArtist(name)) return no('derivative_signal', 'named after an artist');

  if (!candidate.originalWork) {
    return no('needs_review', 'the source does not show it is an original work');
  }

  const category = soundCategoryFor(
    candidate.category,
    [...(candidate.categoryWords ?? []), ...candidate.tags, name],
    candidate.kindHint,
  );
  if (!category) return no('no_category', candidate.category ?? 'no category');

  return {
    ok: true,
    licence,
    category,
    kind: soundKindOfCategory(category),
    tags: soundTags(candidate.tags, brands),
  };
}
