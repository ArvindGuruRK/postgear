/**
 * The library's publish rules (Module 19 section 9), shared by the ingest in
 * the worker and the operator's Library screen in the API.
 */
import {
  LIBRARY_SOUND_LICENCES,
  LIBRARY_SOUND_ORIGINS,
  LIBRARY_STICKER_LICENCES,
  libraryPublishRefusal,
  libraryRunNeedsReview,
} from './library';

const noCredit = { requiresCredit: false, creditLine: null };

describe('libraryPublishRefusal', () => {
  it('lets an allowed licence from a known adapter go live', () => {
    expect(libraryPublishRefusal('sound', { licence: 'CC0-1.0', origin: 'kenney' }, noCredit)).toBe(
      null,
    );
    expect(
      libraryPublishRefusal(
        'sticker',
        { licence: 'CC-BY-4.0', origin: 'noto' },
        {
          requiresCredit: true,
          creditLine: 'Noto Emoji Animation by Google, CC BY 4.0',
        },
      ),
    ).toBe(null);
  });

  it('never lets a sound carry CC BY, MIT or Apache', () => {
    for (const licence of ['CC-BY-4.0', 'MIT', 'Apache-2.0']) {
      expect(libraryPublishRefusal('sound', { licence, origin: 'openverse' }, noCredit)).toBe(
        'licence_not_allowed',
      );
    }
  });

  it('refuses a licence on no list, whatever the kind', () => {
    for (const type of ['sound', 'sticker'] as const) {
      expect(
        libraryPublishRefusal(type, { licence: 'CC-BY-NC-4.0', origin: 'own' }, noCredit),
      ).toBe('licence_not_allowed');
    }
  });

  it('refuses any source other than the ingest adapters', () => {
    expect(libraryPublishRefusal('sound', { licence: 'CC0-1.0', origin: 'giphy' }, noCredit)).toBe(
      'unknown_source',
    );
    // Open Peeps is a sticker adapter, not a sound one.
    expect(
      libraryPublishRefusal('sound', { licence: 'CC0-1.0', origin: 'openpeeps' }, noCredit),
    ).toBe('unknown_source');
    expect(LIBRARY_SOUND_ORIGINS).toHaveLength(5);
  });

  it('holds back a source that needs a credit line and has none', () => {
    expect(
      libraryPublishRefusal(
        'sticker',
        { licence: 'CC-BY-4.0', origin: 'noto' },
        {
          requiresCredit: true,
          creditLine: '  ',
        },
      ),
    ).toBe('credit_line_missing');
  });

  it('keeps the sound list a strict part of the sticker list', () => {
    for (const licence of LIBRARY_SOUND_LICENCES) {
      expect(LIBRARY_STICKER_LICENCES).toContain(licence);
    }
  });
});

describe('libraryRunNeedsReview', () => {
  it('marks Openverse, OpenGameArt and Freesound runs for a person, never own or Kenney', () => {
    expect(libraryRunNeedsReview('sound', 'openverse')).toBe(true);
    expect(libraryRunNeedsReview('sound', 'opengameart')).toBe(true);
    expect(libraryRunNeedsReview('sound', 'freesound')).toBe(true);
    expect(libraryRunNeedsReview('sound', 'own')).toBe(false);
    expect(libraryRunNeedsReview('sound', 'kenney')).toBe(false);
    expect(libraryRunNeedsReview('sticker', 'noto')).toBe(false);
    expect(libraryRunNeedsReview('sticker', 'openpeeps')).toBe(true);
  });
});
