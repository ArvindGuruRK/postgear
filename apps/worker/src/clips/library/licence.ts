/**
 * The licence guard (Module 12, research 10 section 8.2), run on a
 * candidate's own words before anything is downloaded, so a refused item
 * costs nothing. It decides one of two things: the licence (an SPDX id) and
 * category the item is kept under, or the one reason it is turned away.
 */
import { brandIn, plainWords } from './brands';
import { categoryFor } from './taxonomy';
import type { LibraryCandidate, RejectionReason, StickerCategory, StickerLicence } from './types';

/** Anything that is not free to use for anything: no NC, ND, SA, GPL, "personal use" or bare "royalty free". */
const NOT_ALLOWED = [
  /\bnc\b/,
  /non ?commercial/,
  /\bnd\b/,
  /no ?deriv/,
  /\bsa\b/,
  /share ?alike/,
  /\bgpl\b/,
  /\blgpl\b/,
  /\bagpl\b/,
  /personal use/,
  /royalty free/,
  /editorial/,
  /all rights reserved/,
];

/** Each allowed licence: how a source may write it, and the pages its link may point to. */
const LICENCES: ReadonlyArray<{ id: StickerLicence; names: RegExp; urls: RegExp | null }> = [
  { id: 'OWN', names: /^own$/, urls: null },
  {
    id: 'CC0-1.0',
    names:
      /^(?:cc0(?: 1 0)?|cc zero|creative commons zero(?: 1 0)?|cc0 public domain(?: dedication)?|public domain cc0)$/,
    urls: /^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/zero\/1\.0\/?(?:legalcode(?:\.[a-z]+)?|deed\.[a-z-]+)?$/,
  },
  {
    id: 'PDM-1.0',
    names: /^(?:pdm(?: 1 0)?|public domain mark(?: 1 0)?)$/,
    urls: /^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/mark\/1\.0\/?(?:deed\.[a-z-]+)?$/,
  },
  {
    id: 'CC-BY-4.0',
    names:
      /^(?:cc by 4 0|cc by|creative commons attribution 4 0(?: international)?|attribution 4 0 international)$/,
    urls: /^https?:\/\/(?:www\.)?creativecommons\.org\/licenses\/by\/4\.0\/?(?:legalcode(?:\.[a-z]+)?|deed\.[a-z-]+)?$/,
  },
  {
    id: 'MIT',
    names: /^(?:mit|mit license|the mit license|expat)$/,
    urls: /^https?:\/\/(?:opensource\.org\/licenses?\/mit|spdx\.org\/licenses\/mit(?:\.html)?)\/?$/i,
  },
  {
    id: 'Apache-2.0',
    names: /^(?:apache 2 0|apache license 2 0|apache license version 2 0|apache)$/,
    urls: /^https?:\/\/(?:www\.apache\.org\/licenses\/license-2\.0(?:\.(?:html|txt))?|spdx\.org\/licenses\/apache-2\.0(?:\.html)?)\/?$/i,
  },
];

/** The SPDX id a stated licence is, or null when it is not one we allow (or not one at all). */
export function licenceFor(raw: string): StickerLicence | null {
  const words = plainWords(raw).trim();
  if (!words || NOT_ALLOWED.some((pattern) => pattern.test(words))) return null;
  return LICENCES.find((licence) => licence.names.test(words))?.id ?? null;
}

/** Whether a licence link points at that licence's own page. */
export function licenceUrlMatches(licence: StickerLicence, url: string | null): boolean {
  const entry = LICENCES.find((candidate) => candidate.id === licence);
  if (!entry?.urls) return url === null;
  return url !== null && entry.urls.test(url.trim());
}

export const MATURE_WORDS = [
  'nsfw',
  'nude',
  'naked',
  'sex',
  'sexy',
  'porn',
  'gore',
  'blood',
  'drug',
  'drugs',
  'weed',
  'beer',
  'alcohol',
  'gun',
  'guns',
  'weapon',
  'kill',
  'nazi',
  'swastika',
];

/** Signs an item copies someone else's work, under any licence. */
const DERIVATIVE_SIGNALS = [
  'fan art',
  'fanart',
  'parody',
  'inspired by',
  'in the style of',
  'logo',
  'trademark',
  'screenshot',
  'screen cap',
  'screencap',
  'trailer',
  'movie still',
  'film still',
  'tv still',
  'meme',
  'reaction gif',
  'official',
];

export interface GuardOptions {
  brands: readonly string[];
}

export type GuardResult =
  | { ok: true; licence: StickerLicence; category: StickerCategory }
  | { ok: false; reason: RejectionReason; detail: string };

/** Runs every check in order and returns the first reason that turns the candidate away. */
export function guardCandidate(candidate: LibraryCandidate, options: GuardOptions): GuardResult {
  const no = (reason: RejectionReason, detail: string): GuardResult => ({
    ok: false,
    reason,
    detail,
  });

  const licence = licenceFor(candidate.licenceRaw);
  if (!licence) return no('licence_not_allowed', candidate.licenceRaw || 'no licence');
  if (!licenceUrlMatches(licence, candidate.licenceUrl)) {
    return no('licence_url_mismatch', `${licence} links to ${candidate.licenceUrl ?? 'nothing'}`);
  }

  const name = candidate.name.trim();
  if (!name || !candidate.originId.trim() || !candidate.sourceUrl.trim()) {
    return no('missing_metadata', 'a name, an id and a page are needed');
  }
  if (licence !== 'OWN' && !candidate.creator.trim()) return no('missing_metadata', 'no creator');
  if (!candidate.downloadUrl && !candidate.path) return no('missing_metadata', 'no file');

  const words = [name, ...candidate.tags];
  const plain = words.map(plainWords).join(' ');
  if (candidate.mature) return no('mature', 'the source marks it mature');
  const matureWord = MATURE_WORDS.find((word) => plain.includes(` ${word} `));
  if (matureWord) return no('mature', matureWord);

  const brand = brandIn(words, options.brands);
  if (brand) return no('brand_name', brand);

  const signal = DERIVATIVE_SIGNALS.find((word) => plain.includes(` ${word} `));
  if (signal || !candidate.originalWork)
    return no('derivative_signal', signal ?? 'not an original work');

  const category = categoryFor(candidate.category, [
    ...(candidate.categoryWords ?? []),
    ...candidate.tags,
  ]);
  if (!category) return no('no_category', candidate.category ?? 'no category');

  return { ok: true, licence, category };
}
