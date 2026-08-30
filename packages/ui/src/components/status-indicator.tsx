import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const dotVariants = cva('h-2.5 w-2.5 shrink-0 rounded-full border border-outline', {
  variants: {
    status: {
      online: 'bg-actionSuccess',
      offline: 'bg-ink opacity-30',
      busy: 'bg-actionDanger',
      away: 'bg-actionAccent',
      pending: 'bg-actionSecondary',
    },
  },
  defaultVariants: {
    status: 'offline',
  },
});

export interface StatusIndicatorProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof dotVariants> {
  label?: string;
}

export const StatusIndicator = forwardRef<HTMLSpanElement, StatusIndicatorProps>(
  ({ className, status, label, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('inline-flex items-center gap-2 font-sans text-sm text-ink', className)}
      {...props}
    >
      <span className={dotVariants({ status })} aria-hidden="true" />
      {label}
    </span>
  ),
);
StatusIndicator.displayName = 'StatusIndicator';
