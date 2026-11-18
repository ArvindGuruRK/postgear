import {
  CREDIT_GROUP_NAMES,
  licenceName,
  linkable,
  soundCount,
  sourceByline,
  stickerCount,
} from './credits-model';

describe('the Clips credits words', () => {
  it('names the groups in Title Case', () => {
    expect(Object.values(CREDIT_GROUP_NAMES)).toEqual([
      'Attribution Required',
      'Notices',
      'Public Domain And CC0',
    ]);
  });

  it('links only web addresses, never our own art or a script', () => {
    expect(linkable('https://openmoji.org/')).toBe('https://openmoji.org/');
    expect(linkable('http://example.org/a')).toBe('http://example.org/a');
    expect(linkable('own://postgear')).toBeNull();
    expect(linkable('javascript:alert(1)')).toBeNull();
    expect(linkable('not a url')).toBeNull();
    expect(linkable(null)).toBeNull();
  });

  it('names a licence in words; our own art has none', () => {
    expect(licenceName('CC-BY-4.0')).toBe('CC BY 4.0');
    expect(licenceName('CC0-1.0')).toBe('CC0 1.0');
    expect(licenceName('OWN')).toBeNull();
  });

  it('says who made the art and how many stickers it gave', () => {
    expect(stickerCount(1)).toBe('1 sticker');
    expect(stickerCount(193)).toBe('193 stickers');
    expect(sourceByline({ author: ' Sam Lee ', stickers: 4 })).toBe('By Sam Lee, 4 stickers');
    expect(sourceByline({ author: '', stickers: 1 })).toBe('1 sticker');
  });

  it('counts the sounds a source gave, alone or beside its stickers', () => {
    expect(soundCount(1)).toBe('1 sound');
    expect(soundCount(92)).toBe('92 sounds');
    expect(sourceByline({ author: 'Kenney', stickers: 0, sounds: 130 })).toBe('By Kenney, 130 sounds');
    expect(sourceByline({ author: 'PostGear', stickers: 193, sounds: 92 })).toBe(
      'By PostGear, 193 stickers and 92 sounds',
    );
    expect(sourceByline({ author: '', stickers: 0, sounds: 1 })).toBe('1 sound');
  });
});
