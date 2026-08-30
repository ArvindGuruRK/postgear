'use client';

import { Search, X } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Input, type InputProps } from './input';

export interface SearchInputProps extends InputProps {
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, onClear, value, ...props }, ref) => {
    const hasValue = typeof value === 'string' && value.length > 0;
    return (
      <div className="relative w-full">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink opacity-50"
          strokeWidth={2.5}
        />
        <Input
          ref={ref}
          type="search"
          value={value}
          className={cn(
            'pl-10 [&::-webkit-search-cancel-button]:appearance-none',
            hasValue && onClear && 'pr-10',
            className,
          )}
          {...props}
        />
        {hasValue && onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className={cn(
              'absolute right-3 top-1/2 -translate-y-1/2 text-ink opacity-50 outline-none hover:opacity-100',
              'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
            )}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';
