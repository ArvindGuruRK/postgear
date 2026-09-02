'use client';

import * as NavigationMenuPrimitive from '@radix-ui/react-navigation-menu';
import { ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const NavigationMenu = forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Root
    ref={ref}
    className={cn('relative z-10 flex max-w-max flex-1 items-center justify-center', className)}
    {...props}
  >
    {children}
    <NavigationMenuViewport />
  </NavigationMenuPrimitive.Root>
));
NavigationMenu.displayName = NavigationMenuPrimitive.Root.displayName;

export const NavigationMenuList = forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.List>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.List
    ref={ref}
    className={cn('flex flex-1 list-none items-center gap-1', className)}
    {...props}
  />
));
NavigationMenuList.displayName = NavigationMenuPrimitive.List.displayName;

export const NavigationMenuItem = NavigationMenuPrimitive.Item;

export const NavigationMenuTrigger = forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Trigger
    ref={ref}
    className={cn(
      'group inline-flex items-center gap-1 rounded-md border-2 border-outline bg-secondary px-4 py-2',
      'font-display text-xs uppercase tracking-wide text-ink shadow-brutalSm transition-[transform,box-shadow] duration-100',
      'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
      'data-[state=open]:bg-actionPrimary data-[state=open]:text-onActionPrimary',
      className,
    )}
    {...props}
  >
    {children}
    <ChevronDown
      className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180"
      strokeWidth={3}
      aria-hidden="true"
    />
  </NavigationMenuPrimitive.Trigger>
));
NavigationMenuTrigger.displayName = NavigationMenuPrimitive.Trigger.displayName;

/**
 * No border/bg/shadow here — the Viewport below already renders that chrome
 * as a single shared surface all Content panels animate inside. Content
 * previously duplicated the same border-4/shadow-brutalLg/bg-secondary,
 * producing two offset bordered boxes stacked on top of each other (visible
 * as a thick double outline with an overlapping second card edge).
 */
export const NavigationMenuContent = forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Content ref={ref} className={cn('w-full p-2 sm:w-72', className)} {...props} />
));
NavigationMenuContent.displayName = NavigationMenuPrimitive.Content.displayName;

/**
 * Styled as a selectable row (same shape as DropdownMenuItem: full-width,
 * padded, solid hover/active fill) instead of bare inline text — a mega-menu
 * link list should read as a menu, not a stack of underlined hyperlinks.
 */
export const NavigationMenuLink = forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Link>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Link>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Link
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center rounded-md px-3 py-2 outline-none transition-colors',
      'font-sans text-sm text-ink',
      'hover:bg-actionPrimary hover:text-onActionPrimary',
      'focus-visible:bg-actionPrimary focus-visible:text-onActionPrimary',
      'data-[active]:bg-actionPrimary data-[active]:text-onActionPrimary',
      className,
    )}
    {...props}
  />
));
NavigationMenuLink.displayName = NavigationMenuPrimitive.Link.displayName;

export const NavigationMenuViewport = forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <div className="absolute left-0 top-full flex justify-center">
    <NavigationMenuPrimitive.Viewport
      ref={ref}
      className={cn(
        'mt-2 h-[var(--radix-navigation-menu-viewport-height)] w-full origin-top-center overflow-hidden rounded-lg border-4 border-outline bg-secondary shadow-brutalLg sm:w-[var(--radix-navigation-menu-viewport-width)]',
        className,
      )}
      {...props}
    />
  </div>
));
NavigationMenuViewport.displayName = NavigationMenuPrimitive.Viewport.displayName;
