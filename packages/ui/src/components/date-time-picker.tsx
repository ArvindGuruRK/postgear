'use client';

import { CalendarIcon } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FIELD_FOCUS } from '../lib/field';
import { cn } from '../lib/utils';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/**
 * A date and a time in one field (UI revamp, 2026-10-19): the design
 * system's Calendar beside time columns built from the same key tiles, in a
 * popover under a field-style trigger. Replaces the browser's own
 * `datetime-local` picker, which cannot be styled and looked foreign in every
 * theme.
 *
 * - Choosing a day keeps the time; choosing a time keeps the day.
 * - The clock follows the viewer's locale: hours 1 to 12 with AM / PM where
 *   that is the convention, 00 to 23 otherwise.
 * - Minutes step by 5, the way people schedule; a time already on another
 *   minute (a channel's 9:20 posting slot) is kept and shown in the list.
 * - Everything is local time. Callers convert at their own edges.
 *
 * The trigger's text is set after mount: the date is formatted in the
 * viewer's locale and time zone, which the server rendering this does not
 * share, and a server-formatted label would mismatch on hydration.
 */
export interface DateTimePickerProps {
  value: Date | null;
  onValueChange: (value: Date) => void;
  /** Names the field for assistive technology, e.g. "Publish at". */
  label: string;
  disabled?: boolean;
  placeholder?: string;
  /** Days before this are greyed out and cannot be picked. */
  minDate?: Date;
  /** Where the popover opens; near the bottom of the screen, `top`. */
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** The trigger's id, for an external label or a test. */
  id?: string;
  /** A short line in the popover's footer, e.g. which time zone this is. */
  footnote?: ReactNode;
}

const MINUTE_STEP = 5;

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** The next whole hour from now: where an empty field starts. */
function nextHour(): Date {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function uses12HourClock(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

const pad = (value: number) => String(value).padStart(2, '0');

function localValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateTimePicker({
  value,
  onValueChange,
  label,
  disabled = false,
  placeholder = 'Pick a date and time',
  minDate,
  side = 'bottom',
  align = 'start',
  className,
  id,
  footnote,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [twelveHour, setTwelveHour] = useState(true);
  const [month, setMonth] = useState<Date>(() => value ?? new Date());

  useEffect(() => {
    setMounted(true);
    setTwelveHour(uses12HourClock());
  }, []);

  // Opening shows the month of the chosen date, not wherever it was left.
  useEffect(() => {
    if (open) {
      setMonth(value ?? new Date());
    }
  }, [open, value]);

  const current = value ?? nextHour();

  function setDay(day: Date | undefined) {
    if (!day) {
      return;
    }
    const next = new Date(day);
    next.setHours(current.getHours(), current.getMinutes(), 0, 0);
    onValueChange(next);
  }

  function setTime(hours: number, minutes: number) {
    const next = new Date(current);
    next.setHours(hours, minutes, 0, 0);
    onValueChange(next);
  }

  const hours24 = current.getHours();
  const minutes = current.getMinutes();
  const pm = hours24 >= 12;
  const hourOptions = twelveHour
    ? Array.from({ length: 12 }, (_, index) => index + 1)
    : Array.from({ length: 24 }, (_, index) => index);
  const shownHour = twelveHour ? hours24 % 12 || 12 : hours24;
  const minuteOptions = Array.from(
    new Set([...Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP), minutes]),
  ).sort((a, b) => a - b);

  const text =
    mounted && value
      ? value.toLocaleString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null;

  return (
    // Modal, for the time columns' scrolling. Inside a Dialog (the composer),
    // the dialog locks wheel and touch scrolling to its own content, and this
    // popover is portaled outside it, so the columns would only move by
    // dragging the scrollbar. A modal popover takes its own scroll lock,
    // which stacks over the dialog's and lets its content scroll; it also
    // closes on any click outside, as a picker should.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={text ? `${label}: ${text}` : label}
          // The exact local value (`2026-10-24T14:00`), whatever the locale
          // makes of the visible text: for forms and tests to read.
          data-value={value ? localValue(value) : ''}
          className={cn(
            'flex h-11 items-center gap-2 rounded-md border-2 border-outline bg-field px-3',
            'font-sans text-sm text-ink tabular-nums shadow-surfaceSm',
            FIELD_FOCUS,
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <span className={cn('truncate', !text && 'opacity-50')}>{text ?? placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-auto p-0">
        <div className="flex">
          <Calendar
            mode="single"
            required
            selected={current}
            onSelect={setDay}
            month={month}
            onMonthChange={setMonth}
            // Always six rows, so the time columns beside it keep one height.
            fixedWeeks
            disabled={minDate ? { before: startOfDay(minDate) } : undefined}
            className="p-3"
          />
          {/* The columns take exactly the calendar's height and scroll inside
              it: the box stretches to the calendar's height, and the columns
              fill it absolutely so their long lists cannot set it instead.
              Width: three 48px keys plus scrollbars and gaps, or two. */}
          <div
            className={cn(
              'relative shrink-0 border-s-2 border-outline',
              twelveHour ? 'w-56' : 'w-40',
            )}
          >
            <div className="absolute inset-0 flex gap-1.5 p-3">
              <TimeColumn
                label="Hour"
                options={hourOptions.map((hour) => ({
                  value: hour,
                  text: twelveHour ? String(hour) : pad(hour),
                }))}
                selected={shownHour}
                onSelect={(hour) =>
                  setTime(twelveHour ? (hour % 12) + (pm ? 12 : 0) : hour, minutes)
                }
                open={open}
              />
              <TimeColumn
                label="Minute"
                options={minuteOptions.map((minute) => ({ value: minute, text: pad(minute) }))}
                selected={minutes}
                onSelect={(minute) => setTime(hours24, minute)}
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
                  onSelect={(period) => setTime((hours24 % 12) + (period === 1 ? 12 : 0), minutes)}
                  open={open}
                />
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t-2 border-outline px-3 py-2.5">
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              setMonth(today);
              setDay(today);
            }}
            className={cn(
              'rounded-md px-2 py-1 type-ui text-xs text-ink underline underline-offset-2 hover:bg-actionPrimary/10',
              FIELD_FOCUS,
            )}
          >
            Today
          </button>
          {footnote ? (
            <span className="min-w-0 flex-1 truncate text-center font-sans text-[11px] text-ink opacity-60">
              {footnote}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn(
              'flex h-8 items-center rounded-md border-2 border-outline bg-actionPrimary px-3 type-ui text-xs text-onActionPrimary shadow-brutalSm',
              'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
              FIELD_FOCUS,
            )}
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
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
        className="text-center font-sans text-[11px] font-bold uppercase text-ink opacity-60"
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
                'h-9 w-12 shrink-0 rounded-md border-2 border-outline font-sans text-sm tabular-nums',
                'outline-none transition-[transform,background-color] duration-100',
                'active:translate-x-[1px] active:translate-y-[1px]',
                'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
                isSelected
                  ? 'bg-actionPrimary text-onActionPrimary shadow-surfaceSm'
                  : 'bg-primary text-ink hover:bg-actionPrimary/20',
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
