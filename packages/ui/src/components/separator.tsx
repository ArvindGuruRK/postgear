'use client';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Separator = forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    orientation={orientation}
    decorative={decorative}
    className={cn(
      'shrink-0 bg-outline',
      orientation === 'horizontal' ? 'h-0.5 w-full' : 'h-full w-0.5',
      className,
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;
