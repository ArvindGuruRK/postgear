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
 * tile): the card surface, filling with the brand yellow on hover, as the
 * logo guide's buttons do (the owner's pick, 2026-10-27; it filled with the
 * page ground before). Yellow is a flat fill, the same in every theme, so the
 * label flips to the fixed black that pairs with it (`onActionLight`) once
 * the circle covers the control (`data-filled`), and on the plain CSS hover.
 */
export const fillHoverNeutral = cn(
  ROOT,
  'bg-secondary text-ink data-filled:text-onActionLight',
  // The label fades over 100ms, beside the press's own move (lib/press.ts),
  // so its flip keeps pace with the fill instead of snapping.
  'transition-[translate,box-shadow,color] duration-100 ease-out',
  'not-data-fill-hover:hover:bg-actionSecondary not-data-fill-hover:hover:text-onActionLight',
  'active:bg-actionSecondary active:text-onActionLight',
);
export const fillHoverNeutralLayer = cn(LAYER, 'bg-actionSecondary');
