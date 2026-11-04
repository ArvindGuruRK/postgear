'use client';

import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';
import { MotionIcon } from './motion-icon';
import { TooltipHint } from './tooltip';

export interface SplitButtonProps extends ComponentProps<typeof Button> {
  /** The chevron's accessible name, e.g. "Choose the test data". */
  menuLabel: string;
  /** The menu's items. */
  menu: ReactNode;
  /** Off by default: the menu often stays useful while the main action is not. */
  menuDisabled?: boolean;
  /** Why the main action is unavailable, shown on hover and focus. */
  hint?: string;
  /** For the chevron, e.g. a test id. */
  menuTriggerProps?: ComponentProps<typeof Button> & Record<`data-${string}`, string>;
}

/**
 * One main action with a chevron beside it for the rest (2026-11-03, after
 * n8n's Publish): Activate in the workflow header, Test Workflow on the canvas.
 * Two Buttons that share a border, so it keeps Button's sizes, variants and press.
 */
export function SplitButton({
  menuLabel,
  menu,
  menuDisabled = false,
  hint,
  menuTriggerProps,
  className,
  variant = 'primary',
  size = 'sm',
  disabled,
  children,
  ...props
}: SplitButtonProps) {
  const main = (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      className={cn('rounded-r-none', className)}
      {...props}
    >
      {children}
    </Button>
  );
  return (
    <div className="flex items-stretch">
      {hint ? (
        <TooltipHint label={hint} disabled={disabled}>
          {main}
        </TooltipHint>
      ) : (
        main
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={menuDisabled}
            aria-label={menuLabel}
            className="rounded-l-none border-l-0 px-2"
            {...menuTriggerProps}
          >
            <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
