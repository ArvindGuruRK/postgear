import { forwardRef } from 'react';
import { cn } from '../lib/utils';

/** A generic toolbar shell — covers both the "search + filter toolbar" and "data table toolbar" patterns. */
export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  start?: React.ReactNode;
  end?: React.ReactNode;
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ className, start, end, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-3 rounded-md border-2 border-outline bg-secondary p-3 shadow-brutalSm',
        'sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">{start}</div>
      {children}
      {end && <div className="flex shrink-0 flex-wrap items-center gap-2">{end}</div>}
    </div>
  ),
);
Toolbar.displayName = 'Toolbar';
