'use client';

import type { LucideIcon } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Button, type ButtonProps } from './button';

export type StateDisplayTone = 'neutral' | 'danger' | 'success';

export interface StateDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  tone?: StateDisplayTone;
  action?: { label: string; onClick: () => void; variant?: ButtonProps['variant'] };
}

const toneIconClasses: Record<StateDisplayTone, string> = {
  neutral: 'text-ink',
  danger: 'text-actionDanger',
  success: 'text-actionSuccess',
};

/** Shared layout behind EmptyState/ErrorState/SuccessState — icon + heading + description + optional action. */
export const StateDisplay = forwardRef<HTMLDivElement, StateDisplayProps>(
  ({ className, icon: Icon, title, description, tone = 'neutral', action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col items-center justify-center gap-3 p-10 text-center', className)}
      {...props}
    >
      {Icon && (
        <div
          className={cn(
            'rounded-full border-2 border-outline bg-secondary p-4 shadow-brutalSm',
            toneIconClasses[tone],
          )}
        >
          <Icon className="h-8 w-8" strokeWidth={2.5} />
        </div>
      )}
      <p className="font-display text-lg uppercase tracking-wide text-ink">{title}</p>
      {description && (
        <p className="max-w-sm font-sans text-sm font-medium text-ink opacity-70">{description}</p>
      )}
      {action && (
        <Button
          variant={action.variant ?? 'primary'}
          size="sm"
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </Button>
      )}
    </div>
  ),
);
StateDisplay.displayName = 'StateDisplay';

export const EmptyState = forwardRef<HTMLDivElement, Omit<StateDisplayProps, 'tone'>>(
  (props, ref) => <StateDisplay ref={ref} tone="neutral" {...props} />,
);
EmptyState.displayName = 'EmptyState';

export const ErrorState = forwardRef<HTMLDivElement, Omit<StateDisplayProps, 'tone'>>(
  (props, ref) => <StateDisplay ref={ref} tone="danger" {...props} />,
);
ErrorState.displayName = 'ErrorState';

export const SuccessState = forwardRef<HTMLDivElement, Omit<StateDisplayProps, 'tone'>>(
  (props, ref) => <StateDisplay ref={ref} tone="success" {...props} />,
);
SuccessState.displayName = 'SuccessState';
