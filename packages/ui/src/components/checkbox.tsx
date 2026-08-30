'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Checkbox = forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-5 w-5 shrink-0 rounded-sm border-2 border-outline bg-secondary shadow-brutalSm',
      'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
      'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
      'data-[state=checked]:bg-actionPrimary data-[state=indeterminate]:bg-actionPrimary',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-onActionPrimary">
      {props.checked === 'indeterminate' ? (
        <Minus className="h-4 w-4" strokeWidth={3} />
      ) : (
        <Check className="h-4 w-4" strokeWidth={3} />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
