'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Same border-2/shadow-brutalSm/bg-secondary/border-outline treatment as the
 * rest of the small-surface family (DropdownMenuContent, Toast) so it flips
 * light/dark with the rest of the system, plus a bordered Arrow so it reads
 * as one continuous brutalist shape rather than a floating rectangle.
 */
export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, children, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md border-2 border-outline bg-secondary px-3 py-1.5 shadow-brutalSm',
        'font-sans text-xs leading-snug text-ink',
        'data-[state=delayed-open]:animate-fadeIn',
        className,
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow width={14} height={8} className="fill-secondary stroke-outline stroke-2" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
