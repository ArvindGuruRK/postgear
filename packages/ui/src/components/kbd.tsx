import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

/**
 * A key cap, after the neobrutalism.dev Kbd (UI revamp, 2026-10-18): a small
 * bordered tile for a keyboard shortcut, in body text or inside a tooltip.
 * Inside a tooltip it swaps to the page color so it still reads as a key on
 * the tooltip's card-colored surface.
 */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-md border-2 border-outline bg-secondary px-1',
        'font-sans type-ui text-[11px] leading-none text-ink',
        'in-data-[slot=tooltip-content]:bg-primary',
        '[&_svg]:h-3 [&_svg]:w-3',
        className,
      )}
      {...props}
    />
  );
}

/** Keys pressed together, e.g. ⌘ then K. */
export function KbdGroup({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  );
}
