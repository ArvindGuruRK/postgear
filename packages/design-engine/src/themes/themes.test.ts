/**
 * Guards the one promise a theme makes: everything it pairs can be read.
 *
 * A new theme is a palette somebody chose by eye, and an eye is exactly what
 * misses a 4.1:1 pairing. This runs the numbers on every role combination the
 * layouts actually draw, so a theme that cannot be read never reaches a user.
 *
 * It also holds the three collections to what they claim: Classic is Sprint
 * 9's ten, untouched; Signature is CarouselClick's palettes on their exact
 * grounds, in its type; Luxury is premium, in the luxury serifs, and never
 * asks a family for a weight it does not have.
 */
import { AA_CONTRAST, contrastRatio, hexToRgb } from '../color';
import { FONTS, resolveWeight } from '../fonts';
import {
  COLOR_FAMILIES,
  COLOR_ROLES,
  type ColorFamily,
  type ColorRole,
  type FontId,
} from '../types';
import {
  CLASSIC_THEME_IDS,
  CLASSIC_THEMES,
  DEFAULT_THEME_ID,
  fontsOf,
  isThemeId,
  LUXURY_THEME_IDS,
  LUXURY_THEMES,
  SIGNATURE_THEME_IDS,
  SIGNATURE_THEMES,
  THEMES,
  themeById,
  themeCollection,
} from './index';

/** The pairings the layouts use: ink on the ground it is drawn on. */
const PAIRS: Array<[ink: ColorRole, ground: ColorRole]> = [
  ['text', 'background'],
  ['textMuted', 'background'],
  ['accent', 'background'],
  ['primary', 'background'],
  ['onPrimary', 'primary'],
  ['onAccent', 'accent'],
  ['onSurface', 'surface'],
];

const HEX = /^#[0-9A-F]{6}$/;

describe('every theme', () => {
  it('states every colour role', () => {
    for (const theme of THEMES) {
      for (const role of COLOR_ROLES) {
        expect(theme.colors[role]).toMatch(HEX);
      }
    }
  });

  it('clears WCAG AA on every pairing a layout draws', () => {
    const failures: string[] = [];

    for (const theme of THEMES) {
      for (const [ink, ground] of PAIRS) {
        const ratio = contrastRatio(theme.colors[ink], theme.colors[ground]);
        if (ratio < AA_CONTRAST) {
          failures.push(`${theme.id}: ${ink} on ${ground} is ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('names only fonts the package bundles', () => {
    for (const theme of THEMES) {
      for (const font of fontsOf(theme)) {
        expect(FONTS[font]).toBeDefined();
      }
    }
  });

  it('has a unique id and a name', () => {
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
    for (const theme of THEMES) expect(theme.name.trim()).not.toBe('');
  });

  it('is named in Title Case, every word capitalised', () => {
    const titleCase = /^[A-Z0-9]\S*(?: [A-Z0-9]\S*)*$/;
    expect(THEMES.filter((theme) => !titleCase.test(theme.name)).map(({ name }) => name)).toEqual(
      [],
    );
  });

  it('names a colour family the gallery filters by', () => {
    for (const theme of THEMES) expect(COLOR_FAMILIES).toContain(theme.family);
  });

  it('pins art colours, when it pins any, as hex', () => {
    for (const theme of THEMES) {
      if (!theme.art) continue;
      expect(theme.art.mid).toMatch(HEX);
      expect(theme.art.highlight).toMatch(HEX);
    }
  });

  it('covers all three styles the gallery filters by', () => {
    const styles = new Set(THEMES.map((theme) => theme.style));
    expect(styles).toEqual(new Set(['light', 'dark', 'colourful']));
  });

  it('sizes a headline larger than its body copy', () => {
    for (const theme of THEMES) {
      expect(theme.type.headline.size).toBeGreaterThan(theme.type.body.size);
      expect(theme.type.stat.size).toBeGreaterThan(theme.type.headline.size);
      expect(theme.type.footer.size).toBeLessThan(theme.type.body.size);
    }
  });

  it('never sets text in capitals', () => {
    // The house rule is no all-caps text, in a design as in the app.
    for (const theme of THEMES) {
      for (const style of Object.values(theme.type)) expect(style.uppercase).toBeFalsy();
    }
  });
});

describe('the collections', () => {
  it('keeps Sprint 9 ids at the front, in order: designs name them', () => {
    const sprint9 = [
      'ink',
      'midnight',
      'sunrise',
      'bold',
      'editorial',
      'ocean',
      'blossom',
      'slate',
      'terminal',
      'violet',
    ];

    expect(CLASSIC_THEME_IDS).toEqual(sprint9);
    expect(THEMES.slice(0, sprint9.length).map((theme) => theme.id)).toEqual(sprint9);
  });

  it('puts every theme in exactly one collection', () => {
    expect([...CLASSIC_THEME_IDS, ...SIGNATURE_THEME_IDS, ...LUXURY_THEME_IDS]).toEqual(
      THEMES.map((theme) => theme.id),
    );

    for (const id of CLASSIC_THEME_IDS) expect(themeCollection(id)).toBe('classic');
    for (const id of SIGNATURE_THEME_IDS) expect(themeCollection(id)).toBe('signature');
    for (const id of LUXURY_THEME_IDS) expect(themeCollection(id)).toBe('luxury');
  });

  it('locks the luxury themes to paid plans, and no other', () => {
    for (const theme of LUXURY_THEMES) expect(theme.premium).toBe(true);
    for (const theme of [...CLASSIC_THEMES, ...SIGNATURE_THEMES]) {
      expect(theme.premium).not.toBe(true);
    }
  });
});

/**
 * CarouselClick's palettes, copied from its `src/features/templates/
 * templates.ts` (`PALETTES`, and `BRAND_DARK` on the three grounds of its
 * hand-made backgrounds), so a slip in `signature.ts` cannot quietly agree
 * with itself. `accent` is its eyebrow and footer ink, `highlight` its
 * brightest art colour.
 */
const CAROUSELCLICK: Record<
  string,
  {
    family: ColorFamily;
    style: 'dark' | 'light';
    background: string;
    accent: string;
    text: string;
    body: string;
    mid: string;
    highlight: string;
  }
> = {
  forest: {
    family: 'green',
    style: 'dark',
    background: '#023D1E',
    accent: '#B8FF35',
    text: '#FAFFE9',
    body: '#E7F8EC',
    mid: '#0B6B35',
    highlight: '#B8FF35',
  },
  nocturne: {
    family: 'green',
    style: 'dark',
    background: '#05011A',
    accent: '#69E57D',
    text: '#F8F6FF',
    body: '#D7D0E6',
    mid: '#2B1E6B',
    highlight: '#69E57D',
  },
  lagoon: {
    family: 'teal',
    style: 'dark',
    background: '#0C2B2D',
    accent: '#3EE6C5',
    text: '#F2FFFC',
    body: '#CDEDE7',
    mid: '#004D43',
    highlight: '#D0FF71',
  },
  'deep-sea': {
    family: 'blue',
    style: 'dark',
    background: '#04172B',
    accent: '#4FB3FF',
    text: '#F3F8FF',
    body: '#C9DAEE',
    mid: '#0B3D7A',
    highlight: '#4FB3FF',
  },
  amethyst: {
    family: 'purple',
    style: 'dark',
    background: '#140A2B',
    accent: '#A98BFF',
    text: '#F7F3FF',
    body: '#D9D0F0',
    mid: '#4B2A99',
    highlight: '#C3A8FF',
  },
  ember: {
    family: 'orange',
    style: 'dark',
    background: '#1E0C06',
    accent: '#FF8A4C',
    text: '#FFF6F0',
    body: '#EBD5C8',
    mid: '#7A2A0E',
    highlight: '#FF9A5C',
  },
  graphite: {
    family: 'mono',
    style: 'dark',
    background: '#111114',
    accent: '#E6E6EA',
    text: '#FFFFFF',
    body: '#C9C9D1',
    mid: '#34343C',
    highlight: '#F2F2F5',
  },
  mint: {
    family: 'green',
    style: 'light',
    background: '#EBFFF6',
    accent: '#0E9F5A',
    text: '#06281A',
    body: '#2D4A3D',
    mid: '#9FF0C6',
    highlight: '#C6FF5C',
  },
  paper: {
    family: 'purple',
    style: 'light',
    background: '#F6F4EE',
    accent: '#5B3FD9',
    text: '#17141F',
    body: '#45404F',
    mid: '#D9CCFF',
    highlight: '#8B6CFF',
  },
  sky: {
    family: 'blue',
    style: 'light',
    background: '#EEF5FF',
    accent: '#2F6FE4',
    text: '#0B1B33',
    body: '#3A4A63',
    mid: '#BFD8FF',
    highlight: '#5FB0FF',
  },
  nightfall: {
    family: 'green',
    style: 'dark',
    background: '#05011A',
    accent: '#B8FF35',
    text: '#FAFFE9',
    body: '#E7F8EC',
    mid: '#0B6B35',
    highlight: '#B8FF35',
  },
  evergreen: {
    family: 'green',
    style: 'dark',
    background: '#025226',
    accent: '#B8FF35',
    text: '#FAFFE9',
    body: '#E7F8EC',
    mid: '#0B6B35',
    highlight: '#B8FF35',
  },
  spruce: {
    family: 'teal',
    style: 'dark',
    background: '#162D2F',
    accent: '#B8FF35',
    text: '#FAFFE9',
    body: '#E7F8EC',
    mid: '#0B6B35',
    highlight: '#B8FF35',
  },
};

/** The colours `signature.ts` replaced because CarouselClick's fail AA as text there. */
const READABLE: Record<string, { primary?: string; accent?: string }> = {
  mint: { primary: '#067D46', accent: '#5C7E01' },
  paper: { accent: '#7755E6' },
  sky: { primary: '#2362D6', accent: '#1C73BE' },
};

/** HSL hue in degrees, for "the same hue". */
function hue(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return Number.NaN;

  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;

  const sector =
    max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return sector * 60;
}

describe('the signature themes', () => {
  it('are one per CarouselClick palette and hand-made ground, on its exact background', () => {
    expect([...SIGNATURE_THEME_IDS].sort()).toEqual(Object.keys(CAROUSELCLICK).sort());

    for (const theme of SIGNATURE_THEMES) {
      const source = CAROUSELCLICK[theme.id];
      expect(theme.colors.background).toBe(source.background);
      expect(theme.family).toBe(source.family);
      expect(theme.style).toBe(source.style);
    }
  });

  it("take CarouselClick's inks, and pin its art colours exactly", () => {
    for (const theme of SIGNATURE_THEMES) {
      const source = CAROUSELCLICK[theme.id];
      const readable = READABLE[theme.id] ?? {};

      expect(theme.colors.text).toBe(source.text);
      expect(theme.colors.textMuted).toBe(source.body);
      expect(theme.colors.secondary).toBe(source.mid);
      expect(theme.colors.primary).toBe(readable.primary ?? source.accent);
      expect(theme.colors.accent).toBe(readable.accent ?? source.highlight);
      expect(theme.art).toEqual({ mid: source.mid, highlight: source.highlight });
    }
  });

  it('replace a colour only where it fails as text, with a passing shade of the same hue', () => {
    for (const [id, replaced] of Object.entries(READABLE)) {
      const source = CAROUSELCLICK[id];
      const pairs: Array<[original: string, used: string | undefined]> = [
        [source.accent, replaced.primary],
        [source.highlight, replaced.accent],
      ];

      for (const [original, used] of pairs) {
        if (!used) continue;
        expect(contrastRatio(original, source.background)).toBeLessThan(AA_CONTRAST);
        expect(contrastRatio(used, source.background)).toBeGreaterThanOrEqual(AA_CONTRAST);
        expect(Math.abs(hue(used) - hue(original))).toBeLessThan(8);
      }
    }
  });

  it('set the eyebrow, footer and call to action colour (primary) where it reads', () => {
    for (const theme of SIGNATURE_THEMES) {
      expect(contrastRatio(theme.colors.primary, theme.colors.background)).toBeGreaterThanOrEqual(
        AA_CONTRAST,
      );
    }
  });

  it("are set in Manrope at CarouselClick's hierarchy, with letter spacing 0", () => {
    for (const theme of SIGNATURE_THEMES) {
      const { type } = theme;

      expect(fontsOf(theme)).toEqual(['manrope']);
      expect(type.headline).toMatchObject({ size: 8.5, weight: 820, lineHeight: 1.08 });
      expect(type.eyebrow).toMatchObject({ size: 2.8, weight: 800, lineHeight: 1.08 });
      expect(type.subheadline).toMatchObject({ size: 4.1, weight: 720, lineHeight: 1.2 });
      expect(type.cta).toMatchObject({ size: 5.2, weight: 820, lineHeight: 1.12 });
      expect(type.stat.size).toBe(12.2);
      for (const style of Object.values(type)) expect(style.tracking).toBe(0);
    }
  });
});

/** The heading families the luxury set is drawn from, and the clean sans it sets text in. */
const LUXURY_SERIFS: ReadonlySet<FontId> = new Set<FontId>([
  'cormorant-garamond',
  'bodoni-moda',
  'cinzel',
  'italiana',
  'marcellus',
  'fraunces',
  'instrument-serif',
  'playfair-display',
]);
const CLEAN_SANS: ReadonlySet<FontId> = new Set<FontId>([
  'manrope',
  'dm-sans',
  'montserrat',
  'outfit',
  'plus-jakarta-sans',
  'inter',
]);
const SCRIPTS: ReadonlySet<FontId> = new Set<FontId>(['great-vibes', 'allura']);

describe('the luxury themes', () => {
  it('are at least ten, in the luxury colour families', () => {
    const families: ColorFamily[] = ['gold', 'green', 'red', 'blue', 'pink', 'neutral', 'mono'];

    expect(LUXURY_THEMES.length).toBeGreaterThanOrEqual(10);
    for (const theme of LUXURY_THEMES) {
      expect(families).toContain(theme.family);
      expect(['light', 'dark']).toContain(theme.style);
    }
  });

  it('pin their art in their own metallic tones', () => {
    for (const theme of LUXURY_THEMES) expect(theme.art).toBeDefined();
  });

  it('set headings in a luxury serif and text in a clean sans, a script only on a headline', () => {
    for (const theme of LUXURY_THEMES) {
      for (const [role, style] of Object.entries(theme.type)) {
        const label = `${theme.id} ${role}: ${style.font}`;

        if (style.face === 'body') {
          expect([label, CLEAN_SANS.has(style.font)]).toEqual([label, true]);
        } else if (SCRIPTS.has(style.font)) {
          expect([label, role]).toEqual([label, 'headline']);
        } else {
          expect([label, LUXURY_SERIFS.has(style.font)]).toEqual([label, true]);
        }
      }
    }
  });

  it('ask each family only for a weight it has, so nothing is silently clamped', () => {
    const clamped = LUXURY_THEMES.flatMap((theme) =>
      Object.entries(theme.type)
        .filter(([, style]) => resolveWeight(style.font, style.weight) !== style.weight)
        .map(([role, style]) => `${theme.id} ${role}: ${style.font} has no ${style.weight}`),
    );

    expect(clamped).toEqual([]);
  });

  it('never ask for an italic: the font pack has no italic files', () => {
    for (const theme of LUXURY_THEMES) {
      for (const style of Object.values(theme.type)) expect(style.italic).toBeFalsy();
    }
  });
});

describe('themeById', () => {
  it('falls back rather than returning nothing', () => {
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true);
    expect(themeById('not-a-theme').id).toBe(DEFAULT_THEME_ID);
    expect(themeCollection('not-a-theme')).toBe('classic');
  });

  it('never finds a name from the object prototype', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(isThemeId(name)).toBe(false);
      expect(themeById(name).id).toBe(DEFAULT_THEME_ID);
      expect(themeCollection(name)).toBe('classic');
    }
  });
});
