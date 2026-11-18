import { brandIn, loadBrands } from './brands';
import { guardCandidate, licenceFor, licenceUrlMatches } from './licence';
import { categoryFor } from './taxonomy';
import type { LibraryCandidate } from './types';

const BRANDS = loadBrands(null);

function candidate(overrides: Partial<LibraryCandidate> = {}): LibraryCandidate {
  return {
    name: 'Happy Star',
    tags: ['star', 'happy'],
    category: 'arrows-shapes',
    creator: 'Kenney',
    creatorUrl: 'https://kenney.nl',
    licenceRaw: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://kenney.nl/assets/emotes-pack',
    originId: 'emotes-pack/star.png',
    path: 'star.png',
    mature: false,
    originalWork: true,
    ...overrides,
  };
}

describe('which licences a sticker may have', () => {
  it.each([
    ['CC0', 'CC0-1.0'],
    ['CC0 1.0', 'CC0-1.0'],
    ['Creative Commons Zero', 'CC0-1.0'],
    ['Public Domain Mark 1.0', 'PDM-1.0'],
    ['CC BY 4.0', 'CC-BY-4.0'],
    ['CC-BY-4.0', 'CC-BY-4.0'],
    ['Creative Commons Attribution 4.0 International', 'CC-BY-4.0'],
    ['MIT', 'MIT'],
    ['Apache-2.0', 'Apache-2.0'],
    ['Apache License 2.0', 'Apache-2.0'],
    ['OWN', 'OWN'],
  ])('reads "%s" as %s', (raw, id) => {
    expect(licenceFor(raw)).toBe(id);
  });

  it.each([
    'CC BY-NC 4.0',
    'CC BY-SA 4.0',
    'CC BY-ND 4.0',
    'CC BY-NC-SA 4.0',
    'GPL-3.0',
    'Free for personal use',
    'Royalty free',
    'All rights reserved',
    'CC BY 3.0',
    '',
    'unknown',
  ])('refuses "%s"', (raw) => {
    expect(licenceFor(raw)).toBeNull();
  });

  it("checks the link is the licence's own page", () => {
    expect(licenceUrlMatches('CC0-1.0', 'https://creativecommons.org/publicdomain/zero/1.0/')).toBe(
      true,
    );
    expect(
      licenceUrlMatches(
        'CC0-1.0',
        'https://creativecommons.org/publicdomain/zero/1.0/legalcode.en',
      ),
    ).toBe(true);
    expect(licenceUrlMatches('CC-BY-4.0', 'https://creativecommons.org/licenses/by/4.0/')).toBe(
      true,
    );
    expect(licenceUrlMatches('CC-BY-4.0', 'https://creativecommons.org/licenses/by-nc/4.0/')).toBe(
      false,
    );
    expect(licenceUrlMatches('CC0-1.0', 'https://example.com/cc0')).toBe(false);
    expect(licenceUrlMatches('MIT', 'https://opensource.org/licenses/MIT')).toBe(true);
    expect(licenceUrlMatches('OWN', null)).toBe(true);
    expect(licenceUrlMatches('OWN', 'https://example.com')).toBe(false);
    expect(licenceUrlMatches('CC0-1.0', null)).toBe(false);
  });
});

describe('the licence guard', () => {
  it('keeps an open, original, named item with its licence id and category', () => {
    expect(guardCandidate(candidate(), { brands: BRANDS })).toEqual({
      ok: true,
      licence: 'CC0-1.0',
      category: 'arrows-shapes',
    });
  });

  it.each([
    ['licence_not_allowed', { licenceRaw: 'CC BY-NC 4.0' }],
    ['licence_url_mismatch', { licenceUrl: 'https://example.com/licence' }],
    ['missing_metadata', { name: '  ' }],
    ['missing_metadata', { creator: '' }],
    ['missing_metadata', { path: undefined, downloadUrl: undefined }],
    ['mature', { mature: true }],
    ['mature', { tags: ['nsfw'] }],
    ['brand_name', { name: 'Twitch Heart' }],
    ['brand_name', { tags: ['super', 'mario'] }],
    ['derivative_signal', { name: 'Fan Art Star' }],
    ['derivative_signal', { originalWork: false }],
    ['no_category', { category: 'stuff', tags: ['blob'] }],
  ] as const)('turns an item away with %s', (reason, overrides) => {
    const result = guardCandidate(candidate(overrides as Partial<LibraryCandidate>), {
      brands: BRANDS,
    });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it('lets OWN art through without a creator link or licence page', () => {
    const own = candidate({
      creator: 'PostGear',
      creatorUrl: null,
      licenceRaw: 'OWN',
      licenceUrl: null,
    });
    expect(guardCandidate(own, { brands: BRANDS })).toMatchObject({ ok: true, licence: 'OWN' });
  });
});

describe('the brand list', () => {
  it('matches whole words only, so a word inside another is not a brand', () => {
    expect(brandIn(['Kick Off'], BRANDS)).toBe('kick');
    expect(brandIn(['Kicking Feet'], BRANDS)).toBeNull();
    expect(brandIn(['Spider-Man Pose'], BRANDS)).toBe('spider man');
    expect(brandIn(['Red Apple', 'Face With Steam'], BRANDS)).toBeNull();
  });
});

describe('the taxonomy', () => {
  it('takes a given slug, else maps the source words, else nothing', () => {
    expect(categoryFor('gaming', [])).toBe('gaming');
    expect(categoryFor(undefined, ['Smileys and emotions'])).toBe('animated-emoji');
    expect(categoryFor(undefined, ['emote'])).toBe('reactions');
    expect(categoryFor('misc', ['arrow'])).toBe('arrows-shapes');
    expect(categoryFor(undefined, ['blob'])).toBeNull();
    expect(categoryFor(undefined, ['emote', 'heart'])).toBe('reactions');
    expect(categoryFor(undefined, ['heart', 'emote'])).toBe('arrows-shapes');
  });
});
