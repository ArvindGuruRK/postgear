'use client';

/**
 * The week view: 24 hours down, seven days across, after the reference
 * calendar's week (UI revamp, 2026-10-18).
 *
 * Its mechanism, kept as is: a fixed hour gutter, a sticky header row naming
 * each day with its date (today marked with a dot), and one cell per hour per
 * day that holds that hour's posts, three at most until "+ Show more" expands
 * it in place. An empty future cell offers a "+"; a past one is hatched.
 *
 * The grid sits on the page ground and scrolls inside its own region:
 * vertically through the hours, and sideways on a narrow screen rather than
 * squeezing seven days into a phone's width. It opens on the working morning
 * rather than midnight, with the present minute drawn across the current hour
 * and the time itself written on it, in the hour gutter (2026-10-21).
 */
import { cn } from '@postgear/ui';
import { useEffect, useRef } from 'react';
import type { PostSummary } from '@/types/post';
import type { CalendarHandlers } from './calendar-handlers';
import {
  bucketPosts,
  HOURS,
  hourKey,
  hourLabel,
  isPastSlot,
  isSameDay,
  slotStart,
  visibleDays,
} from './calendar-math';
import { CalendarSlot } from './calendar-slot';
import { SlotPosts } from './slot-posts';

/** Where the grid scrolls to when it opens. */
const MORNING_HOUR = 7;

/** A narrower hour gutter on a phone, where every column is scrolled past. */
const COLUMNS =
  'grid-cols-[3.75rem_repeat(7,minmax(0,1fr))] md:grid-cols-[5.5rem_repeat(7,minmax(0,1fr))]';

export function WeekView({
  anchor,
  posts,
  now,
  handlers,
}: {
  anchor: Date;
  posts: PostSummary[];
  now: Date;
  handlers: CalendarHandlers;
}) {
  const days = visibleDays('week', anchor);
  const byHour = bucketPosts(posts, hourKey);
  // "3:42 PM", in the viewer's own format.
  const nowText = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const scroller = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const morning = useRef<HTMLDivElement>(null);

  // Open on the morning. Only when the anchor changes, so a refresh of the
  // posts does not yank the person back from the hour they scrolled to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the anchor is the deliberate trigger
  useEffect(() => {
    // Scroll the grid's own container only. `scrollIntoView` would also scroll
    // every ancestor.
    if (scroller.current && morning.current) {
      scroller.current.scrollTop = morning.current.offsetTop - (header.current?.offsetHeight ?? 0);
    }
  }, [anchor]);

  return (
    <div className="relative min-h-0 flex-1" data-testid="week-view">
      <div
        ref={scroller}
        className="absolute inset-0 overflow-auto pg-scrollbar pg-scrollbar-primary"
      >
        <div className="flex min-w-[56rem] flex-col">
          <div ref={header} className={cn('sticky top-0 z-20 grid gap-1 bg-primary pb-1', COLUMNS)}>
            <div />
            {days.map((day) => {
              const today = isSameDay(day, now);
              return (
                <button
                  key={day.getTime()}
                  type="button"
                  onClick={() => handlers.onShowDay(day)}
                  aria-current={today ? 'date' : undefined}
                  aria-label={`Show ${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  className={cn(
                    'flex h-[3.875rem] flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-outline bg-chrome px-1 outline-none',
                    'transition-colors hover:bg-secondary',
                    'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                  )}
                >
                  <span className="truncate font-sans text-xs text-ink type-muted">
                    <span className="md:hidden">
                      {day.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    <span className="hidden md:inline">
                      {day.toLocaleDateString(undefined, { weekday: 'long' })}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'flex items-center gap-1.5 type-ui text-sm tabular-nums',
                      today ? 'text-actionAi' : 'text-ink',
                    )}
                  >
                    {today ? (
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-actionAi" />
                    ) : null}
                    {day.toLocaleDateString()}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1">
            {HOURS.map((hour) => {
              const currentHour =
                now.getHours() === hour && days.some((day) => isSameDay(day, now));
              // The hour's label sits at the middle of its row, so the time
              // marker would land on it around the half hour: the marker says
              // the time itself, and the label steps aside until it passes.
              const labelCovered = currentHour && Math.abs(now.getMinutes() - 30) <= 16;

              return (
                <div
                  key={hour}
                  // The row, not its gutter cell: the row is `relative`, so a
                  // cell's offsetTop would be measured from the row (always 0).
                  ref={hour === MORNING_HOUR ? morning : undefined}
                  className={cn('relative grid gap-1', COLUMNS)}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center px-2 font-sans text-xs tabular-nums text-ink type-muted',
                      labelCovered && 'invisible',
                    )}
                  >
                    {hourLabel(hour)}
                  </div>

                  {days.map((day) => {
                    const target = { day, hour };
                    const key = hourKey(slotStart(day, hour));
                    const slotPosts = byHour.get(key) ?? [];

                    return (
                      <CalendarSlot
                        key={key}
                        target={target}
                        past={isPastSlot(target, now)}
                        empty={slotPosts.length === 0}
                        label={`${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${hourLabel(hour)}`}
                        onCreate={handlers.onCreate}
                        className="min-h-[4.375rem]"
                      >
                        <SlotPosts
                          posts={slotPosts}
                          now={now}
                          density="regular"
                          handlers={handlers}
                        />
                      </CalendarSlot>
                    );
                  })}

                  {currentHour ? (
                    // The present minute, as a line across the whole hour row,
                    // with the time itself in the hour gutter where the line starts.
                    <>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-actionAi"
                        style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
                      />
                      <span
                        data-testid="now-time"
                        className="pointer-events-none absolute start-0.5 z-10 -translate-y-1/2 rounded-md border border-outline bg-actionAi px-1 py-0.5 md:border-2 font-sans text-[11px] leading-none tabular-nums type-ui text-onActionAi"
                        style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
                      >
                        {nowText}
                      </span>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
