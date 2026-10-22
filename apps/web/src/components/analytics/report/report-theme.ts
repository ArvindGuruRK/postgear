/**
 * The analytics PDF's palette and type, in plain values (revamp, 2026-10-22).
 *
 * A PDF has no CSS, so the design tokens cannot reach it: these are the
 * Classic dark theme's values, copied from `packages/ui/src/styles/colors.css`
 * (page ground, card, ink, outline, the brutal fills) and the type roles in
 * `apps/web/src/app/globals.css`. The report is always dark, the owner's
 * choice (2026-10-23): it is the view they love in the app, whatever theme
 * the viewer happens to use. If a token changes there, change it here.
 */
import type { TrendTone } from '@postgear/ui';

export const PDF_COLORS = {
  /** `--color-primary`, Classic dark: the page ground. */
  ground: '#121212',
  /** `--color-secondary`, Classic dark: every card. */
  card: '#2a2a2a',
  /** `--color-ink`, Classic dark: text and icons. */
  ink: '#f5f5f5',
  /** `--color-outline`, Classic dark: every border and hard shadow. */
  outline: '#050505',
  /** Ink at the strength `type-muted` gives text, on a dark card. */
  muted: '#a3a3a3',
  /** Grid lines and row dividers: ink, faint. */
  faint: '#3d3d3d',
  primary: '#1d4ed8',
  secondary: '#ffd100',
  accent: '#ff6b35',
  success: '#22c55e',
  danger: '#e63946',
  ai: '#7657ef',
  /** `--color-on-action-primary`: text on blue and violet. */
  onPrimary: '#ffffff',
  /** `--color-on-action-light`: text on yellow, orange, green and red, dark in every theme. */
  onLight: '#0a0a0a',
  /** The highlights card: the primary blue, so it stands out on a dark page. */
  highlight: '#1d4ed8',
  /** Quiet and soft text on the blue highlights card. */
  highlightMuted: '#c3d0fb',
  highlightSoft: '#e3e9fd',
} as const;

/** Each chart tone's fill, the same mapping the page uses. */
export const TONE_COLOR: Record<TrendTone, string> = {
  primary: PDF_COLORS.primary,
  ai: PDF_COLORS.ai,
  accent: PDF_COLORS.accent,
  success: PDF_COLORS.success,
  danger: PDF_COLORS.danger,
  secondary: PDF_COLORS.secondary,
};

/** Text on each fill: white on blue and violet, dark on the rest. */
export const ON_TONE: Record<TrendTone, string> = {
  primary: PDF_COLORS.onPrimary,
  ai: PDF_COLORS.onPrimary,
  accent: PDF_COLORS.onLight,
  success: PDF_COLORS.onLight,
  danger: PDF_COLORS.onLight,
  secondary: PDF_COLORS.onLight,
};

/** The one family, Sora, at the four weights the type roles use. */
export const PDF_FONT = 'Sora';

export const PDF_FONT_FILES = [
  { weight: 400, src: '/fonts/sora/sora-400.woff' },
  { weight: 600, src: '/fonts/sora/sora-600.woff' },
  { weight: 700, src: '/fonts/sora/sora-700.woff' },
  { weight: 800, src: '/fonts/sora/sora-800.woff' },
] as const;

/** Border width and the hard shadow's offset, in points (2px and 4px on screen). */
export const PDF_BORDER = 1.5;
export const PDF_SHADOW = 3;
