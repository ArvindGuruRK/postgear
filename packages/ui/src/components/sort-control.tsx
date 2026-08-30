'use client';

import { ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export interface SortOption {
  value: string;
  label: string;
}

export interface SortControlProps {
  options: SortOption[];
  value: string;
  onValueChange: (value: string) => void;
  direction: 'asc' | 'desc';
  onDirectionChange: (direction: 'asc' | 'desc') => void;
  className?: string;
}

export function SortControl({
  options,
  value,
  onValueChange,
  direction,
  onDirectionChange,
  className,
}: SortControlProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
        onClick={() => onDirectionChange(direction === 'asc' ? 'desc' : 'asc')}
        className="px-3"
      >
        {direction === 'asc' ? (
          <ArrowUpAZ className="h-4 w-4" strokeWidth={2.5} />
        ) : (
          <ArrowDownAZ className="h-4 w-4" strokeWidth={2.5} />
        )}
      </Button>
    </div>
  );
}
