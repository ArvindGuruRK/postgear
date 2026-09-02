'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select an option',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  const selected = options.find((option) => option.value === value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-md border-2 border-outline bg-secondary px-4',
            'font-sans text-sm text-ink shadow-brutalSm',
            'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
            className,
          )}
        >
          <span className={cn('truncate', !selected && 'opacity-50')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={3} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: opening the combobox is itself the user's focus action
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className={cn(
            'mb-2 w-full rounded-md border-2 border-outline bg-secondary px-3 py-2 font-sans text-sm text-ink',
            'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          )}
        />
        <div className="max-h-56 overflow-y-auto pg-scrollbar pg-scrollbar-secondary">
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center font-sans text-sm text-ink opacity-60">{emptyText}</p>
          )}
          {filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                onValueChange?.(option.value);
                setOpen(false);
                setQuery('');
              }}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left font-sans text-sm outline-none',
                'hover:bg-actionPrimary hover:text-onActionPrimary',
                'disabled:pointer-events-none disabled:opacity-50',
                option.value === value && 'bg-actionPrimary/10',
              )}
            >
              <Check
                className={cn('h-4 w-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')}
                strokeWidth={3}
              />
              {option.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
