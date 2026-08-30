import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const spinnerVariants = cva('animate-spin rounded-full border-outline border-t-transparent', {
  variants: {
    size: {
      sm: 'h-4 w-4 border-2',
      md: 'h-6 w-6 border-2',
      lg: 'h-10 w-10 border-4',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export interface SpinnerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof spinnerVariants> {}

export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(({ className, size, ...props }, ref) => (
  <div
    ref={ref}
    role="status"
    aria-label="Loading"
    className={cn(spinnerVariants({ size }), className)}
    {...props}
  >
    <span className="sr-only">Loading…</span>
  </div>
));
Spinner.displayName = 'Spinner';
