import {
  AA_CONTRAST,
  BRAND_COLOR_KEYS,
  colorDistance,
  contrastRatio,
  normalizeHex,
} from '@postgear/design-engine';
import {
  GROUND_OPTIONS,
  groundOf,
  type KitGround,
  paletteFromColor,
  TEXT_CONTRAST,
} from './kit-palette-model';

/** Every hue in 15 degree steps at three lightnesses, greys from black to white, and some brand colours. */
function seeds(): string[] {
  const out: string[] = [];
  for (let hue = 0; hue < 360; hue += 15) {
    for (const [s, l] of [
      [0.9, 0.5],
      [0.6, 0.25],
      [0.8, 0.82],
    ]) {
      out.push(hsl(hue, s, l));
    }
  }
  for (const grey of [
    '#000000',
    '#111111',
    '#555555',
    '#808080',
    '#BBBBBB',
    '#F2F2F2',
    '#FFFFFF',
  ]) {
    out.push(grey);
  }
  out.push('#2563EB', '#FFE94A', '#16A34A', '#A8285C', '#5B21B6', '#0EA5E9', '#F97316');
  return out;
}

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const GROUNDS: KitGround[] = ['light', 'dark'];

describe('paletteFromColor', () => {
  it('keeps the colour given as Primary, exactly', () => {
    expect(paletteFromColor('#2563eb')?.primary).toBe('#2563EB');
    expect(paletteFromColor('2563EB', 'dark')?.primary).toBe('#2563EB');
    expect(paletteFromColor('#abc')?.primary).toBe('#AABBCC');
  });

  it('answers null for something that is not a colour', () => {
    expect(paletteFromColor('')).toBeNull();
    expect(paletteFromColor('blue')).toBeNull();
    expect(paletteFromColor('#12345')).toBeNull();
  });

  it('gives all five colours as six-digit hex', () => {
    const palette = paletteFromColor('#16A34A');
    for (const key of BRAND_COLOR_KEYS) {
      expect(palette?.[key]).toMatch(/^#[0-9A-F]{6}$/);
      expect(normalizeHex(palette?.[key] ?? '')).toBe(palette?.[key]);
    }
  });

  /** Every seed and ground whose `role` reads below `ratio` on the background, named. */
  function below(role: 'text' | 'secondary' | 'accent', ratio: number): string[] {
    const failures: string[] = [];
    for (const ground of GROUNDS) {
      for (const seed of seeds()) {
        const palette = paletteFromColor(seed, ground);
        const found = palette ? contrastRatio(palette[role], palette.background) : 0;
        if (found < ratio) failures.push(`${seed} on ${ground}: ${found.toFixed(2)}`);
      }
    }
    return failures;
  }

  it('puts Text at 7:1 or more on Background, for any colour on either ground', () => {
    expect(below('text', TEXT_CONTRAST)).toEqual([]);
  });

  it('puts Secondary and Accent at AA or more on Background, for any colour on either ground', () => {
    expect(below('secondary', AA_CONTRAST)).toEqual([]);
    expect(below('accent', AA_CONTRAST)).toEqual([]);
  });

  it('lays a near-white ground for light and a near-black one for dark', () => {
    for (const seed of seeds()) {
      expect(
        contrastRatio(paletteFromColor(seed, 'light')?.background ?? '', '#FFFFFF'),
      ).toBeLessThan(1.15);
      // A green that dark is still a little brighter than a blue, as the eye sees it.
      expect(
        contrastRatio(paletteFromColor(seed, 'dark')?.background ?? '', '#000000'),
      ).toBeLessThan(1.4);
    }
  });

  it('gives an accent that stands apart from the primary', () => {
    for (const seed of ['#2563EB', '#16A34A', '#A8285C', '#F97316', '#808080', '#111111']) {
      const palette = paletteFromColor(seed);
      expect(colorDistance(palette?.accent ?? '', palette?.primary ?? '')).toBeGreaterThan(0.15);
    }
  });

  it('turns a blue to a warm accent, and gives a grey an orange one', () => {
    const blue = paletteFromColor('#2563EB');
    const grey = paletteFromColor('#808080');
    // Warm: more red than blue.
    for (const accent of [blue?.accent, grey?.accent]) {
      const value = Number.parseInt((accent ?? '#000000').slice(1), 16);
      expect((value >> 16) & 255).toBeGreaterThan(value & 255);
    }
  });
});

describe('groundOf', () => {
  it('reads a background that takes light text as a dark ground', () => {
    expect(groundOf('#0E1116')).toBe('dark');
    expect(groundOf('#062A3A')).toBe('dark');
  });

  it('reads any other background as light, and something not yet a colour too', () => {
    expect(groundOf('#FFFFFF')).toBe('light');
    expect(groundOf('#FFE94A')).toBe('light');
    expect(groundOf('#FFF4E8')).toBe('light');
    expect(groundOf('#12')).toBe('light');
  });

  it('agrees with the palettes it makes', () => {
    for (const ground of GROUNDS) {
      expect(groundOf(paletteFromColor('#2563EB', ground)?.background ?? '')).toBe(ground);
    }
  });

  it('offers Light and Dark, in that order', () => {
    expect(GROUND_OPTIONS.map((option) => option.label)).toEqual(['Light', 'Dark']);
  });
});
