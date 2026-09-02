'use client';

import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { cn } from '../lib/utils';

export type CalendarProps = DayPickerProps;

const navButtonClasses = cn(
  'flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-secondary shadow-brutalSm',
  'transition-[transform,box-shadow] duration-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
  'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
  'disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none',
);

/** Styled wrapper around react-day-picker — the shared calendar grid behind DatePicker/DateRangePicker. */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      // `relative` is load-bearing: the nav below is absolutely positioned,
      // so without a positioned root it escapes to the nearest positioned
      // ancestor (the page) and floats its prev/next buttons over the app.
      className={cn('relative p-2', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'relative flex h-9 items-center justify-center',
        caption_label: 'font-display text-sm uppercase tracking-wide text-ink',
        // inset-x-2/top-2 matches the root's p-2 so the arrows line up with
        // the caption row rather than sitting in the padding. z-10 is required:
        // month_caption is `relative`, and a positioned later sibling paints
        // over a positioned earlier one, so without it the caption swallows
        // clicks on the arrows.
        nav: 'absolute inset-x-2 top-2 z-10 flex h-9 items-center justify-between',
        button_previous: navButtonClasses,
        button_next: navButtonClasses,
        chevron: 'h-4 w-4 fill-ink',
        month_grid: 'mt-2 w-full border-collapse',
        // Weekday header and day rows share the same gap so the labels stay
        // aligned with the tiles beneath them.
        weekdays: 'flex gap-1',
        weekday: 'w-9 text-center font-sans text-xs font-bold uppercase text-ink opacity-60',
        week: 'mt-1 flex w-full gap-1',
        day: 'p-0 text-center align-middle',
        // Every day is its own outlined tile, so the grid reads as a sheet of
        // physical keys rather than plain text in a table.
        day_button: cn(
          'h-9 w-9 rounded-md border-2 border-outline bg-primary font-sans text-sm text-ink',
          'outline-none transition-[transform,background-color,box-shadow] duration-100',
          'hover:bg-actionPrimary/20',
          'active:translate-x-[1px] active:translate-y-[1px]',
          'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        ),
        today: '[&>button]:font-bold [&>button]:text-actionPrimary',
        selected:
          '[&>button]:bg-actionPrimary [&>button]:text-onActionPrimary [&>button]:shadow-brutalSm [&>button]:hover:bg-actionPrimary',
        outside: '[&>button]:border-outline/40 [&>button]:opacity-40',
        disabled: '[&>button]:pointer-events-none [&>button]:opacity-30',
        // Tiles keep their own borders across a range; only the fill changes,
        // so the key grid stays intact instead of fusing into one bar.
        range_start:
          '[&>button]:bg-actionPrimary [&>button]:text-onActionPrimary [&>button]:shadow-brutalSm [&>button]:hover:bg-actionPrimary',
        range_end:
          '[&>button]:bg-actionPrimary [&>button]:text-onActionPrimary [&>button]:shadow-brutalSm [&>button]:hover:bg-actionPrimary',
        range_middle: '[&>button]:bg-actionPrimary/25 [&>button]:text-ink',
        ...classNames,
      }}
      {...props}
    />
  );
}
