'use client';

import { ClockIcon } from '@animateicons/react/lucide/clock-icon';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keyTile } from '../lib/key-tile';
import { cn } from '../lib/utils';
import { CalendarFooter, CalendarTrigger, calendarPopoverClasses } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const MINUTE_STEP = 5;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const pad = (value: number) => String(value).padStart(2, '0');

/** `{ hours: 14, minutes: 5 }` from "14:05"; null for anything else. */
export function parseTime(value: string | null | undefined): {
  hours: number;
  minutes: number;
} | null {
  const match = value ? TIME_PATTERN.exec(value) : null;
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

/** "14:05" as the viewer's clock says it: "2:05 PM", or "14:05". */
export function timeText(value: string, twelveHour: boolean): string {
  const time = parseTime(value);
  if (!time || !twelveHour) return value;
  return `${time.hours % 12 || 12}:${pad(time.minutes)} ${time.hours >= 12 ? 'PM' : 'AM'}`;
}

function uses12HourClock(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

/** Whether the viewer's clock runs to 12. Known after mount: the server does not know it. */
export function useTwelveHourClock(): boolean {
  const [twelveHour, setTwelveHour] = useState(true);
  useEffect(() => {
    setTwelveHour(uses12HourClock());
  }, []);
  return twelveHour;
}

/**
 * The time columns of every picker that has them, filling a positioned box of
 * the caller's size (`w-56`, or `w-40` with no AM / PM column) and scrolling
 * inside it, so their long lists cannot set its height.
 *
 * - The clock follows the viewer's locale: hours 1 to 12 with AM / PM where
 *   that is the convention, 00 to 23 otherwise.
 * - Minutes step by 5, the way people schedule; a time already on another
 *   minute (a channel's 9:20 posting slot) is kept and shown in the list.
 */
export function TimeColumns({
  hours,
  minutes,
  twelveHour,
  onChange,
  open,
}: {
  /** 0 to 23, whichever clock is shown. */
  hours: number;
  minutes: number;
  twelveHour: boolean;
  onChange: (hours: number, minutes: number) => void;
  /** Whether the popover is open, to bring the chosen keys into view as it opens. */
  open: boolean;
}) {
  const pm = hours >= 12;
  const hourOptions = twelveHour
    ? Array.from({ length: 12 }, (_, index) => index + 1)
    : Array.from({ length: 24 }, (_, index) => index);
  const minuteOptions = Array.from(
    new Set([...Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP), minutes]),
  ).sort((a, b) => a - b);

  return (
    <div className="absolute inset-0 flex gap-1.5 p-3">
      <TimeColumn
        label="Hour"
        options={hourOptions.map((hour) => ({
          value: hour,
          text: twelveHour ? String(hour) : pad(hour),
        }))}
        selected={twelveHour ? hours % 12 || 12 : hours}
        onSelect={(hour) => onChange(twelveHour ? (hour % 12) + (pm ? 12 : 0) : hour, minutes)}
        open={open}
      />
      <TimeColumn
        label="Minute"
        options={minuteOptions.map((minute) => ({ value: minute, text: pad(minute) }))}
        selected={minutes}
        onSelect={(minute) => onChange(hours, minute)}
        open={open}
      />
      {twelveHour ? (
        <TimeColumn
          label="AM or PM"
          shortLabel="AM/PM"
          options={[
            { value: 0, text: 'AM' },
            { value: 1, text: 'PM' },
          ]}
          selected={pm ? 1 : 0}
          onSelect={(period) => onChange((hours % 12) + (period === 1 ? 12 : 0), minutes)}
          open={open}
        />
      ) : null}
    </div>
  );
}

/**
 * One scrolling column of time keys: the chosen one is the primary fill, as
 * on the calendar's grid, and is scrolled into view each time the popover
 * opens.
 */
function TimeColumn({
  label,
  shortLabel,
  options,
  selected,
  onSelect,
  open,
}: {
  label: string;
  shortLabel?: string;
  options: Array<{ value: number; text: string }>;
  selected: number;
  onSelect: (value: number) => void;
  open: boolean;
}) {
  const list = useRef<HTMLFieldSetElement>(null);
  const chosen = useRef<HTMLButtonElement>(null);

  // Centres the chosen key in its own column only; scrollIntoView would also
  // scroll the page or the dialog behind the popover.
  useLayoutEffect(() => {
    if (open && list.current && chosen.current) {
      list.current.scrollTop =
        chosen.current.offsetTop - list.current.clientHeight / 2 + chosen.current.clientHeight / 2;
    }
  }, [open]);

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <span
        aria-hidden="true"
        className="text-center font-sans text-[11px] font-bold text-ink opacity-60"
      >
        {shortLabel ?? label}
      </span>
      <fieldset
        ref={list}
        className="relative m-0 flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto border-0 p-0 pe-1 pg-scrollbar pg-scrollbar-secondary"
      >
        <legend className="sr-only">{label}</legend>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.value}
              ref={isSelected ? chosen : undefined}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option.value)}
              className={cn(
                'h-9 w-12 shrink-0 font-sans text-sm tabular-nums',
                keyTile(isSelected),
                isSelected && 'shadow-surfaceSm',
              )}
            >
              {option.text}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

export interface TimePickerProps {
  /** The time as "HH:MM" on a 24 hour clock, whichever clock the viewer sees. */
  value: string | null;
  onValueChange: (value: string) => void;
  /** Names the field for assistive technology, e.g. "Time". */
  label: string;
  disabled?: boolean;
  placeholder?: string;
  /** Where the popover opens; near the bottom of the screen, `top`. */
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** The trigger's id, for an external label or a test. */
  id?: string;
  /** A short line in the popover's footer, e.g. which time zone this is. */
  footnote?: ReactNode;
  /** Draws the trigger as an invalid field (a red border). */
  invalid?: boolean;
}

/**
 * A time of day on its own (2026-11-04): the date and time picker's columns in
 * a popover under a field-style trigger. It opens lists, so the trigger is flat
 * like a dropdown's, and it sits level beside one.
 */
export function TimePicker({
  value,
  onValueChange,
  label,
  disabled = false,
  placeholder = 'Pick a time',
  side = 'bottom',
  align = 'start',
  className,
  id,
  footnote,
  invalid = false,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const twelveHour = useTwelveHourClock();
  const parsed = parseTime(value);
  // Where an empty field starts.
  const current = parsed ?? { hours: 9, minutes: 0 };

  return (
    // Modal for the columns' scrolling, as in `DateTimePicker`: inside a Dialog
    // they would otherwise only move by dragging the scrollbar.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CalendarTrigger
          id={id}
          disabled={disabled}
          label={label}
          icon={ClockIcon}
          text={parsed && value ? timeText(value, twelveHour) : null}
          placeholder={placeholder}
          dataValue={value ?? ''}
          invalid={invalid}
          className={cn('px-4 shadow-none', className)}
        />
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className={calendarPopoverClasses}>
        <div className={cn('relative h-60', twelveHour ? 'w-56' : 'w-40')}>
          <TimeColumns
            hours={current.hours}
            minutes={current.minutes}
            twelveHour={twelveHour}
            onChange={(hours, minutes) => onValueChange(`${pad(hours)}:${pad(minutes)}`)}
            open={open}
          />
        </div>
        <CalendarFooter note={footnote} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
