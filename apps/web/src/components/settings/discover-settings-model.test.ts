/**
 * The Discover settings page's lists: which languages can be added (and when
 * none can), how a language moves, the order topics are saved in, and what one
 * switch sends.
 */
import type { Locality } from '@/types/discover';
import {
  addableLanguages,
  addLanguageHelp,
  LANGUAGES_ALL_ADDED,
  LANGUAGES_FULL,
  LANGUAGES_NEED_PLACE,
  languagesMoved,
  languagesWith,
  languagesWithout,
  READ_ONLY_NOTICE,
  SOURCE_FIELDS,
  sourceOn,
  sourcesWith,
  topicsWith,
} from './discover-settings-model';

const INDIA: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: 'Asia/Kolkata',
  languages: ['hi', 'en', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa'],
  newsLanguages: ['hi', 'en', 'bn', 'ta', 'te', 'mr', 'ml'],
};

const PARIS: Locality = {
  countryCode: 'FR',
  countryName: 'France',
  regionCode: 'FR-IDF',
  regionName: 'Ile-de-France',
  city: 'Paris',
  timeZone: 'Europe/Paris',
  languages: ['fr', 'en'],
  newsLanguages: ['fr'],
};

describe('adding a language', () => {
  it("offers the place's news languages, then English, less what is listed", () => {
    expect(addableLanguages(['ta', 'en'], INDIA)).toEqual(['hi', 'bn', 'te', 'mr', 'ml']);
    // Paris has no English edition, but English can always be added.
    expect(addableLanguages([], PARIS)).toEqual(['fr', 'en']);
    expect(addableLanguages(['fr'], PARIS)).toEqual(['en']);
  });

  it('offers English alone without a saved place', () => {
    expect(addableLanguages([], null)).toEqual(['en']);
    expect(addableLanguages(['ta'], null)).toEqual(['en']);
    expect(addableLanguages(['en'], null)).toEqual([]);
  });

  it('treats a language as listed whatever its capitals', () => {
    expect(addableLanguages(['EN', 'Fr'], PARIS)).toEqual([]);
  });

  it('offers nothing once six are listed, and adds nothing', () => {
    const six = ['hi', 'en', 'bn', 'ta', 'te', 'mr'];
    expect(addableLanguages(six, INDIA)).toEqual([]);
    expect(languagesWith(six, 'ml')).toEqual(six);
    expect(languagesWith(['hi', 'en', 'bn', 'ta', 'te'], 'ml')).toHaveLength(6);
  });

  it('adds at the end, once', () => {
    expect(languagesWith(['ta'], 'en')).toEqual(['ta', 'en']);
    expect(languagesWith(['ta', 'en'], 'en')).toEqual(['ta', 'en']);
    expect(languagesWith(['ta', 'en'], 'EN')).toEqual(['ta', 'en']);
  });

  it('says why nothing can be added', () => {
    expect(addLanguageHelp(['hi', 'en', 'bn', 'ta', 'te', 'mr'], INDIA)).toBe(LANGUAGES_FULL);
    expect(LANGUAGES_FULL).toBe('You can keep up to 6 languages. Remove one to add another.');
    expect(addLanguageHelp(['fr', 'en'], PARIS)).toBe(LANGUAGES_ALL_ADDED);
    expect(addLanguageHelp([], null)).toBe(LANGUAGES_NEED_PLACE);
    expect(addLanguageHelp(['ta'], INDIA)).toBeNull();
  });
});

describe('ordering languages', () => {
  it('moves one a place up or down', () => {
    expect(languagesMoved(['ta', 'en', 'hi'], 'en', -1)).toEqual(['en', 'ta', 'hi']);
    expect(languagesMoved(['ta', 'en', 'hi'], 'en', 1)).toEqual(['ta', 'hi', 'en']);
  });

  it('leaves the list alone at either end, and for a language it does not hold', () => {
    expect(languagesMoved(['ta', 'en'], 'ta', -1)).toEqual(['ta', 'en']);
    expect(languagesMoved(['ta', 'en'], 'en', 1)).toEqual(['ta', 'en']);
    expect(languagesMoved(['ta', 'en'], 'fr', 1)).toEqual(['ta', 'en']);
  });

  it('never changes the list it was given', () => {
    const list = ['ta', 'en'];
    languagesMoved(list, 'en', -1);
    languagesWith(list, 'hi');
    languagesWithout(list, 'ta');
    expect(list).toEqual(['ta', 'en']);
  });

  it('removes one', () => {
    expect(languagesWithout(['ta', 'en'], 'ta')).toEqual(['en']);
    expect(languagesWithout(['ta'], 'ta')).toEqual([]);
  });
});

describe('news topics', () => {
  it("saves ticked topics in the list's order, not the order they were ticked in", () => {
    expect(topicsWith(['BUSINESS'], 'WORLD', true)).toEqual(['WORLD', 'BUSINESS']);
    expect(topicsWith(['WORLD', 'BUSINESS'], 'HEALTH', true)).toEqual([
      'WORLD',
      'BUSINESS',
      'HEALTH',
    ]);
    expect(topicsWith(['HEALTH', 'WORLD'], 'SPORTS', true)).toEqual(['WORLD', 'SPORTS', 'HEALTH']);
  });

  it('clears one, down to none', () => {
    expect(topicsWith(['WORLD', 'BUSINESS'], 'WORLD', false)).toEqual(['BUSINESS']);
    expect(topicsWith(['BUSINESS'], 'BUSINESS', false)).toEqual([]);
  });
});

describe('source switches', () => {
  it('names the five groups, News not among them', () => {
    expect(SOURCE_FIELDS.map((field) => field.label)).toEqual([
      'Rising Searches',
      'Wikipedia',
      'Worldwide Social',
      'Videos',
      'Festivals',
    ]);
    expect(SOURCE_FIELDS.map((field) => field.key)).toEqual([
      'trends',
      'wikipedia',
      'social',
      'videos',
      'festivals',
    ]);
    for (const field of SOURCE_FIELDS) expect(field.help).toMatch(/\.$/);
  });

  it('reads a missing switch as on', () => {
    expect(sourceOn(null, 'videos')).toBe(true);
    expect(sourceOn({}, 'videos')).toBe(true);
    expect(sourceOn({ videos: false }, 'videos')).toBe(false);
    expect(sourceOn({ videos: false }, 'social')).toBe(true);
  });

  it('sends all five when one is flipped', () => {
    expect(sourcesWith(null, 'social', false)).toEqual({
      trends: true,
      wikipedia: true,
      social: false,
      videos: true,
      festivals: true,
    });
    expect(sourcesWith({ social: false }, 'videos', false)).toEqual({
      trends: true,
      wikipedia: true,
      social: false,
      videos: false,
      festivals: true,
    });
    expect(sourcesWith({ social: false, videos: false }, 'social', true)).toEqual({
      trends: true,
      wikipedia: true,
      social: true,
      videos: false,
      festivals: true,
    });
  });
});

describe('the copy', () => {
  it('tells a member why nothing can be changed', () => {
    expect(READ_ONLY_NOTICE).toBe('Only workspace admins can change these settings.');
  });
});
