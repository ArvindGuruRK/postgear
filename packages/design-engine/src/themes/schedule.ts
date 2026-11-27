/**
 * The Schedule collection (Sprint 13, Module 14 section C1): five themes for
 * a week of streams, one per card of the Schedule Maker.
 *
 * The names follow the reference (StreamLadder's schedule screen shows five
 * cards: Clean Blue, Light Blue, Cool, Dark, Red); the colours and the type
 * are PostGear's own. A schedule row is drawn as a card: the day on
 * `primary` in `onPrimary`, the time and the title on `surface` in
 * `onSurface`. Both pairs are among the ones `themes.test.ts` holds every
 * theme to, so a week reads in every theme and under every brand kit (which
 * recomputes the derived inks).
 *
 * - **Clean Blue**: white ground, a strong blue day column, Sora.
 * - **Light Blue**: a pale sky ground with white row cards, Outfit.
 * - **Cool**: a deep violet ground with a soft glow (the Aurora art), Space
 *   Grotesk.
 * - **Dark**: near black with one bright lime accent, Oswald. The research
 *   proposed Bebas Neue, but it has no lower case: every word would be set in
 *   capitals, which the house rule forbids (decision log, 2026-11-28).
 * - **Red**: a red ground with white rows and pale day cards, Anton (one
 *   weight, so it is only ever asked for 400).
 *
 * Every family is one of the shipped OFL fonts. All five are free.
 */
import type { Theme } from '../types';
import { palette, scale } from './scale';

/** One weight, so every heading role asks Anton for the 400 it has. */
const ANTON_WEIGHTS = {
  headline: { weight: 400, size: 9, lineHeight: 1.02, tracking: 0 },
  quote: { weight: 400 },
  stat: { weight: 400 },
  brandName: { weight: 400 },
  cta: { weight: 400, tracking: 0.01 },
} as const;

export const SCHEDULE_THEMES: Theme[] = [
  {
    id: 'schedule-clean-blue',
    name: 'Clean Blue',
    style: 'light',
    family: 'blue',
    colors: palette({
      background: '#FFFFFF',
      surface: '#EAF1FF',
      primary: '#1D4ED8',
      secondary: '#93B4F5',
      accent: '#B4231A',
      text: '#0B1736',
      textMuted: '#4A5878',
      onPrimary: '#FFFFFF',
      onAccent: '#FFF5F4',
      onSurface: '#0B1736',
    }),
    type: scale('sora', 'inter'),
  },
  {
    id: 'schedule-light-blue',
    name: 'Light Blue',
    style: 'colourful',
    family: 'teal',
    colors: palette({
      background: '#D9ECFF',
      surface: '#FFFFFF',
      primary: '#1658B8',
      secondary: '#8FC2F2',
      accent: '#0D6460',
      text: '#08223D',
      textMuted: '#33506C',
      onPrimary: '#FFFFFF',
      onAccent: '#F0FFFD',
      onSurface: '#08223D',
    }),
    type: scale('outfit', 'inter'),
  },
  {
    id: 'schedule-cool',
    name: 'Cool',
    style: 'colourful',
    family: 'purple',
    colors: palette({
      background: '#1A0F36',
      surface: '#2B1C55',
      primary: '#B9A2FF',
      secondary: '#5A3FB0',
      accent: '#5FE3F5',
      text: '#F6F2FF',
      textMuted: '#C8BCEE',
      onPrimary: '#170A33',
      onAccent: '#06222A',
      onSurface: '#F6F2FF',
    }),
    type: scale('space-grotesk', 'inter', {
      headline: { weight: 700 },
      quote: { weight: 600 },
      stat: { weight: 700 },
    }),
    art: { mid: '#4B2C9E', highlight: '#5FE3F5' },
  },
  {
    id: 'schedule-dark',
    name: 'Dark',
    style: 'dark',
    family: 'mono',
    colors: palette({
      background: '#0C0C0F',
      surface: '#1C1C23',
      primary: '#C8FF3E',
      secondary: '#3A3A44',
      accent: '#FF5CC8',
      text: '#F6F6F8',
      textMuted: '#A8A8B4',
      onPrimary: '#121A00',
      onAccent: '#1F0016',
      onSurface: '#F6F6F8',
    }),
    type: scale('oswald', 'inter', {
      headline: { weight: 700, size: 8.8, lineHeight: 1.04, tracking: 0 },
      quote: { weight: 600 },
      stat: { weight: 700 },
      cta: { weight: 700, tracking: 0.01 },
    }),
  },
  {
    id: 'schedule-red',
    name: 'Red',
    style: 'colourful',
    family: 'red',
    colors: palette({
      background: '#B5121B',
      surface: '#FFFFFF',
      primary: '#FFE6E3',
      secondary: '#7E0A10',
      accent: '#FFD84D',
      text: '#FFFFFF',
      textMuted: '#FFE1DE',
      onPrimary: '#7A0A12',
      onAccent: '#3A2600',
      onSurface: '#3B0A0E',
    }),
    type: scale('anton', 'inter', ANTON_WEIGHTS),
  },
];
