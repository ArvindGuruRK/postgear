import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Skeleton = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} aria-hidden="true" className={cn('animate-pulse rounded-md bg-outline/10', className)} {...props} />
  ),
);
Skeleton.displayName = 'Skeleton';
