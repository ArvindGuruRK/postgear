import { contrastRatio, INK_DARK, INK_LIGHT, mix } from '../color';
import { ORIGINAL_ARTS } from './originals';
import type { ArtColors, ArtStyle } from './types';

/** FNV-1a, 32-bit: `src/` stays free of Node built-ins, and a change detector needs no more. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** What `artColors` hands a style on its own home ground (`art.test.ts` holds it to that). */
function homeColors(art: ArtStyle): ArtColors {
  const home = art.home;
  if (!home) throw new Error(`${art.id} has no home`);
  const dark =
    contrastRatio(INK_LIGHT, home.background) >= contrastRatio(INK_DARK, home.background);
  return {
    background: home.background,
    mid: home.mid,
    highlight: home.highlight,
    sheen: home.sheen ?? (dark ? '#FFFFFF' : home.highlight),
  };
}

const SIZES: Array<[number, number]> = [
  [1080, 1080],
  [1080, 1350],
  [1080, 1920],
  [1920, 1080],
  [1600, 900],
  [1200, 627],
];

/** A ground and accent none of the files use, as a brand kit would bring. */
const FOREIGN: ArtColors = {
  background: '#F6F4EE',
  mid: '#B0A3E5',
  highlight: '#5B3FD9',
  sheen: '#5B3FD9',
};

/** Every colour literal in the eleven files, white and the hidden grey included. */
const FILE_LITERALS = [
  '#05011A',
  '#025226',
  '#03421F',
  '#505050',
  '#162D2F',
  '#193133',
  '#004D43',
  '#D0FF71',
  '#EBFFF6',
  '#F7F7F7',
  '#3F3F3F',
  '#05DC7F',
  '#08F967',
  '#0D461D',
  '#FFFFFF',
];

/**
 * Each style on its home colours, at the two sizes the Chromium fidelity
 * proof compared with CarouselClick's own files on 2026-10-28 (every one
 * within 4 per channel on 99.97% or more of its pixels, Ladder on 99.52%
 * and 99.49%, which its file's own markup at canvas size also scores). A
 * change here means the drawing moved away from what was proved: re-run the
 * proof before re-recording.
 */
const PROVED: Record<string, Record<string, string>> = {
  cascade: { '1080x1350': '9f68dce0', '1920x1080': '23b923ed' },
  canopy: { '1080x1350': '38692810', '1920x1080': '06673d91' },
  tiers: { '1080x1350': '56338272', '1920x1080': '5a541cf7' },
  shards: { '1080x1350': 'fd946f6c', '1920x1080': '1f832d6f' },
  slabs: { '1080x1350': 'cfdd9cf2', '1920x1080': 'c857e39d' },
  drift: { '1080x1350': 'cc606417', '1920x1080': 'bbc4931c' },
  'layered-depth': { '1080x1350': 'ba3f6a6b', '1920x1080': '2210d55c' },
  ray: { '1080x1350': '4c6cec68', '1920x1080': '3ca966b9' },
  ladder: { '1080x1350': '949facb6', '1920x1080': '15eade8f' },
  bloom: { '1080x1350': '08d65f5b', '1920x1080': '4f51bd92' },
};

function byId(id: string): ArtStyle {
  const art = ORIGINAL_ARTS.find((entry) => entry.id === id);
  if (!art) throw new Error(`no original ${id}`);
  return art;
}

const hexes = (svg: string) => [...new Set(svg.match(/#[0-9A-Fa-f]{6}\b/g) ?? [])];

describe('ORIGINAL_ARTS', () => {
  it('rebuilds the hand-made backgrounds as ten premium styles with generic names', () => {
    expect(ORIGINAL_ARTS.map((art) => [art.id, art.name])).toEqual([
      ['cascade', 'Cascade'],
      ['canopy', 'Canopy'],
      ['tiers', 'Tiers'],
      ['shards', 'Shards'],
      ['slabs', 'Slabs'],
      ['drift', 'Drift'],
      ['layered-depth', 'Facets'],
      ['ray', 'Ray'],
      ['ladder', 'Ladder'],
      ['bloom', 'Bloom'],
    ]);
    for (const art of ORIGINAL_ARTS) {
      expect(art.kind).toBe('original');
      expect(art.premium).toBe(true);
      expect(art.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('keeps each one at home on the ground CarouselClick drew it on', () => {
    expect(Object.fromEntries(ORIGINAL_ARTS.map((art) => [art.id, art.home?.background]))).toEqual({
      cascade: '#05011A',
      canopy: '#05011A',
      tiers: '#05011A',
      shards: '#025226',
      slabs: '#025226',
      drift: '#162D2F',
      'layered-depth': '#05011A',
      ray: '#05011A',
      ladder: '#05011A',
      bloom: '#EBFFF6',
    });
    for (const art of ORIGINAL_ARTS) {
      for (const value of Object.values(art.home ?? {})) expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each(ORIGINAL_ARTS.map((art) => art.id))(
    'draws %s as one SVG at the canvas size, sliced like object-fit: cover',
    (id) => {
      const art = byId(id);
      for (const [width, height] of SIZES) {
        const colors = homeColors(art);
        const svg = art.draw(colors, width, height);
        const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);

        expect(
          svg.startsWith(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `,
          ),
        ).toBe(true);
        expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg.match(/<svg/g)).toHaveLength(1);
        // The ground comes first, over the whole viewBox: some files were transparent.
        expect(view).not.toBeNull();
        expect(svg.replace(/<defs>.*?<\/defs>/, '')).toContain(
          `slice"><rect width="${view?.[1]}" height="${view?.[2]}" fill="${colors.background}"/>`,
        );
      }
    },
  );

  it('references nothing outside the document, and every id it uses resolves', () => {
    for (const art of ORIGINAL_ARTS) {
      for (const [width, height] of SIZES) {
        const svg = art.draw(FOREIGN, width, height);
        const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
        const used = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);

        expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(
          /https?:|href|<image|<text|<style|<foreignObject/,
        );
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of used) expect(ids).toContain(id);
      }
    }
  });

  it('is deterministic', () => {
    for (const art of ORIGINAL_ARTS) {
      expect(art.draw(FOREIGN, 1080, 1350)).toBe(art.draw(FOREIGN, 1080, 1350));
    }
  });

  it("recolours completely: another palette leaves none of the files' colours behind", () => {
    // The only colours allowed are the palette's four and the fixed mixes the
    // generators document: the first facet's off-white, the tonal planes,
    // and Drift's lifted fade.
    const allowed = [
      FOREIGN.background,
      FOREIGN.mid,
      FOREIGN.highlight,
      FOREIGN.sheen,
      mix(FOREIGN.sheen, FOREIGN.mid, 0.04),
      mix(FOREIGN.background, FOREIGN.mid, 0.5),
      mix(FOREIGN.background, '#FFFFFF', 0.018),
    ];

    for (const art of ORIGINAL_ARTS) {
      const home = art.draw(homeColors(art), 1080, 1350);
      const recoloured = art.draw(FOREIGN, 1080, 1350);

      expect(recoloured).not.toBe(home);
      for (const hex of hexes(recoloured)) {
        expect(FILE_LITERALS).not.toContain(hex.toUpperCase());
        expect(allowed).toContain(hex);
      }
      expect(recoloured).not.toMatch(/"(white|black)"/);
    }
  });

  it("draws the files' own colours on the home ground", () => {
    const at = (id: string) => hexes(byId(id).draw(homeColors(byId(id)), 1080, 1350)).sort();

    for (const id of ['cascade', 'canopy', 'tiers', 'layered-depth']) {
      expect(at(id)).toEqual(['#05011A', '#3F3F3F', '#F7F7F7', '#FFFFFF']);
    }
    expect(at('shards')).toEqual(['#025226', '#03421F']);
    expect(at('slabs')).toEqual(['#025226', '#03421F']);
    // The file fades into #193133; the token lands one step of red away.
    expect(at('drift')).toEqual(['#004D43', '#162D2F', '#1A3133', '#D0FF71']);
    expect(at('bloom')).toEqual(['#004D43', '#D0FF71', '#EBFFF6']);
    expect(at('ray')).toEqual(['#05011A', '#05DC7F']);
    expect(at('ladder')).toEqual(['#05011A', '#08F967', '#0D461D']);
  });

  it('draws exactly what the fidelity proof checked, on the home colours', () => {
    for (const art of ORIGINAL_ARTS) {
      const hashes = Object.fromEntries(
        (
          [
            [1080, 1350],
            [1920, 1080],
          ] as const
        ).map(([width, height]) => [
          `${width}x${height}`,
          fnv1a(art.draw(homeColors(art), width, height)),
        ]),
      );
      expect({ [art.id]: hashes }).toEqual({ [art.id]: PROVED[art.id] });
    }
  });

  it('gives Facets the tall drawing on a tall canvas and the wide one otherwise', () => {
    const facets = byId('layered-depth');
    const view = (width: number, height: number) =>
      /viewBox="([^"]+)"/.exec(facets.draw(FOREIGN, width, height))?.[1];

    expect(view(1080, 1350)).toBe('0 0 457 653');
    expect(view(1080, 1920)).toBe('0 0 457 653');
    expect(view(1080, 1080)).toBe('0 0 653 644');
    expect(view(1920, 1080)).toBe('0 0 653 644');
    expect(view(1200, 627)).toBe('0 0 653 644');
  });
});
