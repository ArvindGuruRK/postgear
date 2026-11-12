/**
 * The PostGear palette for email, copied from the flat brand tokens in
 * packages/ui/src/styles/colors.css (the ones no theme changes). Email cannot
 * read CSS variables, so the values are literal here; keep them in step.
 */
export const COLORS = {
  /** actionPrimary: the gear, the button. */
  blue: '#1d4ed8',
  /** brutal-secondary: the sticker stripe. */
  yellow: '#ffd100',
  /** onActionLight: borders, shadows, body text. */
  ink: '#0a0a0a',
  white: '#ffffff',
  /** The Cream light theme's page. */
  cream: '#fff8e7',
  /** Read-only panels inside the card (the app's `bg-inset`, light). */
  inset: '#f6f1e4',
  muted: '#4a4a4a',
  // The "-ink" shades of the comic fills: dark enough for white text (AA).
  dangerInk: '#c81e2c',
  successInk: '#147537',
  accentInk: '#b93d0b',
  ai: '#7657ef',
} as const;

/** The dark palette (the app's dark theme: page, card, inset, outline). */
export const DARK = {
  page: '#121212',
  card: '#2a2a2a',
  inset: '#1e1e1e',
  outline: '#050505',
  text: '#f5f5f5',
  muted: '#b8b8b8',
  link: '#9db7ff',
} as const;

/**
 * Sora is the app's font, but most mail clients will not load a web font.
 * Apple Mail and iOS do (the stylesheet link in the head), everyone else gets
 * the system sans, which the layout is designed around.
 */
export const FONT_STACK =
  "Sora, 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export const MONO_STACK =
  "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace";

/** The card's outer width; the hard shadow sits outside it. */
export const CONTENT_WIDTH = 600;

/** How far the hard shadows fall, in px. */
export const SHADOW = { card: 6, button: 4 } as const;

/**
 * The colour band at the top of each card. Every band is dark enough for
 * white text, so a client that inverts colours for dark mode (Gmail's app)
 * has nothing to flip: white on a saturated colour reads the same either way.
 */
export type Tone = 'brand' | 'success' | 'danger' | 'warning' | 'ai';

export const TONE_FILL: Record<Tone, string> = {
  brand: COLORS.blue,
  success: COLORS.successInk,
  danger: COLORS.dangerInk,
  warning: COLORS.accentInk,
  ai: COLORS.ai,
};

/** Hosted images, served by the web app from apps/web/public/email. */
export const ASSET_PATHS = {
  gear: '/email/postgear-gear.png',
  tile: '/email/postgear-tile.png',
} as const;
