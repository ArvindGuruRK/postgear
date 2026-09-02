'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      // Body face, NOT font-display (changed 2026-09-02, product decision —
      // design-system-rules.md §1 was updated in the same change and used to
      // say the opposite). Form controls are the one place the comic display
      // face doesn't belong: a label is read while typing, directly above
      // input text that is itself font-sans, so Bangers made a field and its
      // own label look like two different systems.
      //
      // These exact classes match the specimen captions in the /dev/components
      // playground (`Row` in apps/web/src/app/dev/components/shared.tsx) —
      // sentence case, no letter-spacing, font-bold. Don't reintroduce
      // `uppercase`/`tracking-wide` here: shouting is for chrome you act on
      // (buttons, tabs, badges), not for the thing naming the box you type in.
      // font-bold (700) is real on Plus Jakarta Sans, not synthetic, and holds
      // the presence Bangers' single heavy weight used to carry.
      'font-sans text-sm font-bold text-ink',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
