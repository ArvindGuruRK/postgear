import { PATTERN_ARTS } from './patterns';
import type { ArtColors } from './types';

/**
 * FNV-1a, 32-bit. Written here rather than taken from `node:crypto` because
 * `src/` stays free of Node built-ins, and a change detector needs no more.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * CarouselClick's ten palettes and its brand-dark inks on the forest ground,
 * with the colours exactly as its `designFor` builds them for a template
 * without custom colours: the sheen is white on a dark tone and the
 * highlight on a light one.
 */
const PALETTES: Array<{
  tone: 'dark' | 'light';
  background: string;
  mid: string;
  highlight: string;
}> = [
  { tone: 'dark', background: '#023D1E', mid: '#0B6B35', highlight: '#B8FF35' },
  { tone: 'dark', background: '#05011A', mid: '#2B1E6B', highlight: '#69E57D' },
  { tone: 'dark', background: '#0C2B2D', mid: '#004D43', highlight: '#D0FF71' },
  { tone: 'dark', background: '#04172B', mid: '#0B3D7A', highlight: '#4FB3FF' },
  { tone: 'dark', background: '#140A2B', mid: '#4B2A99', highlight: '#C3A8FF' },
  { tone: 'dark', background: '#1E0C06', mid: '#7A2A0E', highlight: '#FF9A5C' },
  { tone: 'dark', background: '#111114', mid: '#34343C', highlight: '#F2F2F5' },
  { tone: 'light', background: '#EBFFF6', mid: '#9FF0C6', highlight: '#C6FF5C' },
  { tone: 'light', background: '#F6F4EE', mid: '#D9CCFF', highlight: '#8B6CFF' },
  { tone: 'light', background: '#EEF5FF', mid: '#BFD8FF', highlight: '#5FB0FF' },
  { tone: 'dark', background: '#023D1E', mid: '#0B6B35', highlight: '#B8FF35' },
];

const COLORS: ArtColors[] = PALETTES.map(({ tone, background, mid, highlight }) => ({
  background,
  mid,
  highlight,
  sheen: tone === 'dark' ? '#FFFFFF' : highlight,
}));

const SIZES: Array<[number, number]> = [
  [1080, 1080],
  [1080, 1350],
  [1080, 1920],
  [1920, 1080],
  [1600, 900],
  [1200, 627],
];

/**
 * Recorded on 2026-10-28 from CarouselClick's own `patternSvg`
 * (`src/features/templates/patterns.ts`, run unchanged), not from the port:
 * one hash per pattern and size over the eleven palettes' documents joined
 * by newlines. All 660 documents were then identical to the port's. A
 * failure means the port no longer draws what CarouselClick drew: fix the
 * port, never these.
 */
const CAROUSELCLICK: Record<string, Record<string, string>> = {
  aurora: {
    '1080x1080': '00955a51',
    '1080x1350': '03483d69',
    '1080x1920': '6c588f3c',
    '1920x1080': 'f0dfaa8b',
    '1600x900': '3aa1a6c0',
    '1200x627': '3a9d7e72',
  },
  prism: {
    '1080x1080': '1abce56e',
    '1080x1350': '81e3514a',
    '1080x1920': 'f3576807',
    '1920x1080': 'a42eae70',
    '1600x900': '55bc6c6b',
    '1200x627': '4147b8a6',
  },
  beams: {
    '1080x1080': '6cc9cef1',
    '1080x1350': '4676a42b',
    '1080x1920': 'ccb8b5f9',
    '1920x1080': '553e6349',
    '1600x900': '0847bf07',
    '1200x627': '2b16711a',
  },
  arcs: {
    '1080x1080': '8f823c60',
    '1080x1350': '326bf975',
    '1080x1920': 'dd56d910',
    '1920x1080': '4845cee0',
    '1600x900': '3cef4690',
    '1200x627': '83ce25b1',
  },
  planes: {
    '1080x1080': '33d1ea5e',
    '1080x1350': 'be7268c9',
    '1080x1920': 'd11b7be2',
    '1920x1080': 'c5e4c25c',
    '1600x900': '78924cbc',
    '1200x627': 'e9491b8c',
  },
  waves: {
    '1080x1080': 'fe5f56a5',
    '1080x1350': 'c5152137',
    '1080x1920': '74d9aed9',
    '1920x1080': '562fc62c',
    '1600x900': 'db30ed17',
    '1200x627': '37656a68',
  },
  horizon: {
    '1080x1080': 'fa0f952c',
    '1080x1350': 'd784d623',
    '1080x1920': '6d59c9fd',
    '1920x1080': '80225abc',
    '1600x900': '25382fc0',
    '1200x627': 'c01773af',
  },
  halftone: {
    '1080x1080': '3657926a',
    '1080x1350': '3d9751ba',
    '1080x1920': 'a867fed3',
    '1920x1080': '3b49a44c',
    '1600x900': '90e345ce',
    '1200x627': '6a512dc0',
  },
  glass: {
    '1080x1080': '0c987019',
    '1080x1350': 'cabe353c',
    '1080x1920': '04c31e9e',
    '1920x1080': '8a8d8745',
    '1600x900': 'e73e858e',
    '1200x627': '8c8a86d7',
  },
  minimal: {
    '1080x1080': 'b185e1e5',
    '1080x1350': 'c42fcbf6',
    '1080x1920': '09d1e84e',
    '1920x1080': '3b062aeb',
    '1600x900': '016a7b16',
    '1200x627': '468672d9',
  },
};

describe('PATTERN_ARTS', () => {
  it("lists CarouselClick's ten patterns in its order, under its names", () => {
    expect(PATTERN_ARTS.map((art) => [art.id, art.name])).toEqual([
      ['aurora', 'Aurora'],
      ['prism', 'Prism'],
      ['beams', 'Beams'],
      ['arcs', 'Arcs'],
      ['planes', 'Planes'],
      ['waves', 'Waves'],
      ['horizon', 'Horizon'],
      ['halftone', 'Halftone'],
      ['glass', 'Glass'],
      ['minimal', 'Minimal'],
    ]);
  });

  it('has unique ids', () => {
    const ids = PATTERN_ARTS.map((art) => art.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is free and needs no home colours', () => {
    for (const art of PATTERN_ARTS) {
      expect(art.kind).toBe('pattern');
      expect(art.premium).toBe(false);
      expect(art.home).toBeUndefined();
    }
  });

  it.each(PATTERN_ARTS.map((art) => art.id))(
    'draws %s byte for byte as CarouselClick did, in every palette and size',
    (id) => {
      const art = PATTERN_ARTS.find((entry) => entry.id === id);
      if (!art) throw new Error(`no pattern ${id}`);

      const hashes = Object.fromEntries(
        SIZES.map(([width, height]) => [
          `${width}x${height}`,
          fnv1a(COLORS.map((colors) => art.draw(colors, width, height)).join('\n')),
        ]),
      );

      expect(hashes).toEqual(CAROUSELCLICK[id]);
    },
  );

  it('is deterministic', () => {
    for (const art of PATTERN_ARTS) {
      expect(art.draw(COLORS[1], 1080, 1350)).toBe(art.draw(COLORS[1], 1080, 1350));
    }
  });

  it('draws one SVG document at the canvas size, with nothing external', () => {
    for (const art of PATTERN_ARTS) {
      for (const [width, height] of SIZES) {
        const svg = art.draw(COLORS[8], width, height);

        expect(
          svg.startsWith(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
          ),
        ).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg.match(/<svg/g)).toHaveLength(1);
        expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(
          /https?:|href|<image|<text|<style/,
        );
      }
    }
  });
});
