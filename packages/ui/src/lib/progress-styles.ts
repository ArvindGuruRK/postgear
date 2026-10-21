/**
 * The look shared by every progress bar in the system: `Progress` (one bar)
 * and `SegmentedProgress` (a row of gapped cells). Kept apart from
 * `progress.tsx`, which is a client module (Radix), so a server component can
 * import these as real strings; values exported from a 'use client' file reach
 * the server only as client references.
 */

/** Fill colour and the text colour that reads on it, per meaning. */
export const PROGRESS_TONE = {
  primary: { fill: 'bg-actionPrimary', on: 'text-onActionPrimary' },
  danger: { fill: 'bg-actionDanger', on: 'text-onActionLight' },
  success: { fill: 'bg-actionSuccess', on: 'text-onActionLight' },
  accent: { fill: 'bg-actionAccent', on: 'text-onActionLight' },
  ai: { fill: 'bg-actionAi', on: 'text-onActionAi' },
  // Sprint 7: the "fair" band of a score (ScoreBar/ScoreGauge), yellow between
  // the green and the orange.
  secondary: { fill: 'bg-actionSecondary', on: 'text-onActionLight' },
} as const;

export type ProgressTone = keyof typeof PROGRESS_TONE;

/** Track height, and the label's size inside a bar. */
export const PROGRESS_SIZE = {
  sm: { track: 'h-3', label: 'text-[10px]' },
  md: { track: 'h-5', label: 'text-xs' },
  lg: { track: 'h-8', label: 'text-sm' },
} as const;

export type ProgressSize = keyof typeof PROGRESS_SIZE;
