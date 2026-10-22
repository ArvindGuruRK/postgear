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
import { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { cn } from '../lib/utils';
import { Calendar, CalendarFooter, CalendarTrigger, calendarPopoverClasses } from './calendar';
import { localDayValue } from './date-picker';
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
    label: 'Last 7 Days',
    getRange: () => ({ from: subDays(startOfDay(new Date()), 6), to: startOfDay(new Date()) }),
  },
  {
    label: 'Last 30 Days',
    getRange: () => ({ from: subDays(startOfDay(new Date()), 29), to: startOfDay(new Date()) }),
  },
  {
    label: 'This Month',
    getRange: () => ({ from: startOfMonth(new Date()), to: startOfDay(new Date()) }),
  },
  {
    label: 'Last Month',
    getRange: () => {
      const prev = subMonths(new Date(), 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    },
  },
  {
    label: 'Year To Date',
    getRange: () => ({ from: startOfYear(new Date()), to: startOfDay(new Date()) }),
  },
];

/**
 * A span of days, the range sibling of DateTimePicker: the same trigger,
 * popover, calendar and footer, with shortcuts down the side.
 *
 * Like the other pickers, a choice applies as it is made and Done only
 * closes. The first click on the grid starts a new range and the second ends
 * it (in either order); a range left with only its first day applies as that
 * one day when the popover closes.
 */
export interface DateRangePickerProps {
  value?: DateRange;
  onValueChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** A date-fns pattern for the dates; by default the viewer's locale decides. */
  dateFormat?: string;
  /** Shortcut list down the left of the panel. Pass [] to hide it. */
  presets?: DateRangePreset[];
  /** Number of months shown side by side. */
  numberOfMonths?: number;
  /** Names the field for assistive technology, e.g. "Date range". */
  label?: string;
  /** The trigger's id, for an external label or a test. */
  id?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}

function formatDay(date: Date, dateFormat: string | undefined) {
  return dateFormat
    ? format(date, dateFormat)
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRange(range: DateRange | undefined, dateFormat: string | undefined) {
  if (!range?.from) return null;
  if (!range.to || isSameDay(range.from, range.to)) return formatDay(range.from, dateFormat);
  return `${formatDay(range.from, dateFormat)} – ${formatDay(range.to, dateFormat)}`;
}

export function DateRangePicker({
  value,
  onValueChange,
  placeholder = 'Pick a date range',
  disabled,
  className,
  dateFormat,
  presets = DEFAULT_DATE_RANGE_PRESETS,
  numberOfMonths = 2,
  label,
  id,
  side = 'bottom',
  align = 'start',
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  // What the grid shows: the value, or a range whose end is still to come.
  const [draft, setDraft] = useState<DateRange | undefined>(value);
  // The first day of a range being picked; the next click ends it.
  const [anchor, setAnchor] = useState<Date | undefined>();
  // Drives the "what would I get if I clicked here" band while picking the end.
  const [hovered, setHovered] = useState<Date | undefined>();
  // Controlled so choosing a preset can scroll the grid to that range:
  // `defaultMonth` is read once on mount and would leave the view stranded.
  const [month, setMonth] = useState<Date | undefined>(value?.from);

  function apply(range: DateRange | undefined) {
    setDraft(range);
    setAnchor(undefined);
    setHovered(undefined);
    onValueChange?.(range);
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(value);
      setAnchor(undefined);
      setHovered(undefined);
      setMonth(value?.from ?? new Date());
    } else if (anchor) {
      apply({ from: anchor, to: anchor });
    }
    setOpen(next);
  }

  function pick(day: Date) {
    if (!anchor) {
      setAnchor(day);
      setDraft({ from: day, to: undefined });
      return;
    }
    apply(day < anchor ? { from: day, to: anchor } : { from: anchor, to: day });
  }

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
    if (!anchor || !hovered) return undefined;
    return hovered < anchor ? { from: hovered, to: anchor } : { from: anchor, to: hovered };
  }, [anchor, hovered]);

  return (
    // Modal for the same reasons as DateTimePicker's: inside a Dialog it
    // stacks its own scroll lock, and any click outside closes it.
    <Popover modal open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <CalendarTrigger
          id={id}
          disabled={disabled}
          label={label}
          text={formatRange(value, dateFormat)}
          placeholder={placeholder}
          // `2026-10-20/2026-10-24`: both ends, local, as an ISO 8601 interval.
          dataValue={
            value?.from
              ? `${localDayValue(value.from)}/${localDayValue(value.to ?? value.from)}`
              : ''
          }
          className={cn('w-full', className)}
        />
      </PopoverTrigger>

      <PopoverContent side={side} align={align} className={calendarPopoverClasses}>
        <div className="flex flex-col sm:flex-row">
          {presets.length > 0 && (
            <div className="flex shrink-0 flex-row flex-wrap gap-1 border-outline border-b-2 p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    const range = preset.getRange();
                    apply(range);
                    if (range.from) setMonth(range.from);
                  }}
                  className={cn(
                    'rounded-md border-2 border-transparent px-3 py-1.5 text-left',
                    'font-sans text-sm text-ink outline-none transition-colors duration-100',
                    'hover:border-outline hover:bg-primary',
                    'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                    activePreset === preset.label &&
                      'border-outline bg-actionPrimary text-onActionPrimary shadow-surfaceSm hover:bg-actionPrimary',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <Calendar
            mode="range"
            selected={draft}
            // The grid's own range rules extend the old range on every click;
            // this picker starts a fresh one instead, so only the day is used.
            onSelect={(_, day) => pick(day)}
            numberOfMonths={numberOfMonths}
            month={month}
            onMonthChange={setMonth}
            onDayMouseEnter={(day) => setHovered(day)}
            onDayMouseLeave={() => setHovered(undefined)}
            modifiers={previewRange ? { preview: previewRange } : undefined}
            modifiersClassNames={{
              preview: '[&>button]:border-dashed [&>button]:bg-actionPrimary/15',
            }}
            className="p-3"
          />
        </div>

        <CalendarFooter
          onClear={
            value?.from || draft?.from
              ? () => {
                  apply(undefined);
                  setOpen(false);
                }
              : undefined
          }
          note={anchor ? 'Now pick the last day' : formatRange(draft, dateFormat)}
          onDone={() => handleOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
