/**
 * The luxury art set's promises, checked on the strings it draws.
 *
 * What "beautiful and calm" means is judged by eye on a contact sheet; what
 * can be held by a test is everything a renderer, a cache and a brand kit
 * rely on: one self-contained `<svg>` at the canvas size, the same string for
 * the same input, no reference to anything outside the document, colours
 * drawn only from the four it was given (plus white and black), and geometry
 * that scales with the canvas rather than being pinned to 1080 pixels.
 */
import { hexToRgb, type Rgb } from '../color';
import { LUXURY_ARTS } from './luxury';
import type { ArtColors } from './types';

/** The four formats a design can be, as `formats.ts` sizes them. */
const SIZES: [number, number][] = [
  [1080, 1080],
  [1080, 1350],
  [1080, 1920],
  [1920, 1080],
];

const NOIR: ArtColors = {
  background: '#0C0B09',
  mid: '#4E4126',
  highlight: '#C9A45C',
  sheen: '#FFFFFF',
};

const IVORY: ArtColors = {
  background: '#F7F2E8',
  mid: '#C6B595',
  highlight: '#8A6A2F',
  sheen: '#8A6A2F',
};

/**
 * Colours nothing would pick by accident, on a dark and on a light ground
 * (the drawings branch on which it is). Each of the four is different, so a
 * hex in the output can be traced to the ones it was made from.
 */
const ODD_DARK: ArtColors = {
  background: '#1D2B3A',
  mid: '#5E8C31',
  highlight: '#E05A9B',
  sheen: '#38C7D9',
};

const ODD_LIGHT: ArtColors = {
  background: '#E9F0D2',
  mid: '#9AB0C8',
  highlight: '#7A2E14',
  sheen: '#C2185B',
};

const REQUIRED: Record<string, string> = {
  'gilded-frame': 'Gilded Frame',
  'art-deco': 'Art Deco',
  silk: 'Silk',
  spotlight: 'Spotlight',
  marble: 'Marble',
  arch: 'Arch',
  pinstripe: 'Pinstripe',
  lattice: 'Lattice',
};

function rgb(hex: string): Rgb {
  const value = hexToRgb(hex);
  if (!value) throw new Error(`not a colour: ${hex}`);
  return value;
}

/**
 * Whether `color` is a blend of `a` and `b` (either end included), allowing
 * the one unit per channel that rounding a blend to a hex can introduce.
 */
function isBlendOf(color: Rgb, a: Rgb, b: Rgb): boolean {
  const span = [b.r - a.r, b.g - a.g, b.b - a.b];
  const offset = [color.r - a.r, color.g - a.g, color.b - a.b];
  const length = span[0] ** 2 + span[1] ** 2 + span[2] ** 2;
  const along =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, (offset[0] * span[0] + offset[1] * span[1] + offset[2] * span[2]) / length),
        );
  return [0, 1, 2].every((channel) => Math.abs(offset[channel] - along * span[channel]) <= 1);
}

/** The four art colours, white and black: every colour a drawing may blend from. */
function allowedFrom(colors: ArtColors): Rgb[] {
  return [colors.background, colors.mid, colors.highlight, colors.sheen, '#FFFFFF', '#000000'].map(
    rgb,
  );
}

function isAllowed(hex: string, allowed: Rgb[]): boolean {
  const color = rgb(hex);
  return allowed.some((a, i) => allowed.slice(i).some((b) => isBlendOf(color, a, b)));
}

/** Every colour named in a paint attribute (`fill`, `stroke`, `stop-color`). */
function paints(svg: string): string[] {
  return [...svg.matchAll(/\b(?:fill|stroke|stop-color)="([^"]*)"/g)].map((match) => match[1]);
}

function ids(svg: string): string[] {
  return [...svg.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]);
}

/** Every number in the document, in order. */
function numbers(svg: string): number[] {
  return [...svg.matchAll(/-?\d*\.?\d+(?:e-?\d+)?/g)].map((match) => Number(match[0]));
}

describe('LUXURY_ARTS', () => {
  it('holds at least the eight styles of the brief, under their names', () => {
    const byId = new Map(LUXURY_ARTS.map((art) => [art.id, art.name]));
    for (const [id, name] of Object.entries(REQUIRED)) {
      expect(byId.get(id)).toBe(name);
    }
    expect(LUXURY_ARTS.length).toBeGreaterThanOrEqual(8);
  });

  it('has unique kebab-case ids and Title Case names', () => {
    const seen = new Set<string>();
    for (const art of LUXURY_ARTS) {
      expect(art.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(seen.has(art.id)).toBe(false);
      seen.add(art.id);
      expect(art.name).toMatch(/^[A-Z][a-z]*(?: [A-Z][a-z]*)*$/);
    }
  });

  it('is the luxury kind, premium, and has no home colours', () => {
    for (const art of LUXURY_ARTS) {
      expect(art.kind).toBe('luxury');
      expect(art.premium).toBe(true);
      expect(art.home).toBeUndefined();
    }
  });
});

describe.each(LUXURY_ARTS.map((art) => [art.id, art] as const))('%s', (_id, art) => {
  it.each(SIZES)('draws one svg document at %i x %i', (width, height) => {
    for (const colors of [NOIR, IVORY]) {
      const svg = art.draw(colors, width, height);
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg.split('<svg').length - 1).toBe(1);
      const root = svg.slice(0, svg.indexOf('>') + 1);
      expect(root).toContain(`width="${width}"`);
      expect(root).toContain(`height="${height}"`);
      expect(root).toContain(`viewBox="0 0 ${width} ${height}"`);
      expect(svg).not.toMatch(/NaN|Infinity|undefined|null/);
    }
  });

  it('is deterministic', () => {
    for (const [width, height] of SIZES) {
      expect(art.draw(NOIR, width, height)).toBe(art.draw(NOIR, width, height));
      expect(art.draw(ODD_LIGHT, width, height)).toBe(art.draw(ODD_LIGHT, width, height));
    }
  });

  it('refers to nothing outside the document', () => {
    for (const [width, height] of SIZES) {
      const svg = art.draw(ODD_DARK, width, height);
      expect(svg).not.toMatch(/href|<image|<use|<text|<foreignObject|<script|<style|@import|font/i);
      // The namespace is the only URL, and it is a name, not a fetch.
      expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:|data:/);

      const defined = ids(svg);
      expect(new Set(defined).size).toBe(defined.length);
      for (const [, target] of svg.matchAll(/url\(([^)]*)\)/g)) {
        expect(target.startsWith('#')).toBe(true);
        expect(defined).toContain(target.slice(1));
      }
    }
  });

  it('changes with the palette', () => {
    const [width, height] = SIZES[1];
    expect(art.draw(NOIR, width, height)).not.toBe(art.draw(IVORY, width, height));
    const brighter = { ...ODD_DARK, highlight: '#F0A040' };
    expect(art.draw(ODD_DARK, width, height)).not.toBe(art.draw(brighter, width, height));
  });

  it('paints only with the four colours it was given, white and black, and blends of two', () => {
    for (const colors of [ODD_DARK, ODD_LIGHT, NOIR, IVORY]) {
      const allowed = allowedFrom(colors);
      for (const [width, height] of SIZES) {
        const svg = art.draw(colors, width, height);
        for (const paint of paints(svg)) {
          expect(paint).toMatch(/^(?:#[0-9A-F]{6}|none|url\(#[\w-]+\))$/);
        }
        for (const [hex] of svg.matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
          if (!isAllowed(hex, allowed)) {
            throw new Error(
              `${art.id} drew ${hex}, which is not made from ${JSON.stringify(colors)}`,
            );
          }
        }
        expect(svg).not.toMatch(/rgba?\(|hsla?\(/);
      }
    }
  });

  it('scales with the canvas: at twice the size every length doubles and nothing else changes', () => {
    for (const [width, height] of SIZES) {
      const single = numbers(art.draw(NOIR, width, height));
      const double = numbers(art.draw(NOIR, width * 2, height * 2));
      expect(double).toHaveLength(single.length);
      single.forEach((value, index) => {
        const other = double[index];
        // A length doubles (within the tenth of a pixel the drawing rounds
        // to); an opacity, an offset or an id's number stays as it was.
        const scaled = Math.abs(value * 2 - other) <= 0.2;
        const kept = Math.abs(value - other) <= 0.001;
        expect(scaled || kept).toBe(true);
      });
    }
  });

  it('keeps rendering cheap: small markup, and no blur but a small one on the silk', () => {
    for (const [width, height] of SIZES) {
      const svg = art.draw(NOIR, width, height);
      expect(svg.length).toBeLessThan(64_000);
      const blurs = [...svg.matchAll(/stdDeviation="([^"]*)"/g)].map((match) => Number(match[1]));
      if (art.id === 'silk') {
        for (const blur of blurs) expect(blur).toBeLessThanOrEqual(Math.min(width, height) * 0.01);
      } else {
        expect(blurs).toEqual([]);
      }
    }
  });
});

describe('the colour check itself', () => {
  it('accepts blends and refuses a colour from nowhere', () => {
    const allowed = allowedFrom(ODD_DARK);
    expect(isAllowed('#E05A9B', allowed)).toBe(true);
    expect(isAllowed('#FFFFFF', allowed)).toBe(true);
    // Halfway from the highlight to the sheen, as `mix` rounds it.
    expect(isAllowed('#8C91BA', allowed)).toBe(true);
    expect(isAllowed('#123456', allowed)).toBe(false);
    expect(isAllowed('#C9A45C', allowed)).toBe(false);
  });
});
