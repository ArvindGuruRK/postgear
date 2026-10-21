'use client';

/**
 * The month view, after the reference calendar's month (UI revamp,
 * 2026-10-18): a sticky row of weekday names, then six weeks of day cells
 * from Monday, padded with the neighbouring months' days. Each cell shows its
 * date, its posts (three, then "+ Show more" in place), and a "+" in its
 * empty space while the day is still ahead; days behind us are hatched.
 *
 * Seven columns need room: on a phone the month scrolls sideways inside its
 * region instead of collapsing to slivers.
 */
import { cn } from '@postgear/ui';
import type { PostSummary } from '@/types/post';
import type { CalendarHandlers } from './calendar-handlers';
import {
  bucketPosts,
  dayKey,
  isPastSlot,
  isSameDay,
  monthWeeks,
  startOfMonth,
} from './calendar-math';
import { CalendarSlot } from './calendar-slot';
import { SlotPosts } from './slot-posts';

export function MonthView({
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
  const weeks = monthWeeks(anchor);
  const byDay = bucketPosts(posts, dayKey);
  const month = startOfMonth(anchor).getMonth();

  return (
    <div className="relative min-h-0 flex-1" data-testid="month-view">
      <div className="absolute inset-0 overflow-auto pg-scrollbar pg-scrollbar-primary">
        <div className="flex min-w-[42rem] flex-col">
          <div className="sticky top-0 z-20 grid grid-cols-7 gap-1 bg-primary pb-1">
            {weeks[0].map((day) => (
              <div
                key={day.getDay()}
                className="flex h-[3.875rem] items-center justify-center rounded-lg border-2 border-outline bg-chrome px-1 type-ui text-sm text-ink"
              >
                {/* A phone's columns fit "Wed", not "Wednesday". */}
                <span className="truncate md:hidden">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className="hidden truncate md:inline">
                  {day.toLocaleDateString(undefined, { weekday: 'long' })}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            {weeks.map((week) => (
              <div key={dayKey(week[0])} className="grid grid-cols-7 gap-1">
                {week.map((day) => {
                  const key = dayKey(day);
                  const dayPosts = byDay.get(key) ?? [];
                  const today = isSameDay(day, now);
                  const target = { day };

                  return (
                    <CalendarSlot
                      key={key}
                      target={target}
                      past={isPastSlot(target, now)}
                      empty={dayPosts.length === 0}
                      label={`on ${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`}
                      onCreate={handlers.onCreate}
                      className="min-h-[7.5rem]"
                      heading={
                        <span
                          aria-current={today ? 'date' : undefined}
                          className={cn(
                            'flex items-center justify-center gap-1.5 pt-1.5 type-ui text-sm tabular-nums',
                            today ? 'text-actionAi' : 'text-ink',
                            day.getMonth() !== month && !today && 'opacity-50',
                          )}
                        >
                          {today ? (
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-actionAi"
                            />
                          ) : null}
                          {day.getDate()}
                        </span>
                      }
                    >
                      <SlotPosts posts={dayPosts} now={now} density="compact" handlers={handlers} />
                    </CalendarSlot>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
