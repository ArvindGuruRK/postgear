'use client';

import { CalendarIcon } from '@animateicons/react/lucide/calendar-icon';
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { type ButtonHTMLAttributes, forwardRef, type ReactNode, useEffect, useState } from 'react';
import {
  type ChevronProps,
  DayPicker,
  Chevron as DayPickerChevron,
  type DayPickerProps,
} from 'react-day-picker';
import { FIELD_FOCUS, FIELD_FOCUS_ERROR } from '../lib/field';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';

export type CalendarProps = DayPickerProps;

/** The month arrows play from their nav buttons; a caption dropdown's up/down keeps the stock glyph. */
function CalendarChevron({ orientation = 'left', className, ...props }: ChevronProps) {
  if (orientation === 'left' || orientation === 'right') {
    return (
      <MotionIcon
        icon={orientation === 'left' ? ChevronLeftIcon : ChevronRightIcon}
        className={className}
        strokeWidth={3}
      />
    );
  }
  return <DayPickerChevron orientation={orientation} className={className} {...props} />;
}

const navButtonClasses = cn(
  'flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-secondary shadow-brutalSm',
  'transition-[transform,box-shadow] duration-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
  'disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none',
);

/**
 * Styled wrapper around react-day-picker: the shared calendar grid behind
 * DatePicker, DateRangePicker and DateTimePicker. Always six rows by default,
 * so a picker keeps one height from month to month.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  fixedWeeks = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      fixedWeeks={fixedWeeks}
      // `relative` is load-bearing: the nav below is absolutely positioned,
      // so without a positioned root it escapes to the nearest positioned
      // ancestor (the page) and floats its prev/next buttons over the app.
      className={cn('relative p-2', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'relative flex h-9 items-center justify-center',
        caption_label: 'type-ui text-sm text-ink',
        // inset-x-2/top-2 matches the root's p-2 so the arrows line up with
        // the caption row rather than sitting in the padding. z-10 is required:
        // month_caption is `relative`, and a positioned later sibling paints
        // over a positioned earlier one, so without it the caption swallows
        // clicks on the arrows.
        nav: 'absolute inset-x-2 top-2 z-10 flex h-9 items-center justify-between',
        button_previous: navButtonClasses,
        button_next: navButtonClasses,
        chevron: 'h-4 w-4 fill-ink text-ink',
        month_grid: 'mt-2 w-full border-collapse',
        // Weekday header and day rows share the same gap so the labels stay
        // aligned with the tiles beneath them.
        weekdays: 'flex gap-1',
        weekday: 'w-9 text-center font-sans text-xs font-bold text-ink opacity-60',
        week: 'mt-1 flex w-full gap-1',
        day: 'p-0 text-center align-middle',
        // Every day is its own outlined tile, so the grid reads as a sheet of
        // physical keys rather than plain text in a table.
        day_button: cn(
          'h-9 w-9 rounded-md border-2 border-outline bg-primary font-sans text-sm text-ink',
          'outline-none transition-[transform,background-color,box-shadow] duration-100',
          'hover:bg-actionPrimary/20',
          'active:translate-x-[1px] active:translate-y-[1px]',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        ),
        today: '[&>button]:font-bold [&>button]:text-actionPrimary',
        selected:
          '[&>button]:bg-actionPrimary [&>button]:text-onActionPrimary [&>button]:shadow-surfaceSm [&>button]:hover:bg-actionPrimary',
        outside: '[&>button]:border-outline/40 [&>button]:opacity-40',
        disabled: '[&>button]:pointer-events-none [&>button]:opacity-30',
        // Tiles keep their own borders across a range; only the fill changes,
        // so the key grid stays intact instead of fusing into one bar.
        range_start:
          '[&>button]:bg-actionPrimary [&>button]:text-onActionPrimary [&>button]:shadow-surfaceSm [&>button]:hover:bg-actionPrimary',
        range_end:
          '[&>button]:bg-actionPrimary [&>button]:text-onActionPrimary [&>button]:shadow-surfaceSm [&>button]:hover:bg-actionPrimary',
        range_middle: '[&>button]:bg-actionPrimary/25 [&>button]:text-ink',
        ...classNames,
      }}
      {...props}
      components={{ Chevron: CalendarChevron, ...props.components }}
    />
  );
}

export interface CalendarTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'children'> {
  /** Names the field: the trigger is announced as "<label>: <text>". */
  label?: string;
  /** The chosen value as the viewer reads it; null shows the placeholder. */
  text: string | null;
  placeholder: string;
  /** The exact value (`2026-10-24`, `2026-10-24T14:00`), for forms and tests. */
  dataValue: string;
  invalid?: boolean;
}

/**
 * The field-style button that opens every calendar picker: a calendar icon
 * and the value. The text and the exact value appear after mount: both are
 * local to the viewer's time zone and locale, which the server rendering this
 * does not share, and a server-made label would mismatch on hydration.
 */
export const CalendarTrigger = forwardRef<HTMLButtonElement, CalendarTriggerProps>(
  ({ label, text, placeholder, dataValue, invalid = false, className, ...props }, ref) => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
      setMounted(true);
    }, []);

    const shown = mounted ? text : null;

    return (
      <button
        ref={ref}
        type="button"
        aria-label={label ? (shown ? `${label}: ${shown}` : label) : undefined}
        aria-invalid={invalid || undefined}
        data-value={mounted ? dataValue : ''}
        className={cn(
          'flex h-11 items-center gap-2 rounded-md border-2 border-outline bg-field px-3',
          'font-sans text-sm text-ink tabular-nums shadow-surfaceSm',
          FIELD_FOCUS,
          invalid && `border-actionDanger ${FIELD_FOCUS_ERROR}`,
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
          className,
        )}
        {...props}
      >
        <MotionIcon icon={CalendarIcon} className="h-4 w-4 shrink-0" />
        <span className={cn('truncate', !shown && 'opacity-50')}>{shown ?? placeholder}</span>
      </button>
    );
  },
);
CalendarTrigger.displayName = 'CalendarTrigger';

/**
 * The popover panel of every calendar picker. Never taller than the room the
 * screen has on its side of the trigger: in a dialog on a short laptop (or a
 * phone) the panel scrolls instead of running off the bottom edge.
 */
export const calendarPopoverClasses =
  'w-auto max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0 pg-scrollbar pg-scrollbar-secondary';

const footerLinkClasses = cn(
  'rounded-md px-2 py-1 type-ui text-xs text-ink underline underline-offset-2 hover:bg-actionPrimary/10',
  'disabled:pointer-events-none disabled:opacity-40',
  FIELD_FOCUS,
);

/**
 * The strip under every calendar picker: Today and Clear on the left (each
 * only when the picker passes it), a short note in the middle, Done on the
 * right.
 */
export function CalendarFooter({
  onToday,
  todayDisabled = false,
  onClear,
  note,
  onDone,
}: {
  onToday?: () => void;
  /** Today is outside the days the picker allows. */
  todayDisabled?: boolean;
  onClear?: () => void;
  note?: ReactNode;
  onDone: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t-2 border-outline px-3 py-2.5">
      <div className="flex shrink-0 items-center gap-1">
        {onToday ? (
          <button
            type="button"
            onClick={onToday}
            disabled={todayDisabled}
            className={footerLinkClasses}
          >
            Today
          </button>
        ) : null}
        {onClear ? (
          <button type="button" onClick={onClear} className={footerLinkClasses}>
            Clear
          </button>
        ) : null}
      </div>
      {note ? (
        <span className="min-w-0 flex-1 truncate text-center font-sans text-[11px] text-ink opacity-60">
          {note}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onDone}
        className={cn(
          'flex h-8 shrink-0 items-center rounded-md border-2 border-outline bg-actionPrimary px-3 type-ui text-xs text-onActionPrimary shadow-brutalSm',
          'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
          FIELD_FOCUS,
        )}
      >
        Done
      </button>
    </div>
  );
}
