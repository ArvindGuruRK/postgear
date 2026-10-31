import { cva } from 'class-variance-authority';
import { fillHoverNeutral } from '../lib/fill-hover-classes';
import { pressSm } from '../lib/press';
import { cn } from '../lib/utils';

const variants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md border-2 border-outline type-ui',
    'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
    'disabled:opacity-50',
  ],
  {
    // One blue primary per area, the neutral secondary for everything else
    // (2026-10-21), red for deletes and violet (highlight) for a standout action.
    // Every one of them stands on the small shadow, the same 2px one the
    // calendar's Add Channel and Create Post tiles use (2026-10-31, it was the
    // medium one), and sinks into it on hover and press: see lib/press.ts.
    variants: {
      variant: {
        primary: cn(pressSm, 'bg-actionPrimary text-onActionPrimary active:bg-actionPrimaryHover'),
        // The card surface, told apart by its border and shadow, like the
        // calendar's Add Channel tile. On hover a yellow fill wipes in from
        // the pointer and the label turns black (lib/fill-hover.ts).
        secondary: cn(pressSm, fillHoverNeutral),
        danger: cn(pressSm, 'bg-actionDanger text-onActionLight active:brightness-90'),
        // The third button (2026-10-21): violet, for the one standout action that
        // is not the main one. Asking the AI is its first use; the sparkle icon
        // on the button says so, the colour does not have to.
        highlight: cn(pressSm, 'bg-actionAi text-onActionAi active:brightness-90'),
        // An icon-only control on a surface that already has its own border
        // and shadow (a toolbar, a panel header, a step card's hover bar): no
        // border, no shadow, no press. Hover fills with the page ground, like
        // the calendar's channel row menu.
        ghost: 'border-transparent bg-transparent text-ink hover:bg-primary active:bg-primary',
      },
      size: {
        sm: 'h-9 px-4 text-xs',
        md: 'h-11 px-6 text-sm',
        lg: 'h-14 px-8 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

/**
 * Exported (Sprint 4) for the one thing `<Button>` cannot be: a link. A
 * navigation styled as a button must still be an `<a>`, so it can be opened in
 * a new tab and is announced as a link, and hand-copying these classes onto it
 * is exactly the per-screen drift design-system-rules.md exists to prevent.
 *
 * Its own module (2026-10-21) because Button is now a client component and
 * server pages call this. Merged, so a variant's transition replaces the
 * press's instead of competing with it. A link gets the plain CSS hover, not
 * the animated fill.
 */
export function buttonVariants(props?: Parameters<typeof variants>[0]) {
  return cn(variants(props));
}
