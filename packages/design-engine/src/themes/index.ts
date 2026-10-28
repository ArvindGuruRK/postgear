/**
 * The colour and type themes a preset is built from.
 *
 * A theme is half a template: the other half is the layout. Ten themes across
 * twelve layouts is what turns "40 presets at launch" into a content task
 * rather than forty hand-drawn designs, and it is why swapping Theme in the
 * design panel restyles every slide at once without touching a slot.
 *
 * Each palette states every role, including the three derived inks
 * (`onPrimary`, `onAccent`, `onSurface`). They are written out rather than
 * computed so a theme's own look is exactly what the author chose; `brand.ts`
 * recomputes them when a brand kit replaces the colours, because a brand's
 * colours are not something an author saw.
 *
 * **Every pairing here clears WCAG AA**, and `themes.test.ts` fails the build
 * if a new theme breaks that. Type sizes are percentages of the canvas's
 * short edge: 9 means 97px on a 1080-wide square.
 */
import type { FontId, Palette, Theme, TypeRole, TypeStyle } from '../types';

/**
 * The shared rhythm. A theme states its two faces and the handful of sizes it
 * wants to differ; everything else comes from here, so adding a theme is a
 * palette and a line or two, not thirteen type styles.
 */
function scale(
  heading: FontId,
  body: FontId,
  overrides: Partial<Record<TypeRole, Partial<TypeStyle>>> = {},
): Record<TypeRole, TypeStyle> {
  const base: Record<TypeRole, TypeStyle> = {
    eyebrow: { font: body, weight: 600, size: 2.6, lineHeight: 1.3, tracking: 0.08 },
    headline: { font: heading, weight: 800, size: 7.6, lineHeight: 1.08, tracking: -0.02 },
    subheadline: { font: body, weight: 500, size: 3.6, lineHeight: 1.35, tracking: -0.005 },
    body: { font: body, weight: 400, size: 3.1, lineHeight: 1.5, tracking: 0 },
    list: { font: body, weight: 500, size: 3.3, lineHeight: 1.45, tracking: 0 },
    quote: { font: heading, weight: 600, size: 5.4, lineHeight: 1.25, tracking: -0.015 },
    attribution: { font: body, weight: 600, size: 2.6, lineHeight: 1.4, tracking: 0.02 },
    stat: { font: heading, weight: 800, size: 14, lineHeight: 1, tracking: -0.035 },
    statLabel: { font: body, weight: 500, size: 3, lineHeight: 1.35, tracking: 0 },
    footer: { font: body, weight: 500, size: 2.4, lineHeight: 1.4, tracking: 0 },
    brandName: { font: heading, weight: 700, size: 2.8, lineHeight: 1.2, tracking: -0.01 },
    cta: { font: heading, weight: 700, size: 4.2, lineHeight: 1.2, tracking: -0.01 },
    pageNumber: { font: body, weight: 600, size: 2.2, lineHeight: 1, tracking: 0.02 },
  };

  for (const [role, patch] of Object.entries(overrides) as Array<[TypeRole, Partial<TypeStyle>]>) {
    base[role] = { ...base[role], ...patch };
  }

  return base;
}

function palette(colors: Palette): Palette {
  return colors;
}

export const THEMES: Theme[] = [
  {
    id: 'ink',
    name: 'Ink',
    style: 'light',
    colors: palette({
      background: '#FFFFFF',
      surface: '#F2F2F0',
      primary: '#111111',
      secondary: '#555555',
      accent: '#C2410C',
      text: '#111111',
      textMuted: '#5B5B5B',
      onPrimary: '#FFFFFF',
      onAccent: '#FFF6F2',
      onSurface: '#111111',
    }),
    type: scale('sora', 'inter'),
  },
  {
    id: 'midnight',
    name: 'Midnight',
    style: 'dark',
    colors: palette({
      background: '#0E1116',
      surface: '#1A1F27',
      primary: '#4F8CFF',
      secondary: '#8A93A5',
      accent: '#FFD166',
      text: '#F5F7FA',
      textMuted: '#AAB3C0',
      onPrimary: '#06101F',
      onAccent: '#1A1400',
      onSurface: '#F5F7FA',
    }),
    type: scale('sora', 'inter'),
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    style: 'colourful',
    colors: palette({
      background: '#FFF4E8',
      surface: '#FFE6CC',
      primary: '#A8380A',
      secondary: '#7A3F19',
      accent: '#1D7A6B',
      text: '#2B1A0E',
      textMuted: '#6B4A33',
      onPrimary: '#FFF7F0',
      onAccent: '#F2FFFC',
      onSurface: '#2B1A0E',
    }),
    type: scale('poppins', 'poppins'),
  },
  {
    id: 'bold',
    name: 'Bold',
    style: 'colourful',
    colors: palette({
      background: '#FFE94A',
      surface: '#111111',
      primary: '#111111',
      secondary: '#3B3B3B',
      accent: '#A01008',
      text: '#111111',
      textMuted: '#4A4A2A',
      onPrimary: '#FFE94A',
      onAccent: '#FFFFFF',
      onSurface: '#FFE94A',
    }),
    type: scale('archivo-black', 'space-grotesk', {
      headline: { size: 8.4, tracking: -0.03, lineHeight: 1.02 },
      cta: { size: 4.6 },
    }),
  },
  {
    id: 'editorial',
    name: 'Editorial',
    style: 'light',
    colors: palette({
      background: '#FBF8F3',
      surface: '#EFE7DA',
      primary: '#2F3E35',
      secondary: '#7A6A55',
      accent: '#B4522F',
      text: '#1F2621',
      textMuted: '#5E6A61',
      onPrimary: '#FBF8F3',
      onAccent: '#FFF6F2',
      onSurface: '#1F2621',
    }),
    type: scale('playfair-display', 'inter', {
      headline: { weight: 700, size: 7.2, tracking: -0.012, lineHeight: 1.12 },
      quote: { weight: 400, italic: true, size: 5.6 },
      eyebrow: { tracking: 0.12 },
    }),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    style: 'dark',
    colors: palette({
      background: '#062A3A',
      surface: '#0C3B4F',
      primary: '#3DD6C4',
      secondary: '#7FA8B8',
      accent: '#FF8A5B',
      text: '#EAF6F8',
      textMuted: '#A8C6CF',
      onPrimary: '#042028',
      onAccent: '#2A0F04',
      onSurface: '#EAF6F8',
    }),
    type: scale('space-grotesk', 'inter'),
  },
  {
    id: 'blossom',
    name: 'Blossom',
    style: 'colourful',
    colors: palette({
      background: '#FDF1F4',
      surface: '#F9DCE4',
      primary: '#A8285C',
      secondary: '#7A5A66',
      accent: '#3F6E4F',
      text: '#36131F',
      textMuted: '#6E4857',
      onPrimary: '#FFF3F7',
      onAccent: '#F1FBF3',
      onSurface: '#36131F',
    }),
    type: scale('dm-serif-display', 'poppins', {
      headline: { weight: 400, size: 7.8, tracking: -0.005, lineHeight: 1.1 },
      quote: { weight: 400, size: 5.8 },
    }),
  },
  {
    id: 'slate',
    name: 'Slate',
    style: 'light',
    colors: palette({
      background: '#EEF1F4',
      surface: '#FFFFFF',
      primary: '#1F3A5F',
      secondary: '#5A6B80',
      accent: '#C2410C',
      text: '#18212B',
      textMuted: '#52606D',
      onPrimary: '#F2F6FA',
      onAccent: '#FFF7F2',
      onSurface: '#18212B',
    }),
    type: scale('inter', 'inter', {
      headline: { weight: 800, size: 7.2, tracking: -0.025 },
    }),
  },
  {
    id: 'terminal',
    name: 'Terminal',
    style: 'dark',
    colors: palette({
      background: '#101410',
      surface: '#1A221A',
      primary: '#7CE38B',
      secondary: '#8A9A8A',
      accent: '#E3C67C',
      text: '#E8F0E8',
      textMuted: '#A5B5A5',
      onPrimary: '#06140A',
      onAccent: '#1A1405',
      onSurface: '#E8F0E8',
    }),
    type: scale('jetbrains-mono', 'jetbrains-mono', {
      headline: { weight: 700, size: 6.4, tracking: -0.02, lineHeight: 1.18 },
      eyebrow: { tracking: 0.14 },
      stat: { size: 12 },
    }),
  },
  {
    id: 'violet',
    name: 'Violet',
    style: 'colourful',
    colors: palette({
      background: '#F3EEFF',
      surface: '#E4D9FF',
      primary: '#5B21B6',
      secondary: '#6D6189',
      accent: '#A8154F',
      text: '#241544',
      textMuted: '#584A75',
      onPrimary: '#F6F2FF',
      onAccent: '#FFF1F7',
      onSurface: '#241544',
    }),
    type: scale('space-grotesk', 'poppins'),
  },
];

/**
 * A `Map`, not an object: a stored `themeId` of `"toString"` must miss, and on
 * a plain object it would find `Object.prototype.toString`.
 */
const BY_ID: ReadonlyMap<string, Theme> = new Map(THEMES.map((theme) => [theme.id, theme]));

export const DEFAULT_THEME_ID = 'ink';

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

/** The theme, or the default one for an id that no longer exists. */
export function themeById(id: string): Theme {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_THEME_ID) as Theme);
}

/** Every font a theme uses, for the exporter's "inline only what this needs". */
export function fontsOf(theme: Theme): FontId[] {
  return [...new Set(Object.values(theme.type).map((style) => style.font))];
}
