import { cn } from './utils';

/**
 * The one toggle bar in the app (the owner's call, 2026-11-04). Tabs,
 * ViewSwitcher, Segmented and the few bars built by hand all take these, so
 * they cannot drift apart. It is the calendar's Day / Week / Month switch as it
 * stood: a frame, and the chosen option as a blue tile with an outline of its
 * own and no shadow.
 */
export const SEGMENT_FRAME = 'min-h-10 gap-1 rounded-lg border-2 border-outline bg-chrome p-0.5';

/**
 * One option. Its 4px corners are the frame's 8px less the frame's 4px inset
 * (2px border, 2px padding), so the tile's corners run parallel to the frame's.
 */
export const SEGMENT = cn(
  'relative flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded border-2 px-3 type-ui text-sm',
  'outline-none transition-colors motion-reduce:transition-none',
  'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
  'disabled:pointer-events-none disabled:opacity-50',
);

/** An option in words: at least as wide as the calendar's, so a short word is not a small tile. */
export const SEGMENT_WORDS = 'sm:min-w-[4.625rem]';

/** An option that is only an icon. */
export const SEGMENT_ICON = 'w-9 px-0';

/** An option as a whole, for a bar built by hand. */
export const segment = (active: boolean) =>
  cn(
    SEGMENT,
    active
      ? 'border-outline bg-actionPrimary text-onActionPrimary'
      : 'border-transparent text-ink hover:bg-primary',
  );
