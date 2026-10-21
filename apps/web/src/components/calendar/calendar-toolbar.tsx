'use client';

import { CalendarDaysIcon } from '@animateicons/react/lucide/calendar-days-icon';
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { ListIcon } from '@animateicons/react/lucide/list-icon';
import { cn, MotionIcon, TooltipHint } from '@postgear/ui';
import Link from 'next/link';
import { useCalendar } from './calendar-context';
import { type CalendarView, rangeLabel } from './calendar-math';
import { TagFilter } from './tag-filter';

/** In the reference's order: the narrowest view first. */
const VIEWS: Array<{ value: CalendarView; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/** A segmented control's frame. A fieldset, so its legend names the group. */
const GROUP =
  'm-0 flex h-10 min-w-0 items-center gap-1 rounded-lg border-2 border-outline bg-chrome p-0.5';

/**
 * One option in a segmented control; the active one is the filled tile. No
 * shadow on it (2026-10-18): inside the group's own frame a lifted tile read
 * as out of place, so the fill and outline alone mark the choice.
 */
const SEGMENT = (active: boolean) =>
  cn(
    // 4px: the frame's 8px less its 4px inset (2px border, 2px padding), so
    // the tile's corners run parallel to the frame's. Every outer control in
    // this bar (range, Today, both frames) is the same 8px.
    'flex h-8 items-center justify-center rounded border-2 type-ui text-sm transition-colors',
    FOCUS,
    active
      ? 'border-outline bg-actionPrimary text-onActionPrimary'
      : 'border-transparent text-ink hover:bg-primary',
  );

/**
 * The calendar's controls, laid out as the reference's filter bar (UI revamp,
 * 2026-10-18): on the left the range, between its previous and next arrows
 * in one joined control, then Today; on the right the tag filter
 * (2026-10-19, PostGear's own), the Day / Week / Month switch and the
 * calendar / list switch. The list is the Queue: every post in order, which
 * is what the reference's list mode shows.
 */
export function CalendarToolbar() {
  const calendar = useCalendar();

  return (
    // On a phone it wraps to two full-width rows: the range and Today, then
    // the two switches, each stretching to the width rather than overflowing.
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-10 min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border-2 border-outline bg-chrome md:flex-none">
        <TooltipHint label={`Previous ${calendar.view}`} side="bottom">
          <button
            type="button"
            aria-label={`Previous ${calendar.view}`}
            onClick={() => calendar.step(-1)}
            className={cn(
              'flex w-9 items-center justify-center text-ink hover:bg-primary',
              FOCUS,
              'focus-visible:outline-offset-[-3px]',
            )}
          >
            <MotionIcon icon={ChevronLeftIcon} className="h-4 w-4" />
          </button>
        </TooltipHint>
        <span
          className="flex min-w-0 flex-1 items-center justify-center truncate border-x-2 border-outline px-2 type-ui text-sm text-ink md:min-w-[12.5rem] md:flex-none md:px-3"
          aria-live="polite"
          data-testid="calendar-range"
        >
          {rangeLabel(calendar.view, calendar.anchor)}
        </span>
        <TooltipHint label={`Next ${calendar.view}`} side="bottom">
          <button
            type="button"
            aria-label={`Next ${calendar.view}`}
            onClick={() => calendar.step(1)}
            className={cn(
              'flex w-9 items-center justify-center text-ink hover:bg-primary',
              FOCUS,
              'focus-visible:outline-offset-[-3px]',
            )}
          >
            <MotionIcon icon={ChevronRightIcon} className="h-4 w-4" />
          </button>
        </TooltipHint>
      </div>

      <button
        type="button"
        onClick={calendar.today}
        className={cn(
          'flex h-10 items-center rounded-lg border-2 border-outline bg-chrome px-3 type-ui text-sm text-ink hover:bg-primary',
          FOCUS,
        )}
      >
        Today
      </button>

      <div className="ms-auto flex w-full items-center gap-2 md:w-auto">
        <TagFilter />

        <fieldset className={cn(GROUP, 'flex-1 md:flex-none')}>
          <legend className="sr-only">View</legend>
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={calendar.view === option.value}
              aria-label={`${option.label} view`}
              onClick={() => calendar.setView(option.value)}
              className={cn(
                SEGMENT(calendar.view === option.value),
                'flex-1 md:w-[4.625rem] md:flex-none',
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        <fieldset className={GROUP}>
          <legend className="sr-only">Layout</legend>
          <TooltipHint label="Calendar View" side="bottom">
            <span aria-current="page" className={cn(SEGMENT(true), 'w-9')}>
              <MotionIcon icon={CalendarDaysIcon} className="h-4 w-4" />
              <span className="sr-only">Calendar</span>
            </span>
          </TooltipHint>
          <TooltipHint label="List View: Every Post In The Queue" side="bottom" align="end">
            <Link
              href={`/${calendar.orgId}/queue`}
              aria-label="List"
              className={cn(SEGMENT(false), 'w-9')}
            >
              <MotionIcon icon={ListIcon} className="h-4 w-4" />
            </Link>
          </TooltipHint>
        </fieldset>
      </div>
    </div>
  );
}
