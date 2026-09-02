'use client';

import {
  endOfMonth,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface DateRangePreset {
  label: string;
  /** Built fresh on each open so "Last 7 days" is relative to today, not to mount time. */
  getRange: () => DateRange;
}

export const DEFAULT_DATE_RANGE_PRESETS: DateRangePreset[] = [
  {
    label: 'Today',
    getRange: () => ({ from: startOfDay(new Date()), to: startOfDay(new Date()) }),
  },
  {
    label: 'Yesterday',
    getRange: () => {
      const d = subDays(startOfDay(new Date()), 1);
      return { from: d, to: d };
    },
  },
  {
    label: 'Last 7 days',
    getRange: () => ({ from: subDays(startOfDay(new Date()), 6), to: startOfDay(new Date()) }),
  },
  {
    label: 'Last 30 days',
    getRange: () => ({ from: subDays(startOfDay(new Date()), 29), to: startOfDay(new Date()) }),
  },
  {
    label: 'This month',
    getRange: () => ({ from: startOfMonth(new Date()), to: startOfDay(new Date()) }),
  },
  {
    label: 'Last month',
    getRange: () => {
      const prev = subMonths(new Date(), 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    },
  },
  {
    label: 'Year to date',
    getRange: () => ({ from: startOfYear(new Date()), to: startOfDay(new Date()) }),
  },
];

export interface DateRangePickerProps {
  value?: DateRange;
  onValueChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  dateFormat?: string;
  /** Shortcut list down the left of the panel. Pass [] to hide it. */
  presets?: DateRangePreset[];
  /** Number of months shown side by side. */
  numberOfMonths?: number;
}

function formatRange(range: DateRange | undefined, dateFormat: string) {
  if (!range?.from) return undefined;
  if (!range.to || isSameDay(range.from, range.to)) return format(range.from, dateFormat);
  return `${format(range.from, dateFormat)} – ${format(range.to, dateFormat)}`;
}

export function DateRangePicker({
  value,
  onValueChange,
  placeholder = 'Pick a date range',
  disabled,
  className,
  dateFormat = 'LLL d, y',
  presets = DEFAULT_DATE_RANGE_PRESETS,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  // The panel edits a draft; nothing reaches the caller until Apply, so a
  // half-finished selection or a stray outside click can't clobber the value.
  const [draft, setDraft] = useState<DateRange | undefined>(value);
  // Drives the "what would I get if I clicked here" band while picking the end.
  const [hovered, setHovered] = useState<Date | undefined>();
  // Controlled so choosing a preset can scroll the grid to that range —
  // `defaultMonth` is read once on mount and would leave the view stranded.
  const [month, setMonth] = useState<Date | undefined>(value?.from);

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(value);
      setHovered(undefined);
      setMonth(value?.from ?? new Date());
    }
    setOpen(next);
  }

  const triggerLabel = formatRange(value, dateFormat) ?? placeholder;
  const draftLabel = formatRange(draft, dateFormat);

  const activePreset = useMemo(() => {
    if (!draft?.from || !draft.to) return undefined;
    return presets.find((preset) => {
      const range = preset.getRange();
      return (
        range.from &&
        range.to &&
        draft.from &&
        draft.to &&
        isSameDay(range.from, draft.from) &&
        isSameDay(range.to, draft.to)
      );
    })?.label;
  }, [draft, presets]);

  // Only meaningful between the first and second click of a range.
  const previewRange = useMemo(() => {
    if (!draft?.from || draft.to || !hovered) return undefined;
    return hovered < draft.from
      ? { from: hovered, to: draft.from }
      : { from: draft.from, to: hovered };
  }, [draft, hovered]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-11 w-full items-center gap-2 rounded-md border-2 border-outline bg-secondary px-4',
            'font-sans text-sm text-ink shadow-brutalSm',
            'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2.5} />
          <span className={cn('truncate', !value?.from && 'opacity-50')}>{triggerLabel}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          {presets.length > 0 && (
            <div className="flex shrink-0 flex-row flex-wrap gap-1 border-outline border-b-2 p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    const range = preset.getRange();
                    setDraft(range);
                    setHovered(undefined);
                    if (range.from) setMonth(range.from);
                  }}
                  className={cn(
                    'rounded-md border-2 border-transparent px-3 py-1.5 text-left',
                    'font-sans text-sm text-ink outline-none transition-colors duration-100',
                    'hover:border-outline hover:bg-primary',
                    'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
                    activePreset === preset.label &&
                      'border-outline bg-actionPrimary text-onActionPrimary shadow-brutalSm hover:bg-actionPrimary',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <div className="p-1">
            <Calendar
              mode="range"
              selected={draft}
              onSelect={setDraft}
              numberOfMonths={numberOfMonths}
              month={month}
              onMonthChange={setMonth}
              onDayMouseEnter={(day) => setHovered(day)}
              onDayMouseLeave={() => setHovered(undefined)}
              modifiers={previewRange ? { preview: previewRange } : undefined}
              modifiersClassNames={{
                preview: '[&>button]:border-dashed [&>button]:bg-actionPrimary/15',
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-outline border-t-2 px-3 py-2">
          <span className={cn('font-sans text-sm text-ink', !draftLabel && 'opacity-50')}>
            {draftLabel ?? 'No range selected'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onValueChange?.(undefined);
                setDraft(undefined);
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <Button
              size="sm"
              disabled={!draft?.from || !draft.to}
              onClick={() => {
                onValueChange?.(draft);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
