'use client';

import type { LucideIcon } from 'lucide-react';
import type { AnimatedIcon } from '../lib/icon-animation';
import { SEGMENT_FRAME, SEGMENT_ICON, segment } from '../lib/segmented';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';
import { TooltipHint } from './tooltip';

/** Each option shows a static or an animated icon, never both. */
export type ViewOption = { value: string; label: string } & (
  | { icon: LucideIcon; animatedIcon?: never }
  | { animatedIcon: AnimatedIcon; icon?: never }
);

export interface ViewSwitcherProps {
  options: ViewOption[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function ViewSwitcher({ options, value, onValueChange, className }: ViewSwitcherProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a div[role=group] toolbar of buttons is the standard ARIA pattern here, not a form fieldset
    <div
      role="group"
      aria-label="View"
      className={cn('inline-flex items-center', SEGMENT_FRAME, className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === value;
        return (
          // The icons alone do not say which is which: each names itself on
          // hover and keyboard focus. Above the switch, clear of its border
          // ; not hoverable, because the buttons sit flush and an
          // open tooltip would otherwise linger over the next one.
          <TooltipHint
            key={option.value}
            label={option.label}
            side="top"
            sideOffset={10}
            hoverable={false}
          >
            <button
              type="button"
              aria-pressed={isActive}
              aria-label={option.label}
              onClick={() => onValueChange(option.value)}
              className={cn(segment(isActive), SEGMENT_ICON)}
            >
              {option.animatedIcon ? (
                <MotionIcon icon={option.animatedIcon} className="h-4 w-4" />
              ) : Icon ? (
                <Icon className="h-4 w-4" strokeWidth={2.5} />
              ) : null}
            </button>
          </TooltipHint>
        );
      })}
    </div>
  );
}
