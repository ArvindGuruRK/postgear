'use client';

import { cn } from '@postgear/ui';
import type { PostSummary } from '@/types/post';
import {
  bucketPosts,
  dayKey,
  isPastSlot,
  isSameDay,
  monthWeeks,
  startOfMonth,
} from './calendar-math';
import { CalendarSlot, type SlotTarget } from './calendar-slot';
import { PostCard } from './post-card';

/** Cards shown in a day cell before the rest fold into "+N more". */
const MAX_VISIBLE = 3;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthView({
  anchor,
  posts,
  now,
  onOpen,
  onCreate,
  onShowDay,
}: {
  anchor: Date;
  posts: PostSummary[];
  now: Date;
  onOpen: (post: PostSummary) => void;
  onCreate: (target: SlotTarget) => void;
  /** "+N more" opens the day in the day view. */
  onShowDay: (day: Date) => void;
}) {
  const weeks = monthWeeks(anchor);
  const byDay = bucketPosts(posts, dayKey);
  const month = startOfMonth(anchor).getMonth();

  return (
    <div
      className="overflow-x-auto rounded-md border-2 border-outline bg-secondary pg-scrollbar pg-scrollbar-secondary"
      data-testid="month-view"
    >
      {/* Seven columns need room; on a phone the month scrolls sideways
          inside its frame instead of collapsing to slivers (§11). */}
      <div className="min-w-[42rem]">
        <div className="grid grid-cols-7 border-b-2 border-outline bg-secondary">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              className="px-2 py-2 text-center font-sans text-xs font-bold uppercase text-ink opacity-60"
            >
              {weekday}
            </div>
          ))}
        </div>

        {weeks.map((week) => (
          <div
            key={dayKey(week[0])}
            className="grid grid-cols-7 border-b-2 border-outline last:border-b-0"
          >
            {week.map((day) => {
              const key = dayKey(day);
              const dayPosts = byDay.get(key) ?? [];
              const visible = dayPosts.slice(0, MAX_VISIBLE);
              const hidden = dayPosts.length - visible.length;
              const outside = day.getMonth() !== month;
              const today = isSameDay(day, now);
              const past = isPastSlot({ day }, now);

              return (
                <CalendarSlot
                  key={key}
                  target={{ day }}
                  past={past}
                  label={`on ${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`}
                  onCreate={onCreate}
                  className={cn(
                    'min-h-[7.5rem] border-e-2 border-outline last:border-e-0',
                    outside && 'opacity-50',
                  )}
                >
                  <div className="flex items-start">
                    <span
                      className={cn(
                        'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-sans text-xs font-bold tabular-nums',
                        today
                          ? 'border-2 border-outline bg-actionPrimary text-onActionPrimary'
                          : 'text-ink',
                      )}
                      aria-current={today ? 'date' : undefined}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {visible.map((post) => (
                    <PostCard
                      key={post.group}
                      post={post}
                      now={now}
                      density="compact"
                      onOpen={onOpen}
                    />
                  ))}

                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={() => onShowDay(day)}
                      className="rounded-md px-1 text-start font-sans text-xs font-bold text-ink underline underline-offset-2 outline-none hover:bg-actionPrimary/10 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
                    >
                      +{hidden} more
                    </button>
                  ) : null}
                </CalendarSlot>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
