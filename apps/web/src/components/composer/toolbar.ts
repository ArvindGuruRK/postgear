import { cn } from '@postgear/ui';

/**
 * The editor toolbar's icon buttons and their pressed (format on) state,
 * shared by the formatting buttons in `editor.tsx` and the inserts in
 * `editor-inserts.tsx` so the row reads as one set.
 */
export const TOOL = cn(
  'flex h-8 w-8 items-center justify-center rounded-md border-2 border-transparent text-ink',
  'outline-none hover:border-outline hover:bg-actionPrimary/10',
  'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
  'disabled:pointer-events-none disabled:opacity-50',
  // A popover's trigger: on `aria-expanded`, since a tooltip around the
  // button replaces its `data-state` with its own.
  'aria-expanded:border-outline aria-expanded:bg-actionPrimary/10',
);

export const TOOL_PRESSED =
  'border-outline bg-actionPrimary text-onActionPrimary hover:bg-actionPrimary';
