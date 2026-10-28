import { mix } from '../color';
import { ART_STYLES, artById, artColors, artDataUri, artSvg, isArtId, isDarkGround } from './index';
import type { ArtColors } from './types';

/** A theme that pins its own art colours, the way a ported CarouselClick look does. */
const PINNED = { background: '#0C2B2D', mid: '#004D43', highlight: '#D0FF71' };

function homeOf(id: string) {
  const home = artById(id)?.home;
  if (!home) throw new Error(`${id} has no home`);
  return home;
}

describe('artColors', () => {
  it("draws an original in its file's own colours on its home ground", () => {
    expect(artColors({ ground: '#162D2F', accent: '#FF0000', home: homeOf('drift') })).toEqual({
      background: '#162D2F',
      mid: '#004D43',
      highlight: '#D0FF71',
      sheen: '#FFFFFF',
    });
  });

  it('matches the home ground however the hex is written', () => {
    expect(artColors({ ground: '#162d2f', accent: '#FF0000', home: homeOf('drift') }).mid).toBe(
      '#004D43',
    );
  });

  it("puts an original's home before a theme's pinned colours on the same ground", () => {
    const colors = artColors({
      ground: '#05011A',
      accent: '#69E57D',
      pinned: { background: '#05011A', mid: '#2B1E6B', highlight: '#69E57D' },
      home: homeOf('ladder'),
    });

    expect(colors).toEqual({
      background: '#05011A',
      mid: '#0D461D',
      highlight: '#08F967',
      sheen: '#FFFFFF',
    });
  });

  it("uses the theme's pinned colours on the theme's own background", () => {
    // A pattern has no home; an original away from its home falls through too.
    for (const home of [null, homeOf('drift')]) {
      expect(artColors({ ground: '#0C2B2D', accent: '#3EE6C5', pinned: PINNED, home })).toEqual({
        background: '#0C2B2D',
        mid: '#004D43',
        highlight: '#D0FF71',
        sheen: '#FFFFFF',
      });
    }
  });

  it('derives from the ground and the accent anywhere else, as CarouselClick re-derives custom colours', () => {
    // A brand kit's ground: neither the home nor the pinned background.
    const dark = artColors({
      ground: '#0E1116',
      accent: '#4f8cff',
      pinned: PINNED,
      home: homeOf('drift'),
    });
    expect(dark).toEqual({
      background: '#0E1116',
      mid: mix('#0E1116', '#4F8CFF', 0.35),
      highlight: '#4F8CFF',
      sheen: '#FFFFFF',
    });

    const light = artColors({ ground: '#F6F4EE', accent: '#5B3FD9', pinned: PINNED });
    expect(light).toEqual({
      background: '#F6F4EE',
      mid: mix('#F6F4EE', '#5B3FD9', 0.45),
      highlight: '#5B3FD9',
      sheen: '#5B3FD9',
    });
  });

  it('gives the art a white sheen on a dark ground and the highlight on a light one', () => {
    for (const ground of ['#000000', '#05011A', '#023D1E', '#4B2A99', '#0E1116']) {
      expect(isDarkGround(ground)).toBe(true);
      expect(artColors({ ground, accent: '#4F8CFF' }).sheen).toBe('#FFFFFF');
    }
    for (const ground of ['#FFFFFF', '#EBFFF6', '#F6F4EE', '#EEF5FF']) {
      expect(isDarkGround(ground)).toBe(false);
      expect(artColors({ ground, accent: '#4F8CFF' }).sheen).toBe('#4F8CFF');
    }
    // The light original keeps the rule on its own ground: its sheen is its highlight.
    expect(artColors({ ground: '#EBFFF6', accent: '#0E9F5A', home: homeOf('bloom') }).sheen).toBe(
      '#004D43',
    );
  });

  it('keeps a sheen a home names', () => {
    const home = { background: '#05011A', mid: '#3F3F3F', highlight: '#B8FF35', sheen: '#EEEEEE' };
    expect(artColors({ ground: '#05011A', accent: '#FF0000', home }).sheen).toBe('#EEEEEE');
  });
});

describe('artSvg', () => {
  const colors: ArtColors = {
    background: '#123456',
    mid: '#234567',
    highlight: '#3456AB',
    sheen: '#FFFFFF',
  };

  it('returns null for an id it does not know', () => {
    expect(artSvg('no-such-art', colors, 1080, 1350)).toBeNull();
    expect(artSvg('toString', colors, 1080, 1350)).toBeNull();
  });

  it('draws what the style draws', () => {
    for (const art of ART_STYLES) {
      expect(artSvg(art.id, colors, 1080, 1350)).toBe(art.draw(colors, 1080, 1350));
    }
  });

  it('draws each distinct input once and serves repeats from its cache', () => {
    const art = artById('aurora');
    if (!art) throw new Error('aurora is missing');
    const draw = jest.spyOn(art, 'draw');
    const unique: ArtColors = { ...colors, background: '#0A0B0C' };

    try {
      const first = artSvg('aurora', unique, 1080, 1080);
      const again = artSvg('aurora', unique, 1080, 1080);
      expect(again).toBe(first);
      expect(draw).toHaveBeenCalledTimes(1);

      // Any part of the key changing draws afresh.
      artSvg('aurora', unique, 1080, 1350);
      artSvg('aurora', { ...unique, sheen: '#3456AB' }, 1080, 1080);
      expect(draw).toHaveBeenCalledTimes(3);
    } finally {
      draw.mockRestore();
    }
  });

  it('stays small: the oldest drawing goes once enough newer ones arrive', () => {
    const art = artById('minimal');
    if (!art) throw new Error('minimal is missing');
    const draw = jest.spyOn(art, 'draw');
    const unique: ArtColors = { ...colors, background: '#0D0E0F' };

    try {
      artSvg('minimal', unique, 10, 10);
      for (let size = 11; size < 1011; size++) artSvg('minimal', unique, size, 10);
      expect(draw).toHaveBeenCalledTimes(1001);

      artSvg('minimal', unique, 10, 10);
      expect(draw).toHaveBeenCalledTimes(1002);
    } finally {
      draw.mockRestore();
    }
  });
});

describe('ART_STYLES', () => {
  it('has unique ids', () => {
    const ids = ART_STYLES.map((art) => art.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names every style in Title Case, every word capitalised', () => {
    for (const art of ART_STYLES) {
      expect(art.name).toMatch(/^[A-Z][A-Za-z0-9]*( [A-Z0-9][A-Za-z0-9]*)*$/);
    }
  });

  it('knows exactly its own ids', () => {
    for (const art of ART_STYLES) {
      expect(isArtId(art.id)).toBe(true);
      expect(artById(art.id)).toBe(art);
    }
    expect(isArtId('toString')).toBe(false);
    expect(isArtId(null)).toBe(false);
    expect(artById(null)).toBeNull();
    expect(artById('')).toBeNull();
  });

  it('keeps the patterns free and the hand-made originals premium', () => {
    for (const art of ART_STYLES) {
      if (art.kind === 'pattern') expect(art.premium).toBe(false);
      if (art.kind === 'original') {
        expect(art.premium).toBe(true);
        expect(art.home).toBeDefined();
      }
    }
    expect(ART_STYLES.filter((art) => art.kind === 'pattern')).toHaveLength(10);
    expect(ART_STYLES.filter((art) => art.kind === 'original')).toHaveLength(10);
  });
});

describe('artDataUri', () => {
  it('encodes a document for <img src> without losing a character', () => {
    const home = homeOf('ladder');
    const svg = artSvg(
      'ladder',
      artColors({ ground: home.background, accent: '#FFFFFF', home }),
      1080,
      1350,
    );
    if (!svg) throw new Error('ladder is missing');
    const uri = artDataUri(svg);

    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(uri).not.toMatch(/[#<>"\s]/);
    expect(decodeURIComponent(uri.slice('data:image/svg+xml;charset=utf-8,'.length))).toBe(svg);
  });
});
