'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { type VariantProps, cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const ToastProvider = ToastPrimitive.Provider;

/**
 * Every Toast shares this single grid cell (see `col-start-1 row-start-1` in
 * toastVariants below) instead of stacking as separate flex rows — that's
 * what lets several toasts visually overlap into a card deck, with Toaster
 * computing each one's depth offset/scale/opacity as a plain inline style.
 */
export const ToastViewport = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn('fixed bottom-0 right-0 z-[100] grid w-full max-w-sm p-6', className)}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

const toastVariants = cva(
  [
    'relative col-start-1 row-start-1 flex w-full items-center justify-between gap-3 self-end',
    'rounded-md border-2 border-outline p-4 shadow-brutalMd',
    'font-sans text-sm will-change-transform',
    'transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
    'data-[state=open]:animate-toastIn data-[state=closed]:animate-toastOut',
  ],
  {
    variants: {
      variant: {
        default: 'bg-secondary text-ink',
        danger: 'bg-actionDanger text-onActionLight',
        ai: 'bg-actionAi text-onActionAi',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> {}

export const Toast = forwardRef<React.ElementRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, variant, ...props }, ref) => (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  ),
);
Toast.displayName = ToastPrimitive.Root.displayName;

export const ToastTitle = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn('font-display text-base tracking-wide', className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitive.Title.displayName;

export const ToastDescription = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={cn('opacity-80', className)} {...props} />
));
ToastDescription.displayName = ToastPrimitive.Description.displayName;

export const ToastAction = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      'shrink-0 rounded-md border-2 border-outline bg-secondary px-3 py-1.5 shadow-brutalSm',
      'font-display text-xs uppercase tracking-wide text-ink transition-[transform,box-shadow] duration-100',
      'hover:-translate-x-px hover:-translate-y-px hover:shadow-brutalMdHover',
      'active:translate-x-[2px] active:translate-y-[2px] active:shadow-brutalPressed',
      'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitive.Action.displayName;

export const ToastClose = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn('shrink-0 outline-none', className)}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" strokeWidth={3} />
  </ToastPrimitive.Close>
));
ToastClose.displayName = ToastPrimitive.Close.displayName;

export type ToastActionElement = React.ReactElement<typeof ToastAction>;
