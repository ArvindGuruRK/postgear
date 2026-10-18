import type { ForwardRefExoticComponent, RefAttributes } from 'react';

/**
 * Shared by every animated icon (2026-10-19). Kept free of React hooks so
 * server components can import the package's barrel; the hook that plays
 * the icons is `useIconAnimation`, in its own client module.
 */

/** What an `@animateicons/react` icon exposes through its ref. */
export interface IconAnimationHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

/**
 * An `@animateicons/react` icon. Its `className` and other props land on a
 * wrapper element and `size` on the svg, which has `stroke-width="2"` fixed:
 * pass `ANIMATED_ICON_CLASS` for the system's weight and box.
 */
export type AnimatedIcon = ForwardRefExoticComponent<
  {
    size?: number;
    className?: string;
    duration?: number;
    'aria-hidden'?: boolean | 'true' | 'false';
  } & RefAttributes<IconAnimationHandle>
>;

/**
 * What makes an animated icon sit exactly where a lucide one did:
 * - The 2.5 stroke of the system's lucide icons. CSS outranks the svg's own
 *   `stroke-width` attribute.
 * - A block box. The library's wrapper is `inline-flex`, which in a block
 *   parent (a chip's remove button, an absolutely placed toggle) sits on a
 *   text line and grows the parent to the line height; a lucide svg is
 *   `display: block` (Tailwind's preflight). The library joins its classes
 *   without resolving conflicts, so `!block` is what reliably wins.
 */
export const ANIMATED_ICON_CLASS = '!block [&_svg]:[stroke-width:2.5]';

/** The same box for `MotionIcon`, whose stroke width is a prop. */
export const ANIMATED_ICON_BOX = '!block';
