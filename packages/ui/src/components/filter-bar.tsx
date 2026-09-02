'use client';

import { X } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Badge } from './badge';

export interface FilterChip {
  id: string;
  label: string;
}

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  filters: FilterChip[];
  onRemove?: (id: string) => void;
  onClearAll?: () => void;
}

export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(
  ({ className, filters, onRemove, onClearAll, ...props }, ref) => {
    if (filters.length === 0) return null;
    return (
      <div ref={ref} className={cn('flex flex-wrap items-center gap-2', className)} {...props}>
        {filters.map((filter) => (
          <Badge key={filter.id} variant="outline" className="gap-1.5 pr-1.5">
            {filter.label}
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove ${filter.label} filter`}
                onClick={() => onRemove(filter.id)}
                className="rounded-full outline-none hover:opacity-70"
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            )}
          </Badge>
        ))}
        {onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className={cn(
              'font-sans text-xs font-semibold text-actionPrimary underline underline-offset-2 outline-none',
              'hover:opacity-70',
            )}
          >
            Clear all
          </button>
        )}
      </div>
    );
  },
);
FilterBar.displayName = 'FilterBar';
