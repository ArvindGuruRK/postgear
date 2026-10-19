'use client';

import { format, startOfDay } from 'date-fns';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/utils';
import { Calendar, CalendarFooter, CalendarTrigger, calendarPopoverClasses } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/**
 * A single day, the date-only sibling of DateTimePicker: the same trigger,
 * popover, calendar and footer. Choosing a day (or Today) closes it; Clear
 * empties the field.
 */
export interface DatePickerProps {
  value?: Date;
  onValueChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** A date-fns pattern for the trigger; by default the viewer's locale decides. */
  dateFormat?: string;
  /** Names the field for assistive technology, e.g. "From". */
  label?: string;
  /** The trigger's id, for an external label or a test. */
  id?: string;
  /** Days before this are greyed out and cannot be picked. */
  minDate?: Date;
  /** Days after this are greyed out and cannot be picked. */
  maxDate?: Date;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  /** A short line in the popover's footer. */
  footnote?: ReactNode;
  /** Draws the trigger as an invalid field (a red border). */
  invalid?: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `2026-10-24`, local: the trigger's `data-value`. */
export function localDayValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The trigger's text: a date-fns pattern if the caller gave one, the locale's otherwise. */
export function formatPickerDay(date: Date, dateFormat?: string): string {
  return dateFormat
    ? format(date, dateFormat)
    : date.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

export function DatePicker({
  value,
  onValueChange,
  placeholder = 'Pick a date',
  disabled,
  className,
  dateFormat,
  label,
  id,
  minDate,
  maxDate,
  side = 'bottom',
  align = 'start',
  footnote,
  invalid = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() => value ?? new Date());

  // Opening shows the month of the chosen date, not wherever it was left.
  // Here rather than in an effect on `value`: callers pass a fresh Date on
  // every render, which would snap the month back while browsing.
  function handleOpenChange(next: boolean) {
    if (next) {
      setMonth(value ?? new Date());
    }
    setOpen(next);
  }

  function choose(date: Date | undefined) {
    onValueChange?.(date);
    setOpen(false);
  }

  const minDay = minDate ? startOfDay(minDate) : undefined;
  const maxDay = maxDate ? startOfDay(maxDate) : undefined;
  const today = startOfDay(new Date());
  const disabledDays = [
    ...(minDay ? [{ before: minDay }] : []),
    ...(maxDay ? [{ after: maxDay }] : []),
  ];

  return (
    // Modal for the same reasons as DateTimePicker's: inside a Dialog it
    // stacks its own scroll lock, and any click outside closes it.
    <Popover modal open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <CalendarTrigger
          id={id}
          disabled={disabled}
          label={label}
          text={value ? formatPickerDay(value, dateFormat) : null}
          placeholder={placeholder}
          dataValue={value ? localDayValue(value) : ''}
          invalid={invalid}
          className={cn('w-full', className)}
        />
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className={calendarPopoverClasses}>
        <Calendar
          mode="single"
          selected={value}
          onSelect={choose}
          month={month}
          onMonthChange={setMonth}
          disabled={disabledDays.length > 0 ? disabledDays : undefined}
          className="p-3"
        />
        <CalendarFooter
          onToday={() => choose(today)}
          todayDisabled={
            (minDay !== undefined && today < minDay) || (maxDay !== undefined && today > maxDay)
          }
          onClear={value ? () => choose(undefined) : undefined}
          note={footnote}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
