/**
 * The shared type rhythm every theme is built from.
 *
 * A theme states its two faces and the handful of sizes it wants to differ;
 * everything else comes from here, so adding a theme is a palette and a line
 * or two, not thirteen type styles. Each role also records which of the two
 * faces it is set in (`face`), which is what lets a design's own font choice
 * replace "the heading face" everywhere at once.
 *
 * Sizes are percentages of the canvas's short edge: 9 means 97px on a
 * 1080-wide square.
 */
import type { FontId, Palette, TypeRole, TypeStyle } from '../types';

export function scale(
  heading: FontId,
  body: FontId,
  overrides: Partial<Record<TypeRole, Partial<Omit<TypeStyle, 'face'>>>> = {},
): Record<TypeRole, TypeStyle> {
  const base: Record<TypeRole, TypeStyle> = {
    eyebrow: { font: body, face: 'body', weight: 600, size: 2.6, lineHeight: 1.3, tracking: 0.08 },
    headline: {
      font: heading,
      face: 'heading',
      weight: 800,
      size: 7.6,
      lineHeight: 1.08,
      tracking: -0.02,
    },
    subheadline: {
      font: body,
      face: 'body',
      weight: 500,
      size: 3.6,
      lineHeight: 1.35,
      tracking: -0.005,
    },
    body: { font: body, face: 'body', weight: 400, size: 3.1, lineHeight: 1.5, tracking: 0 },
    list: { font: body, face: 'body', weight: 500, size: 3.3, lineHeight: 1.45, tracking: 0 },
    quote: {
      font: heading,
      face: 'heading',
      weight: 600,
      size: 5.4,
      lineHeight: 1.25,
      tracking: -0.015,
    },
    attribution: {
      font: body,
      face: 'body',
      weight: 600,
      size: 2.6,
      lineHeight: 1.4,
      tracking: 0.02,
    },
    stat: { font: heading, face: 'heading', weight: 800, size: 14, lineHeight: 1, tracking: -0.035 },
    statLabel: { font: body, face: 'body', weight: 500, size: 3, lineHeight: 1.35, tracking: 0 },
    footer: { font: body, face: 'body', weight: 500, size: 2.4, lineHeight: 1.4, tracking: 0 },
    brandName: {
      font: heading,
      face: 'heading',
      weight: 700,
      size: 2.8,
      lineHeight: 1.2,
      tracking: -0.01,
    },
    cta: { font: heading, face: 'heading', weight: 700, size: 4.2, lineHeight: 1.2, tracking: -0.01 },
    pageNumber: { font: body, face: 'body', weight: 600, size: 2.2, lineHeight: 1, tracking: 0.02 },
  };

  for (const [role, patch] of Object.entries(overrides) as Array<
    [TypeRole, Partial<Omit<TypeStyle, 'face'>>]
  >) {
    base[role] = { ...base[role], ...patch };
  }

  return base;
}

/** Identity, so a palette literal is checked against `Palette` where it is written. */
export function palette(colors: Palette): Palette {
  return colors;
}
