import { cn } from './utils';

/**
 * Classes for the hover fill (`useFillHover`, 2026-10-21). Kept apart from
 * that hook's 'use client' module, so server code (a link styled with
 * `buttonVariants`) gets real strings, not client references.
 */

/** The control: the circle stacks inside it and is clipped to its shape. */
const ROOT = 'relative isolate overflow-hidden';

/**
 * The circle, behind the label: sized and placed by the hook, zero-sized
 * until the pointer arrives. The soft edge is gsap.com's; it scales with
 * the circle, so it stays a feather, never a haze.
 */
const LAYER = 'pointer-events-none absolute left-0 top-0 -z-10 size-0 rounded-full blur-[0.5rem]';

/**
 * The neutral control (Button's `secondary`, the calendar's Add Channel
 * tile): the card surface, filling with `hoverFill`, grey in light mode and
 * near-black in dark (the user's pick, 2026-10-21). The label keeps the ink
 * colour, which reads on both.
 */
export const fillHoverNeutral = cn(
  ROOT,
  'bg-secondary text-ink',
  'not-data-fill-hover:hover:bg-hoverFill active:bg-hoverFill',
);
export const fillHoverNeutralLayer = cn(LAYER, 'bg-hoverFill');
