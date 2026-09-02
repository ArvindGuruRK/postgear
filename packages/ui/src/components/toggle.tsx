'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Toggle = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-outline bg-secondary p-0.5',
      'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-actionPrimary',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'block h-5 w-5 rounded-full border-2 border-outline bg-outline transition-transform duration-100',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Toggle.displayName = SwitchPrimitive.Root.displayName;
