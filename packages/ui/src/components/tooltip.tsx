'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  type ComponentProps,
  cloneElement,
  forwardRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../lib/utils';

/**
 * Tooltips (UI revamp, 2026-10-18), styled after the neobrutalism.dev
 * tooltip: a flat bordered label with no arrow and no shadow, which slides a
 * few pixels in from the side it opens on. Built on Radix like every other
 * overlay here, rather than the Base UI primitive that library ships, so it
 * shares the focus, portal and collision behaviour of the dropdowns and
 * popovers next to it.
 *
 * Tooltips are for names and short hints only: an icon button's label, why a
 * control is disabled, a keyboard shortcut (`Kbd`). Anything a person must
 * read to finish a task belongs on the page, since touch screens never hover.
 */

/**
 * One provider at the app root (apps/web/src/app/layout.tsx) serves every
 * tooltip. 150ms before the first one opens, so sweeping the pointer across a
 * toolbar does not flash a label on every button, and then none while moving
 * between neighbours for 300ms, so reading along a row stays instant.
 */
export function TooltipProvider({
  delayDuration = 150,
  skipDelayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn(
        'z-50 flex max-w-xs items-center gap-2 rounded-md border-2 border-outline bg-secondary px-3 py-1.5',
        'font-sans text-xs leading-snug text-ink',
        // Enters from the side it opens on: the offset each side sets is
        // read by the keyframe (packages/config/tailwind.css, tooltipIn).
        'origin-(--radix-tooltip-content-transform-origin) animate-tooltipIn motion-reduce:animate-none',
        'data-[side=top]:[--pg-tooltip-y:4px] data-[side=bottom]:[--pg-tooltip-y:-4px]',
        'data-[side=left]:[--pg-tooltip-x:4px] data-[side=right]:[--pg-tooltip-x:-4px]',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export interface TooltipHintProps {
  /** The text shown, and the name a hover reveals. */
  label: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Shown after the label, e.g. `<Kbd>⌘K</Kbd>`. */
  shortcut?: ReactNode;
  /**
   * The trigger is disabled. A disabled button receives no pointer or focus
   * events, so its tooltip could never open; the child is wrapped in a
   * focusable span that hovers and focuses on its behalf.
   */
  disabled?: boolean;
  /** Not shown at all, e.g. once a collapsed control has its label back. */
  hidden?: boolean;
  /** Layout for the disabled wrapper, e.g. `flex-1` when the control fills a row. */
  triggerClassName?: string;
  /** One element, typically an icon button that carries its own aria-label. */
  children: ReactElement;
}

/**
 * The common case in one line: a label on hover and keyboard focus for an
 * icon-only control.
 *
 * The tooltip names the control for sighted pointer and keyboard users; it
 * does not replace the control's own `aria-label`, which is what a screen
 * reader announces (Radix also links the open tooltip by aria-describedby).
 */
export function TooltipHint({
  label,
  side = 'top',
  align = 'center',
  shortcut,
  disabled = false,
  hidden = false,
  triggerClassName,
  children,
}: TooltipHintProps) {
  if (hidden) {
    return children;
  }

  const trigger = disabled ? (
    <span
      // biome-ignore lint/a11y/noNoninteractiveTabindex: lets a disabled control's reason be reached by keyboard
      tabIndex={0}
      className={cn(
        'inline-flex rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        triggerClassName,
      )}
    >
      {isValidElement<{ className?: string }>(children)
        ? cloneElement(children, {
            // The span takes the events; the button must not swallow them.
            className: cn(children.props.className, 'pointer-events-none'),
          })
        : children}
    </span>
  ) : (
    children
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        <span>{label}</span>
        {shortcut}
      </TooltipContent>
    </Tooltip>
  );
}
