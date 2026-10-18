'use client';

import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';

export const Accordion = AccordionPrimitive.Root;

export const AccordionItem = forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn(
      'overflow-hidden rounded-md border-2 border-outline bg-secondary shadow-surfaceSm',
      className,
    )}
    {...props}
  />
));
AccordionItem.displayName = AccordionPrimitive.Item.displayName;

export const AccordionTrigger = forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        'group/accordion flex flex-1 items-center justify-between gap-2 px-4 py-3 text-left',
        'type-ui text-sm text-ink outline-none',
        'bg-secondary transition-colors duration-150 hover:bg-primary',
        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        // The divider belongs to the header, not the sliding panel, so the
        // card reads as one surface growing downward rather than a separate
        // block sliding out from under a lid. The border is always present and
        // only changes color: toggling its width would resize the header by
        // 2px mid-animation and make the open/close jump.
        'border-b-2 border-transparent data-[state=open]:rounded-b-none data-[state=open]:border-outline',
        className,
      )}
      {...props}
    >
      {children}
      <MotionIcon
        icon={ChevronDownIcon}
        className="h-4 w-4 shrink-0 transition-[rotate] duration-200 group-data-[state=open]/accordion:rotate-180"
        strokeWidth={3}
      />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

export const AccordionContent = forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className={cn(
      'overflow-hidden bg-secondary font-sans text-sm text-ink',
      'data-[state=closed]:animate-accordionUp data-[state=open]:animate-accordionDown',
    )}
    {...props}
  >
    <div className={cn('px-4 py-3 opacity-90', className)}>{children}</div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = AccordionPrimitive.Content.displayName;
