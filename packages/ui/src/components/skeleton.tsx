import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Skeleton = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-outline/10 motion-reduce:animate-none', className)}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';
