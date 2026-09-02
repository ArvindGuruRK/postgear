'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ViewOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

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
      className={cn(
        'inline-flex items-center gap-1 rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm',
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            aria-label={option.label}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md outline-none transition-colors',
              'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              isActive ? 'bg-actionPrimary text-onActionPrimary' : 'text-ink hover:bg-actionPrimary/10',
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2.5} />
          </button>
        );
      })}
    </div>
  );
}
