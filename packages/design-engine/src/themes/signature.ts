/**
 * The Signature collection: CarouselClick's palettes, as PostGear themes.
 *
 * Ten themes are CarouselClick's ten generated-template palettes
 * (`PALETTES` in its `src/features/templates/templates.ts`), and three wear
 * its brand-dark inks (`BRAND_DARK` there) on the three grounds its
 * hand-made backgrounds were drawn on. The ids and names are new: PostGear
 * already had a `midnight`, an `ocean` and a `violet`, and no client name
 * may reach a user.
 *
 * ## How a CarouselClick palette maps onto the roles
 *
 * | Role | From CarouselClick |
 * |---|---|
 * | `background` | background, exactly |
 * | `text` | text (the headline) |
 * | `textMuted` | body (the supporting text) |
 * | `primary` | accent (eyebrow, footer, accent rule) |
 * | `accent` | highlight |
 * | `secondary` | mid |
 * | `surface` | between the ground and `mid`: half way on a dark ground, 0.45 on a light one |
 * | `onPrimary`, `onAccent` | the ground's own colour, which reads on both fills |
 * | `onSurface` | `text` |
 * | `art` | `{ mid, highlight }`, exactly |
 *
 * **The backgrounds are exact, not close.** `artColors` draws a hand-made
 * original in its own colours only while the slide is on that original's
 * own ground, compared hex for hex, so a ground off by one step would
 * recolour the art it was ported to show.
 *
 * ## Colours changed for readability
 *
 * The Signature layouts set the eyebrow, the footer and the call to action in
 * `primary`, and the Classic ones set an eyebrow in `accent`, so both must
 * clear WCAG AA (4.5:1) on the ground as text. CarouselClick never measured
 * that, and five of its colours fall short. Each was replaced in its role by
 * the nearest shade of the same hue that passes: the same OKLCH hue and
 * chroma, with only the lightness lowered until it clears 4.5:1. The exact
 * colour stays in `art`, so the backgrounds still draw in it.
 *
 * - Mint `primary`: #0E9F5A (3.29:1 on #EBFFF6) became #067D46 (5.00:1).
 * - Mint `accent`: #C6FF5C (1.13:1) became #5C7E01 (4.54:1).
 * - Paper `accent`: #8B6CFF (3.36:1 on #F6F4EE) became #7755E6 (4.52:1).
 * - Sky `primary`: #2F6FE4 (4.24:1 on #EEF5FF) became #2362D6 (5.05:1).
 * - Sky `accent`: #5FB0FF (2.09:1) became #1C73BE (4.51:1).
 *
 * The two primaries go past 4.5:1 to 5:1 because they set the eyebrow, and
 * every pattern lays a soft gradient over the ground that costs a line of
 * text about a tenth of its contrast; at 4.5:1 an eyebrow over a pattern
 * read at 4.4:1 (Sprint 9b's pixel check).
 *
 * Every other CarouselClick colour is used as it is: the dark palettes' inks
 * clear 7:1 or better, and Paper's #5B3FD9 clears 6.05:1.
 *
 * ## Type
 *
 * Manrope for both faces, at the hierarchy of CarouselClick's
 * `src/features/editor/layout.ts`. It designs at 1080px on the short edge,
 * so its pixel sizes become percentages of that: a 92px headline is 8.5.
 */
import type { Theme, TypeRole, TypeStyle } from '../types';
import { palette, scale } from './scale';

/**
 * CarouselClick's type, with letter spacing 0 throughout as it sets it.
 *
 * - Headline 92px at weight 820 (8.5), eyebrow 30px at 800 (2.8, not
 *   uppercase), supporting text 44px at 720 (4.1), and its footer line,
 *   which is PostGear's call to action, 56px at 820 (5.2). A statistic's
 *   number is 132px (12.2).
 * - The roles CarouselClick has no element for take the element that plays
 *   the part there: body, list and the number's label are its supporting
 *   text; a quote is set like a headline, a size down so a real testimonial
 *   still fits; the attribution and the brand name are bold short lines; the
 *   handle and the slide number are the quiet small print the Classic frame
 *   expects.
 *
 * Manrope's file stops at 800, so `resolveWeight` draws 820 as 800, the way
 * CarouselClick's own Manrope does.
 */
function signatureType(): Record<TypeRole, TypeStyle> {
  return scale('manrope', 'manrope', {
    eyebrow: { size: 2.8, weight: 800, lineHeight: 1.08, tracking: 0 },
    headline: { size: 8.5, weight: 820, lineHeight: 1.08, tracking: 0 },
    subheadline: { size: 4.1, weight: 720, lineHeight: 1.2, tracking: 0 },
    body: { size: 4.1, weight: 720, lineHeight: 1.2, tracking: 0 },
    list: { size: 4.1, weight: 720, lineHeight: 1.2, tracking: 0 },
    quote: { size: 6.6, weight: 820, lineHeight: 1.1, tracking: 0 },
    attribution: { size: 3.6, weight: 800, lineHeight: 1.2, tracking: 0 },
    stat: { size: 12.2, weight: 820, lineHeight: 1.08, tracking: 0 },
    statLabel: { size: 4.1, weight: 720, lineHeight: 1.2, tracking: 0 },
    footer: { size: 2.6, weight: 700, lineHeight: 1.3, tracking: 0 },
    brandName: { size: 2.8, weight: 800, lineHeight: 1.08, tracking: 0 },
    cta: { size: 5.2, weight: 820, lineHeight: 1.12, tracking: 0 },
    pageNumber: { size: 2.4, weight: 700, lineHeight: 1, tracking: 0 },
  });
}

export const SIGNATURE_THEMES: Theme[] = [
  {
    // CarouselClick's Forest.
    id: 'forest',
    name: 'Forest',
    style: 'dark',
    family: 'green',
    colors: palette({
      background: '#023D1E',
      surface: '#07542A',
      primary: '#B8FF35',
      secondary: '#0B6B35',
      accent: '#B8FF35',
      text: '#FAFFE9',
      textMuted: '#E7F8EC',
      onPrimary: '#023D1E',
      onAccent: '#023D1E',
      onSurface: '#FAFFE9',
    }),
    type: signatureType(),
    art: { mid: '#0B6B35', highlight: '#B8FF35' },
  },
  {
    // CarouselClick's Midnight.
    id: 'nocturne',
    name: 'Nocturne',
    style: 'dark',
    family: 'green',
    colors: palette({
      background: '#05011A',
      surface: '#181043',
      primary: '#69E57D',
      secondary: '#2B1E6B',
      accent: '#69E57D',
      text: '#F8F6FF',
      textMuted: '#D7D0E6',
      onPrimary: '#05011A',
      onAccent: '#05011A',
      onSurface: '#F8F6FF',
    }),
    type: signatureType(),
    art: { mid: '#2B1E6B', highlight: '#69E57D' },
  },
  {
    // CarouselClick's Lagoon.
    id: 'lagoon',
    name: 'Lagoon',
    style: 'dark',
    family: 'teal',
    colors: palette({
      background: '#0C2B2D',
      surface: '#063C38',
      primary: '#3EE6C5',
      secondary: '#004D43',
      accent: '#D0FF71',
      text: '#F2FFFC',
      textMuted: '#CDEDE7',
      onPrimary: '#0C2B2D',
      onAccent: '#0C2B2D',
      onSurface: '#F2FFFC',
    }),
    type: signatureType(),
    art: { mid: '#004D43', highlight: '#D0FF71' },
  },
  {
    // CarouselClick's Ocean.
    id: 'deep-sea',
    name: 'Deep Sea',
    style: 'dark',
    family: 'blue',
    colors: palette({
      background: '#04172B',
      surface: '#082A53',
      primary: '#4FB3FF',
      secondary: '#0B3D7A',
      accent: '#4FB3FF',
      text: '#F3F8FF',
      textMuted: '#C9DAEE',
      onPrimary: '#04172B',
      onAccent: '#04172B',
      onSurface: '#F3F8FF',
    }),
    type: signatureType(),
    art: { mid: '#0B3D7A', highlight: '#4FB3FF' },
  },
  {
    // CarouselClick's Violet.
    id: 'amethyst',
    name: 'Amethyst',
    style: 'dark',
    family: 'purple',
    colors: palette({
      background: '#140A2B',
      surface: '#301A62',
      primary: '#A98BFF',
      secondary: '#4B2A99',
      accent: '#C3A8FF',
      text: '#F7F3FF',
      textMuted: '#D9D0F0',
      onPrimary: '#140A2B',
      onAccent: '#140A2B',
      onSurface: '#F7F3FF',
    }),
    type: signatureType(),
    art: { mid: '#4B2A99', highlight: '#C3A8FF' },
  },
  {
    // CarouselClick's Ember.
    id: 'ember',
    name: 'Ember',
    style: 'dark',
    family: 'orange',
    colors: palette({
      background: '#1E0C06',
      surface: '#4C1B0A',
      primary: '#FF8A4C',
      secondary: '#7A2A0E',
      accent: '#FF9A5C',
      text: '#FFF6F0',
      textMuted: '#EBD5C8',
      onPrimary: '#1E0C06',
      onAccent: '#1E0C06',
      onSurface: '#FFF6F0',
    }),
    type: signatureType(),
    art: { mid: '#7A2A0E', highlight: '#FF9A5C' },
  },
  {
    // CarouselClick's Graphite.
    id: 'graphite',
    name: 'Graphite',
    style: 'dark',
    family: 'mono',
    colors: palette({
      background: '#111114',
      surface: '#232328',
      primary: '#E6E6EA',
      secondary: '#34343C',
      accent: '#F2F2F5',
      text: '#FFFFFF',
      textMuted: '#C9C9D1',
      onPrimary: '#111114',
      onAccent: '#111114',
      onSurface: '#FFFFFF',
    }),
    type: signatureType(),
    art: { mid: '#34343C', highlight: '#F2F2F5' },
  },
  {
    // CarouselClick's Mint. Its primary and accent are darkened to read as
    // text (see the list above); the art keeps the exact mid and highlight.
    id: 'mint',
    name: 'Mint',
    style: 'light',
    family: 'green',
    colors: palette({
      background: '#EBFFF6',
      surface: '#C9F8E0',
      primary: '#067D46',
      secondary: '#9FF0C6',
      accent: '#5C7E01',
      text: '#06281A',
      textMuted: '#2D4A3D',
      onPrimary: '#EBFFF6',
      onAccent: '#EBFFF6',
      onSurface: '#06281A',
    }),
    type: signatureType(),
    art: { mid: '#9FF0C6', highlight: '#C6FF5C' },
  },
  {
    // CarouselClick's Paper. Its accent is darkened to read as text.
    id: 'paper',
    name: 'Paper',
    style: 'light',
    family: 'purple',
    colors: palette({
      background: '#F6F4EE',
      surface: '#E9E2F6',
      primary: '#5B3FD9',
      secondary: '#D9CCFF',
      accent: '#7755E6',
      text: '#17141F',
      textMuted: '#45404F',
      onPrimary: '#F6F4EE',
      onAccent: '#F6F4EE',
      onSurface: '#17141F',
    }),
    type: signatureType(),
    art: { mid: '#D9CCFF', highlight: '#8B6CFF' },
  },
  {
    // CarouselClick's Sky. Its primary and accent are darkened to read as text.
    id: 'sky',
    name: 'Sky',
    style: 'light',
    family: 'blue',
    colors: palette({
      background: '#EEF5FF',
      surface: '#D9E8FF',
      primary: '#2362D6',
      secondary: '#BFD8FF',
      accent: '#1C73BE',
      text: '#0B1B33',
      textMuted: '#3A4A63',
      onPrimary: '#EEF5FF',
      onAccent: '#EEF5FF',
      onSurface: '#0B1B33',
    }),
    type: signatureType(),
    art: { mid: '#BFD8FF', highlight: '#5FB0FF' },
  },
  {
    // The brand-dark inks on #05011A, the ground of the three numbered
    // backgrounds, Layered Depth, Signal Beam and Stepped Bars.
    id: 'nightfall',
    name: 'Nightfall',
    style: 'dark',
    family: 'green',
    colors: palette({
      background: '#05011A',
      surface: '#083628',
      primary: '#B8FF35',
      secondary: '#0B6B35',
      accent: '#B8FF35',
      text: '#FAFFE9',
      textMuted: '#E7F8EC',
      onPrimary: '#05011A',
      onAccent: '#05011A',
      onSurface: '#FAFFE9',
    }),
    type: signatureType(),
    art: { mid: '#0B6B35', highlight: '#B8FF35' },
  },
  {
    // The brand-dark inks on #025226, the ground of the two lifestyle backgrounds.
    id: 'evergreen',
    name: 'Evergreen',
    style: 'dark',
    family: 'green',
    colors: palette({
      background: '#025226',
      surface: '#075F2E',
      primary: '#B8FF35',
      secondary: '#0B6B35',
      accent: '#B8FF35',
      text: '#FAFFE9',
      textMuted: '#E7F8EC',
      onPrimary: '#025226',
      onAccent: '#025226',
      onSurface: '#FAFFE9',
    }),
    type: signatureType(),
    art: { mid: '#0B6B35', highlight: '#B8FF35' },
  },
  {
    // The brand-dark inks on #162D2F, the ground of the first teal background.
    id: 'spruce',
    name: 'Spruce',
    style: 'dark',
    family: 'teal',
    colors: palette({
      background: '#162D2F',
      surface: '#114C32',
      primary: '#B8FF35',
      secondary: '#0B6B35',
      accent: '#B8FF35',
      text: '#FAFFE9',
      textMuted: '#E7F8EC',
      onPrimary: '#162D2F',
      onAccent: '#162D2F',
      onSurface: '#FAFFE9',
    }),
    type: signatureType(),
    art: { mid: '#0B6B35', highlight: '#B8FF35' },
  },
];
