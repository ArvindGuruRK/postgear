/**
 * The Luxury collection: PostGear's own premium themes.
 *
 * Two kinds of ground, the two a jeweller, a hotel or a fashion house posts
 * on: **deep grounds with metallic inks** (gold on noir, champagne on
 * emerald, rose gold on bordeaux, silver on sapphire, blush on onyx,
 * platinum on obsidian) and **pale grounds with deep inks** (ivory,
 * champagne, marble, pearl, blush ivory). Every one is `premium`.
 *
 * ## Metal as ink, metal as art
 *
 * Real gold on ivory is a lovely colour and an unreadable one (#B8925A on
 * ivory is under 3:1), so a pale theme writes its metallic roles in the
 * deepest shade of the metal that still clears AA (an antique gold, a
 * bronze, a mauve), and pins the true metal in `art`. The luxury art (fine
 * rules, frames, rays, veins) is then drawn in the bright metal while the
 * words stay readable. On the deep grounds the metal itself reads, and the
 * art takes the same tones.
 *
 * ## Type, tuned per family
 *
 * Every heading is one of the luxury serifs and every body one clean sans,
 * and each serif is set the way it wants to be set rather than at one
 * shared size:
 *
 * - **Hairline serifs** (Cormorant Garamond) need weight and size: a small
 *   x-height and fine strokes vanish at feed size, so they run large and at
 *   500 to 600.
 * - **Didones** draw their hairlines for the size they are set at, and a
 *   phone then shows the slide at a third of that, so Bodoni Moda's headlines
 *   run at 600 or heavier and its quotes at 500; Playfair Display, sturdier,
 *   holds at 500. Both take tight leading for display.
 * - **Caps faces** (Cinzel) need tracking and a smaller size: every letter is
 *   a capital, and capitals set solid read as a block. They keep to short
 *   lines (headline, stat, brand name, call to action); a quote is a whole
 *   sentence, so Gilded Noir sets it in Cormorant Garamond, Cinzel's classic
 *   partner, and a testimonial never reads as capitals.
 * - **Single-weight families** (Italiana, Marcellus, Instrument Serif,
 *   Allura) are only ever asked for 400, so no weight is silently clamped
 *   (`themes.test.ts` checks every role against the family's real range).
 * - **Narrow faces** (Instrument Serif) run larger to fill the same measure.
 *
 * The sans roles (`QUIET`) are small, regular and given room. Two things are
 * deliberately absent: italics, because the font pack ships no italic files
 * and a browser's synthetic slant looks cheap, and uppercase, because the
 * house rule is no all-caps text (luxury here is spacing and weight, not
 * capitals). A script (Allura) sets one theme's headlines and nothing else,
 * at a size where it still reads on a phone.
 */
import type { FontId, Theme, TypeRole, TypeStyle } from '../types';
import { palette, scale } from './scale';

type RolePatch = Partial<Omit<TypeStyle, 'face'>>;

/**
 * The sans roles every luxury theme shares. Quiet, not small: the body stays
 * at 3.1 so a paragraph still reads on a phone, and the restraint comes from
 * the regular weight, the open leading and the tracked labels.
 */
const QUIET: Partial<Record<TypeRole, RolePatch>> = {
  eyebrow: { weight: 600, size: 2.5, lineHeight: 1.3, tracking: 0.12 },
  subheadline: { weight: 400, size: 3.4, lineHeight: 1.45, tracking: 0 },
  body: { weight: 400, size: 3.1, lineHeight: 1.55, tracking: 0.005 },
  list: { weight: 400, size: 3.3, lineHeight: 1.45, tracking: 0 },
  attribution: { weight: 600, size: 2.4, lineHeight: 1.4, tracking: 0.1 },
  statLabel: { weight: 400, size: 3.1, lineHeight: 1.45, tracking: 0 },
  footer: { weight: 500, size: 2.3, lineHeight: 1.4, tracking: 0.04 },
  pageNumber: { weight: 500, size: 2.2, lineHeight: 1, tracking: 0.08 },
};

/**
 * A luxury theme's type: `QUIET` for the sans, merged role by role with the
 * theme's own settings, which tune its serif and adjust the sans for a body
 * face that runs wide or narrow.
 */
function luxuryType(
  heading: FontId,
  body: FontId,
  roles: Partial<Record<TypeRole, RolePatch>>,
): Record<TypeRole, TypeStyle> {
  const merged: Partial<Record<TypeRole, RolePatch>> = { ...QUIET };

  for (const [role, patch] of Object.entries(roles) as Array<[TypeRole, RolePatch]>) {
    merged[role] = { ...merged[role], ...patch };
  }

  return scale(heading, body, merged);
}

export const LUXURY_THEMES: Theme[] = [
  {
    // Noir and gold: a warm black, gold inks, Cinzel's inscriptional capitals
    // for the short lines and Cormorant Garamond, its classic partner, for quotes.
    id: 'gilded-noir',
    name: 'Gilded Noir',
    style: 'dark',
    family: 'gold',
    premium: true,
    colors: palette({
      background: '#0E0D0B',
      surface: '#1C1A16',
      primary: '#D2B06F',
      secondary: '#7A6440',
      accent: '#E8D2A0',
      text: '#F3EBDD',
      textMuted: '#B5AA96',
      onPrimary: '#0E0D0B',
      onAccent: '#0E0D0B',
      onSurface: '#F3EBDD',
    }),
    type: luxuryType('cinzel', 'montserrat', {
      headline: { weight: 500, size: 6.8, lineHeight: 1.14, tracking: 0.04 },
      quote: { font: 'cormorant-garamond', weight: 500, size: 6, lineHeight: 1.18, tracking: 0 },
      stat: { weight: 500, size: 12.5, lineHeight: 1, tracking: 0.02 },
      brandName: { weight: 600, size: 2.8, lineHeight: 1.2, tracking: 0.12 },
      cta: { weight: 600, size: 3.8, lineHeight: 1.25, tracking: 0.08 },
      body: { size: 3 },
    }),
    art: { mid: '#5C4B2E', highlight: '#D4AF6A' },
  },
  {
    // Ivory and gold: antique gold that reads on ivory, the true gilt in the art.
    id: 'ivory-gilt',
    name: 'Ivory Gilt',
    style: 'light',
    family: 'gold',
    premium: true,
    colors: palette({
      background: '#FAF6EE',
      surface: '#F0E7D6',
      primary: '#7B5B26',
      secondary: '#C2A267',
      accent: '#8A5A2B',
      text: '#221C14',
      textMuted: '#625746',
      onPrimary: '#FAF6EE',
      onAccent: '#FAF6EE',
      onSurface: '#221C14',
    }),
    type: luxuryType('cormorant-garamond', 'dm-sans', {
      headline: { weight: 600, size: 9.2, lineHeight: 1.02, tracking: -0.01 },
      quote: { weight: 500, size: 6.4, lineHeight: 1.16, tracking: -0.005 },
      stat: { weight: 600, size: 16, lineHeight: 0.95, tracking: -0.02 },
      brandName: { weight: 600, size: 3.4, lineHeight: 1.1, tracking: 0.02 },
      cta: { weight: 600, size: 5, lineHeight: 1.15, tracking: 0 },
    }),
    art: { mid: '#E6D6B4', highlight: '#B8925A' },
  },
  {
    // Emerald and champagne: a jewel-green ground, champagne and gold inks.
    id: 'emerald-champagne',
    name: 'Emerald Champagne',
    style: 'dark',
    family: 'green',
    premium: true,
    colors: palette({
      background: '#0C3529',
      surface: '#134537',
      primary: '#E4CFA0',
      secondary: '#1F5A47',
      accent: '#D8B878',
      text: '#F5EEDF',
      textMuted: '#CFC6AE',
      onPrimary: '#0C3529',
      onAccent: '#0C3529',
      onSurface: '#F5EEDF',
    }),
    type: luxuryType('playfair-display', 'outfit', {
      headline: { weight: 500, size: 7.8, lineHeight: 1.08, tracking: -0.01 },
      quote: { weight: 400, size: 5.4, lineHeight: 1.28, tracking: -0.005 },
      stat: { weight: 500, size: 14, lineHeight: 1, tracking: -0.02 },
      brandName: { weight: 600, size: 3, lineHeight: 1.15, tracking: 0.01 },
      cta: { weight: 500, size: 4.4, lineHeight: 1.2, tracking: 0 },
      body: { size: 3.2 },
    }),
    art: { mid: '#2B6650', highlight: '#E4CFA0' },
  },
  {
    // Bordeaux and rose gold: a deep wine ground, rose gold inks, a Didone.
    id: 'bordeaux-rose',
    name: 'Bordeaux Rose',
    style: 'dark',
    family: 'red',
    premium: true,
    colors: palette({
      background: '#330C19',
      surface: '#45172A',
      primary: '#E8B79F',
      secondary: '#6E2A39',
      accent: '#F2CDBB',
      text: '#FBEDE6',
      textMuted: '#D9B9B0',
      onPrimary: '#330C19',
      onAccent: '#330C19',
      onSurface: '#FBEDE6',
    }),
    type: luxuryType('bodoni-moda', 'plus-jakarta-sans', {
      headline: { weight: 600, size: 8.2, lineHeight: 1.04, tracking: -0.015 },
      quote: { weight: 500, size: 5.4, lineHeight: 1.26, tracking: -0.005 },
      stat: { weight: 500, size: 14.5, lineHeight: 1, tracking: -0.02 },
      brandName: { weight: 600, size: 3, lineHeight: 1.15, tracking: 0.02 },
      cta: { weight: 600, size: 4.6, lineHeight: 1.2, tracking: 0 },
    }),
    art: { mid: '#7A3346', highlight: '#E6B49A' },
  },
  {
    // Champagne: a toned champagne ground, bronze and rose inks, Italiana's fine display.
    id: 'champagne',
    name: 'Champagne',
    style: 'light',
    family: 'gold',
    premium: true,
    colors: palette({
      background: '#EFE2C9',
      surface: '#E5D3B2',
      primary: '#6A4B26',
      secondary: '#C9A469',
      accent: '#84463F',
      text: '#2B2116',
      textMuted: '#625139',
      onPrimary: '#EFE2C9',
      onAccent: '#EFE2C9',
      onSurface: '#2B2116',
    }),
    type: luxuryType('italiana', 'manrope', {
      headline: { weight: 400, size: 9.2, lineHeight: 1.06, tracking: 0.01 },
      quote: { weight: 400, size: 6.2, lineHeight: 1.2, tracking: 0.01 },
      stat: { weight: 400, size: 15, lineHeight: 1, tracking: 0 },
      brandName: { weight: 400, size: 3.4, lineHeight: 1.1, tracking: 0.08 },
      cta: { weight: 400, size: 5, lineHeight: 1.15, tracking: 0.02 },
    }),
    art: { mid: '#E0C99E', highlight: '#BF975A' },
  },
  {
    // Sapphire and silver: a deep blue ground, silver and ice-blue inks.
    id: 'sapphire-silver',
    name: 'Sapphire Silver',
    style: 'dark',
    family: 'blue',
    premium: true,
    colors: palette({
      background: '#0C1A3A',
      surface: '#15274F',
      primary: '#C9CFD9',
      secondary: '#23386B',
      accent: '#9DB7EA',
      text: '#F1F3F7',
      textMuted: '#B4BCCB',
      onPrimary: '#0C1A3A',
      onAccent: '#0C1A3A',
      onSurface: '#F1F3F7',
    }),
    type: luxuryType('marcellus', 'montserrat', {
      headline: { weight: 400, size: 7.4, lineHeight: 1.12, tracking: 0 },
      quote: { weight: 400, size: 5, lineHeight: 1.3, tracking: 0 },
      stat: { weight: 400, size: 13, lineHeight: 1, tracking: 0 },
      brandName: { weight: 400, size: 3, lineHeight: 1.15, tracking: 0.06 },
      cta: { weight: 400, size: 4.4, lineHeight: 1.2, tracking: 0.02 },
      body: { size: 3 },
    }),
    art: { mid: '#2E4A86', highlight: '#C9CFD9' },
  },
  {
    // Marble: a cool white stone, graphite inks, a brass line.
    id: 'carrara',
    name: 'Carrara',
    style: 'light',
    family: 'neutral',
    premium: true,
    colors: palette({
      background: '#F2F0EC',
      surface: '#E6E3DD',
      primary: '#76603C',
      secondary: '#B9B5AE',
      accent: '#3D3D42',
      text: '#1C1C1E',
      textMuted: '#5C5C60',
      onPrimary: '#F2F0EC',
      onAccent: '#F2F0EC',
      onSurface: '#1C1C1E',
    }),
    type: luxuryType('instrument-serif', 'inter', {
      headline: { weight: 400, size: 9.6, lineHeight: 1, tracking: -0.01 },
      quote: { weight: 400, size: 6.8, lineHeight: 1.12, tracking: -0.005 },
      stat: { weight: 400, size: 17, lineHeight: 0.92, tracking: -0.01 },
      brandName: { weight: 400, size: 3.6, lineHeight: 1.1, tracking: 0 },
      cta: { weight: 400, size: 5.4, lineHeight: 1.12, tracking: 0 },
    }),
    art: { mid: '#D8D4CD', highlight: '#A29D94' },
  },
  {
    // Onyx and blush: a soft black, blush and pale rose inks, Fraunces at display size.
    id: 'onyx-blush',
    name: 'Onyx Blush',
    style: 'dark',
    family: 'pink',
    premium: true,
    colors: palette({
      background: '#141113',
      surface: '#241D21',
      primary: '#E9B7BC',
      secondary: '#5A3E44',
      accent: '#F2D3D0',
      text: '#FAF0EE',
      textMuted: '#C8B7B6',
      onPrimary: '#141113',
      onAccent: '#141113',
      onSurface: '#FAF0EE',
    }),
    type: luxuryType('fraunces', 'dm-sans', {
      headline: { weight: 500, size: 7.8, lineHeight: 1.04, tracking: -0.02 },
      quote: { weight: 400, size: 5.4, lineHeight: 1.26, tracking: -0.01 },
      stat: { weight: 500, size: 14, lineHeight: 1, tracking: -0.03 },
      brandName: { weight: 600, size: 3, lineHeight: 1.15, tracking: -0.005 },
      cta: { weight: 500, size: 4.4, lineHeight: 1.2, tracking: -0.01 },
    }),
    art: { mid: '#5E4248', highlight: '#E9B7BC' },
  },
  {
    // Obsidian: black glass and platinum, a bold Didone.
    id: 'obsidian',
    name: 'Obsidian',
    style: 'dark',
    family: 'mono',
    premium: true,
    colors: palette({
      background: '#0A0A0C',
      surface: '#18181C',
      primary: '#E2E2E6',
      secondary: '#2A2A30',
      accent: '#BDBEC6',
      text: '#EDEDEF',
      textMuted: '#A6A6AD',
      onPrimary: '#0A0A0C',
      onAccent: '#0A0A0C',
      onSurface: '#EDEDEF',
    }),
    type: luxuryType('bodoni-moda', 'outfit', {
      headline: { weight: 700, size: 8, lineHeight: 1.02, tracking: -0.02 },
      quote: { weight: 500, size: 5.4, lineHeight: 1.26, tracking: -0.005 },
      stat: { weight: 700, size: 15, lineHeight: 0.98, tracking: -0.025 },
      brandName: { weight: 700, size: 3, lineHeight: 1.15, tracking: 0.01 },
      cta: { weight: 600, size: 4.4, lineHeight: 1.2, tracking: 0 },
      body: { size: 3.2 },
    }),
    art: { mid: '#34343C', highlight: '#D8D8DE' },
  },
  {
    // Pearl: a warm white with a pearl's grey-rose, mauve inks.
    id: 'pearl',
    name: 'Pearl',
    style: 'light',
    family: 'neutral',
    premium: true,
    colors: palette({
      background: '#F6F3EF',
      surface: '#ECE6E0',
      primary: '#6E5A55',
      secondary: '#D9CFC8',
      accent: '#86626B',
      text: '#24211F',
      textMuted: '#625C57',
      onPrimary: '#F6F3EF',
      onAccent: '#F6F3EF',
      onSurface: '#24211F',
    }),
    type: luxuryType('cormorant-garamond', 'plus-jakarta-sans', {
      headline: { weight: 500, size: 9.6, lineHeight: 1.02, tracking: -0.01 },
      quote: { weight: 500, size: 6.6, lineHeight: 1.16, tracking: -0.005 },
      stat: { weight: 500, size: 17, lineHeight: 0.95, tracking: -0.02 },
      brandName: { weight: 600, size: 3.4, lineHeight: 1.1, tracking: 0.02 },
      cta: { weight: 600, size: 5, lineHeight: 1.15, tracking: 0 },
    }),
    art: { mid: '#E6DED7', highlight: '#BFB2AA' },
  },
  {
    // Blush ivory for weddings and invitations: the one theme with a script,
    // and only in its headlines, at a display size. Every other heading role
    // stays in Cormorant Garamond. The script is Allura because headlines are
    // Title Case: Allura's capitals stay readable, where Great Vibes' I reads
    // as a J and its A swallows the space before it.
    id: 'vow',
    name: 'Vow',
    style: 'light',
    family: 'pink',
    premium: true,
    colors: palette({
      background: '#F9F1EC',
      surface: '#F1E2DA',
      primary: '#8A4A57',
      secondary: '#E3C5BE',
      accent: '#93574B',
      text: '#2E1E22',
      textMuted: '#6B5257',
      onPrimary: '#F9F1EC',
      onAccent: '#F9F1EC',
      onSurface: '#2E1E22',
    }),
    type: luxuryType('cormorant-garamond', 'montserrat', {
      headline: { font: 'allura', weight: 400, size: 10.5, lineHeight: 1.12, tracking: 0 },
      quote: { weight: 500, size: 6.2, lineHeight: 1.18, tracking: -0.005 },
      stat: { weight: 500, size: 16, lineHeight: 0.95, tracking: -0.02 },
      brandName: { weight: 600, size: 3.4, lineHeight: 1.1, tracking: 0.04 },
      cta: { weight: 600, size: 4.8, lineHeight: 1.15, tracking: 0 },
      body: { size: 3 },
    }),
    art: { mid: '#EBD3CB', highlight: '#C99A8F' },
  },
];
