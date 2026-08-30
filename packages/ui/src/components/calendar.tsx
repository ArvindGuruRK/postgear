'use client';

import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { cn } from '../lib/utils';

export type CalendarProps = DayPickerProps;

const navButtonClasses = cn(
  'flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-secondary shadow-brutalSm',
  'transition-[transform,box-shadow] duration-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
  'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
  'disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none',
);

/** Styled wrapper around react-day-picker — the shared calendar grid behind DatePicker/DateRangePicker. */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-2', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'relative flex h-9 items-center justify-center',
        caption_label: 'font-display text-sm uppercase tracking-wide text-ink',
        nav: 'absolute inset-x-0 top-0 flex h-9 items-center justify-between px-1',
        button_previous: navButtonClasses,
        button_next: navButtonClasses,
        chevron: 'h-4 w-4 fill-ink',
        month_grid: 'mt-2 w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-center font-sans text-xs font-bold uppercase text-ink opacity-60',
        week: 'mt-1 flex w-full',
        day: 'p-0 text-center align-middle',
        day_button: cn(
          'h-9 w-9 rounded-md font-sans text-sm text-ink outline-none transition-colors',
          'hover:bg-actionPrimary/10',
          'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
        ),
        today: '[&>button]:font-bold [&>button]:text-actionPrimary',
        selected: '[&>button]:border-2 [&>button]:border-outline [&>button]:bg-actionPrimary [&>button]:text-onActionPrimary [&>button]:hover:bg-actionPrimary',
        outside: '[&>button]:opacity-40',
        disabled: '[&>button]:pointer-events-none [&>button]:opacity-30',
        range_start: '[&>button]:rounded-l-md [&>button]:rounded-r-none [&>button]:bg-actionPrimary [&>button]:text-onActionPrimary',
        range_end: '[&>button]:rounded-l-none [&>button]:rounded-r-md [&>button]:bg-actionPrimary [&>button]:text-onActionPrimary',
        range_middle: '[&>button]:rounded-none [&>button]:bg-actionPrimary/15 [&>button]:text-ink',
        ...classNames,
      }}
      {...props}
    />
  );
}
