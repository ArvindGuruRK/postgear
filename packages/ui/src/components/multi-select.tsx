'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { Badge } from './badge';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value?: string[];
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

export function MultiSelect({
  options,
  value = [],
  onValueChange,
  placeholder = 'Select options',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  disabled,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  const toggle = (optionValue: string) => {
    const next = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onValueChange?.(next);
  };

  const selectedOptions = options.filter((option) => value.includes(option.value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(event) => {
            if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            'flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border-2 border-outline bg-secondary px-3 py-2',
            'font-sans text-sm text-ink shadow-brutalSm',
            'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            disabled ? 'cursor-not-allowed opacity-50 shadow-none' : 'cursor-pointer',
            className,
          )}
        >
          {selectedOptions.length === 0 ? (
            <span className="opacity-50">{placeholder}</span>
          ) : (
            selectedOptions.map((option) => (
              <Badge key={option.value} variant="outline" className="gap-1 pr-1">
                {option.label}
                <button
                  type="button"
                  aria-label={`Remove ${option.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(option.value);
                  }}
                  className="rounded-full outline-none hover:opacity-70"
                >
                  <X className="h-3 w-3" strokeWidth={3} />
                </button>
              </Badge>
            ))
          )}
          <ChevronDown className="ml-auto h-4 w-4 shrink-0" strokeWidth={3} />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: opening the multi-select is itself the user's focus action
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
          {filtered.map((option) => {
            const isSelected = value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => toggle(option.value)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left font-sans text-sm outline-none',
                  'hover:bg-actionPrimary hover:text-onActionPrimary',
                  'disabled:pointer-events-none disabled:opacity-50',
                  isSelected && 'bg-actionPrimary/10',
                )}
              >
                <Check
                  className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                  strokeWidth={3}
                />
                {option.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
