'use client';

/**
 * The week and day views: hours down, days across.
 *
 * One component, because the day view is the week view with one column and
 * roomier cards. The grid scrolls inside its own frame — vertically through
 * the hours, and horizontally on a narrow screen rather than squeezing seven
 * days into a phone's width — the page itself never scrolls, per the app
 * shell. It opens on the working morning rather than midnight, with the
 * current hour marked.
 */
import { cn } from '@postgear/ui';
import { useEffect, useRef } from 'react';
import type { PostSummary } from '@/types/post';
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
import { CalendarSlot, type SlotTarget } from './calendar-slot';
import { PostCard } from './post-card';

/** Where the grid scrolls to when it opens. */
const MORNING_HOUR = 7;

/**
 * Cards shown in one hour of the week view before the rest fold into
 * "+N more", which opens the day. Without a cap one busy hour would stretch
 * that row for all seven days. The day view shows every card.
 */
const MAX_VISIBLE_IN_WEEK = 3;

export function TimeGridView({
  view,
  anchor,
  posts,
  now,
  onOpen,
  onCreate,
  onShowDay,
}: {
  view: 'week' | 'day';
  anchor: Date;
  posts: PostSummary[];
  now: Date;
  onOpen: (post: PostSummary) => void;
  onCreate: (target: SlotTarget) => void;
  onShowDay: (day: Date) => void;
}) {
  const days = visibleDays(view, anchor);
  const byHour = bucketPosts(posts, hourKey);
  const morning = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Open on the morning. Only when the view or anchor changes, so a refresh of
  // the posts does not yank the person back from the hour they scrolled to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view and anchor are the deliberate triggers
  useEffect(() => {
    // Scroll the grid's own container only. `scrollIntoView` would also scroll
    // every ancestor, dragging the page header out of view on every visit.
    if (scroller.current && morning.current) {
      scroller.current.scrollTop = morning.current.offsetTop;
    }
  }, [view, anchor]);

  const columns =
    view === 'week'
      ? 'grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]'
      : 'grid-cols-[3.5rem_minmax(0,1fr)]';

  return (
    <div
      className="flex max-h-[calc(100vh-17rem)] min-h-[24rem] flex-col overflow-hidden rounded-md border-2 border-outline bg-secondary"
      data-testid={`${view}-view`}
    >
      {/* Seven day columns need room; on a phone the grid scrolls sideways
          inside this frame instead of collapsing to slivers (§11). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto pg-scrollbar pg-scrollbar-secondary">
        <div className={cn('flex min-h-0 flex-1 flex-col', view === 'week' && 'min-w-[56rem]')}>
          <div className={cn('grid shrink-0 border-b-2 border-outline', columns)}>
            <div className="border-e-2 border-outline" />
            {days.map((day) => {
              const today = isSameDay(day, now);
              return (
                <button
                  key={day.getTime()}
                  type="button"
                  onClick={() => onShowDay(day)}
                  disabled={view === 'day'}
                  aria-current={today ? 'date' : undefined}
                  className={cn(
                    'flex items-center justify-center gap-2 border-e-2 border-outline py-2 outline-none last:border-e-0',
                    'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
                    view === 'week' && 'hover:bg-actionPrimary/10',
                    today && 'bg-actionPrimary text-onActionPrimary',
                  )}
                >
                  <span className="font-sans text-xs font-bold uppercase">
                    {day.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span
                    className={cn(
                      'type-heading text-lg leading-none',
                      !today && 'text-ink',
                    )}
                  >
                    {day.getDate()}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            ref={scroller}
            // `relative` makes this the rows' offsetParent, so offsetTop is measured from here.
            className="relative min-h-0 flex-1 overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
          >
            {HOURS.map((hour) => {
              const currentHour =
                now.getHours() === hour && days.some((day) => isSameDay(day, now));

              return (
                <div
                  key={hour}
                  ref={hour === MORNING_HOUR ? morning : undefined}
                  className={cn('relative grid border-b-2 border-outline last:border-b-0', columns)}
                >
                  <div className="flex items-start justify-end border-e-2 border-outline px-2 py-1 font-sans text-[11px] font-bold tabular-nums text-ink opacity-60">
                    {hourLabel(hour)}
                  </div>

                  {days.map((day) => {
                    const key = hourKey(slotStart(day, hour));
                    const slotPosts = byHour.get(key) ?? [];
                    const visible =
                      view === 'week' ? slotPosts.slice(0, MAX_VISIBLE_IN_WEEK) : slotPosts;
                    const hidden = slotPosts.length - visible.length;
                    const past = isPastSlot({ day, hour }, now);
                    const today = isSameDay(day, now);

                    return (
                      <CalendarSlot
                        key={key}
                        target={{ day, hour }}
                        past={past}
                        label={`${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${hourLabel(hour)}`}
                        onCreate={onCreate}
                        className={cn(
                          'min-h-[4.25rem] border-e-2 border-outline last:border-e-0',
                          today && !past && 'bg-actionPrimary/10',
                        )}
                      >
                        {visible.map((post) => (
                          <PostCard
                            key={post.group}
                            post={post}
                            now={now}
                            density={view === 'day' ? 'roomy' : 'regular'}
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

                  {currentHour ? (
                    // The present minute, as a line across the whole hour row.
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-actionAccent"
                      style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
                    />
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
