/**
 * The theme catalog: the single source of truth for which light and dark
 * themes exist, what they are called, and which are premium.
 *
 * Pure data and pure functions, like `billing/plans.ts`: no Nest, no Prisma.
 * `GET /users/me/appearance` serves this list to the Appearance settings page,
 * which draws each card's mini preview from `swatch` without loading any of
 * the theme CSS, and `PATCH` validates an id against it.
 *
 * ## Two lists, one shape
 *
 * Light and dark themes are separate lists (`LIGHT_THEMES`, `DARK_THEMES`),
 * and every entry also carries its `mode`, so the API can serve them as one
 * array (`THEMES`) and the page can group it. Ids are only unique within a
 * mode: `classic` is both the default light theme and the default dark one.
 * That is why every lookup below takes the mode first.
 *
 * ## The CSS is the other half
 *
 * Each id here has a matching block in `packages/ui/src/styles/colors.css`:
 * `.light[data-light-theme='<id>']` or `.dark[data-dark-theme='<id>']`.
 * `classic` is the base `.light` / `.dark` block in each mode and has no
 * attribute. The swatch hexes are copies of that block's page / chrome / card
 * / field / ink / outline values, kept in step by hand; a theme added here
 * without its CSS block would preview correctly and then render as Classic.
 * `accent` is the brand blue, the same for every theme (brand fills never
 * change with the theme); it is carried so the preview's button chip needs no
 * CSS either.
 *
 * ## Order is display order
 *
 * In each mode, the free themes first, Classic (the default) leading, then the
 * premium ones.
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeSwatch {
  /** The page ground (`--color-primary`). */
  page: string;
  /** The app frame: sidebar and top bar (`--color-chrome`). */
  chrome: string;
  /** Cards and other surfaces (`--color-secondary`). */
  card: string;
  /** Form fields (`--color-field`). */
  field: string;
  /** Text and icons (`--color-ink`). */
  ink: string;
  /** Borders and the hard shadows (`--color-outline`). */
  outline: string;
  /** The primary action fill: the brand blue in every theme. */
  accent: string;
}

export interface Theme {
  id: string;
  /** Which scheme it belongs to; the same id can exist in both. */
  mode: ThemeMode;
  name: string;
  /** Usable only while a workspace the user belongs to is on a paid plan or trial. */
  premium: boolean;
  swatch: ThemeSwatch;
}

/**
 * What a user gets with no choice made, and what a lapsed premium choice
 * falls back to, in either mode: the original light and dark looks.
 */
export const DEFAULT_THEME = 'classic';
export const DEFAULT_LIGHT_THEME = DEFAULT_THEME;
export const DEFAULT_DARK_THEME = DEFAULT_THEME;

const BRAND_BLUE = '#1d4ed8';

type Entry = Omit<Theme, 'mode' | 'swatch'> & { swatch: Omit<ThemeSwatch, 'accent'> };

function catalog(mode: ThemeMode, entries: Entry[]): readonly Theme[] {
  return entries.map((entry) => ({
    ...entry,
    mode,
    swatch: { ...entry.swatch, accent: BRAND_BLUE },
  }));
}

export const LIGHT_THEMES: readonly Theme[] = catalog('light', [
  {
    id: 'classic',
    name: 'Classic',
    premium: false,
    swatch: {
      page: '#fff8e7',
      chrome: '#ffffff',
      card: '#ffffff',
      field: '#ffffff',
      ink: '#0a0a0a',
      outline: '#0a0a0a',
    },
  },
  {
    id: 'cream',
    name: 'Cream',
    premium: false,
    swatch: {
      page: '#fff8e7',
      chrome: '#ffeec2',
      card: '#fffdf7',
      field: '#ffffff',
      ink: '#0a0a0a',
      outline: '#0a0a0a',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    premium: false,
    swatch: {
      page: '#f4f3ee',
      chrome: '#e8e6dd',
      card: '#fbfaf7',
      field: '#ffffff',
      ink: '#111111',
      outline: '#111111',
    },
  },
  {
    id: 'white',
    name: 'White',
    premium: false,
    swatch: {
      page: '#f5f5f3',
      chrome: '#ffffff',
      card: '#ffffff',
      field: '#ffffff',
      ink: '#0a0a0a',
      outline: '#0a0a0a',
    },
  },
  {
    id: 'cool',
    name: 'Cool',
    premium: false,
    swatch: {
      page: '#eef1f7',
      chrome: '#dfe6f2',
      card: '#f9fbff',
      field: '#ffffff',
      ink: '#0f172a',
      outline: '#0f172a',
    },
  },
  {
    id: 'lilac',
    name: 'Lilac',
    premium: false,
    swatch: {
      page: '#ece9fb',
      chrome: '#d9d2fb',
      card: '#f8f7ff',
      field: '#ffffff',
      ink: '#0a0a0a',
      outline: '#000000',
    },
  },
  {
    id: 'mint',
    name: 'Mint',
    premium: true,
    swatch: {
      page: '#eaf6ee',
      chrome: '#cdebd9',
      card: '#f7fdf9',
      field: '#ffffff',
      ink: '#052e1a',
      outline: '#052e1a',
    },
  },
  {
    id: 'grape',
    name: 'Grape',
    premium: true,
    swatch: {
      page: '#f3eafb',
      chrome: '#e4cff6',
      card: '#fcf8ff',
      field: '#ffffff',
      ink: '#1f0a33',
      outline: '#1f0a33',
    },
  },
  {
    id: 'peach',
    name: 'Peach',
    premium: true,
    swatch: {
      page: '#fff1e8',
      chrome: '#ffdcc7',
      card: '#fffaf6',
      field: '#ffffff',
      ink: '#2a1206',
      outline: '#2a1206',
    },
  },
  {
    id: 'sky',
    name: 'Sky',
    premium: true,
    swatch: {
      page: '#eaf5fd',
      chrome: '#cfe8fa',
      card: '#f7fcff',
      field: '#ffffff',
      ink: '#0b2239',
      outline: '#0b2239',
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    premium: true,
    swatch: {
      page: '#fdedf0',
      chrome: '#f9d3dc',
      card: '#fff8f9',
      field: '#ffffff',
      ink: '#2b0a13',
      outline: '#2b0a13',
    },
  },
  {
    id: 'lemon',
    name: 'Lemon',
    premium: true,
    swatch: {
      page: '#fbf8d6',
      chrome: '#f3ea9a',
      card: '#fffef2',
      field: '#ffffff',
      ink: '#2a2406',
      outline: '#2a2406',
    },
  },
]);

export const DARK_THEMES: readonly Theme[] = catalog('dark', [
  {
    id: 'classic',
    name: 'Classic',
    premium: false,
    swatch: {
      page: '#121212',
      chrome: '#2a2a2a',
      card: '#2a2a2a',
      field: '#2a2a2a',
      ink: '#f5f5f5',
      outline: '#050505',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    premium: false,
    swatch: {
      page: '#0b1120',
      chrome: '#131c33',
      card: '#18223c',
      field: '#232e4e',
      ink: '#e6ebf7',
      outline: '#02050d',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    premium: false,
    swatch: {
      page: '#0b1510',
      chrome: '#12221a',
      card: '#17291f',
      field: '#1e3428',
      ink: '#e4f1e8',
      outline: '#020805',
    },
  },
  {
    id: 'plum',
    name: 'Plum',
    premium: false,
    swatch: {
      page: '#140d1c',
      chrome: '#1f142b',
      card: '#261a33',
      field: '#352641',
      ink: '#f0e7f7',
      outline: '#07030b',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    premium: false,
    swatch: {
      page: '#071518',
      chrome: '#0e2226',
      card: '#12292e',
      field: '#183439',
      ink: '#e0f2f3',
      outline: '#010708',
    },
  },
  {
    id: 'mocha',
    name: 'Mocha',
    premium: false,
    swatch: {
      page: '#16100c',
      chrome: '#231a14',
      card: '#2a2019',
      field: '#392c23',
      ink: '#f5ebe1',
      outline: '#070402',
    },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    premium: true,
    swatch: {
      page: '#000000',
      chrome: '#0a0a0a',
      card: '#141414',
      field: '#1c1c1c',
      ink: '#f2f2f2',
      outline: '#3d3d3d',
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    premium: true,
    swatch: {
      page: '#110c22',
      chrome: '#1c1538',
      card: '#221a40',
      field: '#2f2656',
      ink: '#ece8ff',
      outline: '#05030d',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    premium: true,
    swatch: {
      page: '#170b09',
      chrome: '#261310',
      card: '#2d1814',
      field: '#3e2520',
      ink: '#f8e9e4',
      outline: '#080302',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    premium: true,
    swatch: {
      page: '#08171a',
      chrome: '#1d1638',
      card: '#102629',
      field: '#17343c',
      ink: '#e3f4f2',
      outline: '#02080a',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    premium: true,
    swatch: {
      page: '#10141a',
      chrome: '#1a2029',
      card: '#1f2630',
      field: '#28303c',
      ink: '#e8edf3',
      outline: '#04060a',
    },
  },
  {
    id: 'orchid',
    name: 'Orchid',
    premium: true,
    swatch: {
      page: '#170a17',
      chrome: '#291029',
      card: '#311631',
      field: '#432241',
      ink: '#fbe8f7',
      outline: '#060206',
    },
  },
]);

/** Both lists, light first: what `GET /users/me/appearance` serves. */
export const THEMES: readonly Theme[] = [...LIGHT_THEMES, ...DARK_THEMES];

const BY_MODE: Record<ThemeMode, ReadonlyMap<string, Theme>> = {
  light: new Map(LIGHT_THEMES.map((theme) => [theme.id, theme])),
  dark: new Map(DARK_THEMES.map((theme) => [theme.id, theme])),
};

export function isThemeId(mode: ThemeMode, value: unknown): value is string {
  return typeof value === 'string' && BY_MODE[mode].has(value);
}

export function themeById(mode: ThemeMode, id: string): Theme | undefined {
  return BY_MODE[mode].get(id);
}

export function isPremiumTheme(mode: ThemeMode, id: string): boolean {
  return BY_MODE[mode].get(id)?.premium ?? false;
}

/**
 * The theme a user actually sees in one mode. A premium id stays stored when
 * the plan behind it lapses (so it comes back by itself on re-subscribing) but
 * is served as Classic until then. An id no longer in the catalog (a theme
 * that was retired) also reads as Classic.
 */
export function effectiveTheme(
  mode: ThemeMode,
  storedId: string,
  premiumUnlocked: boolean,
): string {
  const theme = BY_MODE[mode].get(storedId);

  if (!theme || (theme.premium && !premiumUnlocked)) {
    return DEFAULT_THEME;
  }

  return theme.id;
}
