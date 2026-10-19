'use client';

import { XIcon } from '@animateicons/react/lucide/x-icon';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-outline/60 data-[state=open]:animate-fadeIn', className)}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * A sheet runs to the screen's edges, and with the app's `viewport-fit=cover`
 * (apps/web/src/app/layout.tsx) a phone's notch and home indicator sit over
 * some of them. On each screen edge it touches, the sheet carries that edge's
 * safe-area inset as a transparent border. A background paints under its
 * border, so the surface still fills the notch, while the content box, and
 * the close button positioned inside it, start clear of it.
 *
 * A border rather than padding, so it holds whatever padding a caller sets
 * (the calendar's channel sheet is `p-0` with padding inside), and a
 * scrolling sheet clips its content below the notch instead of scrolling it
 * under. `env()` is 0 on screens without one: no border, nothing moves.
 */
const SAFE = {
  top: 'border-t-[length:env(safe-area-inset-top)] border-t-transparent',
  right: 'border-r-[length:env(safe-area-inset-right)] border-r-transparent',
  bottom: 'border-b-[length:env(safe-area-inset-bottom)] border-b-transparent',
  left: 'border-l-[length:env(safe-area-inset-left)] border-l-transparent',
};

const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-4 border-outline bg-secondary p-6 shadow-surfaceLg outline-none',
  {
    variants: {
      side: {
        right: cn(
          'inset-y-0 right-0 h-full w-full max-w-md border-l-2',
          SAFE.top,
          SAFE.right,
          SAFE.bottom,
        ),
        left: cn(
          'inset-y-0 left-0 h-full w-full max-w-md border-r-2',
          SAFE.top,
          SAFE.left,
          SAFE.bottom,
        ),
        top: cn('inset-x-0 top-0 w-full border-b-2', SAFE.top, SAFE.left, SAFE.right),
        bottom: cn('inset-x-0 bottom-0 w-full border-t-2', SAFE.bottom, SAFE.left, SAFE.right),
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
);

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

export const SheetContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side, className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      {/* Inside the safe-area border (see SAFE), so it clears a notch too. */}
      <DialogPrimitive.Close
        className={cn(
          'absolute right-4 top-4 rounded-md border-2 border-outline bg-secondary p-1',
          'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        )}
      >
        <MotionIcon icon={XIcon} className="h-4 w-4 text-ink" strokeWidth={3} />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
);

export const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-auto flex items-center justify-end gap-3', className)} {...props} />
);

export const SheetTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('type-heading text-2xl text-ink', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

export const SheetDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('font-sans text-sm font-medium text-ink opacity-70', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;
