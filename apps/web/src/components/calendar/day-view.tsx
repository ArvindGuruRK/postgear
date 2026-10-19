'use client';

/**
 * The day view, after the reference calendar's day (UI revamp, 2026-10-18):
 * not 24 empty hours, but the day's moments. One row per time something goes
 * out: every channel posting time, plus every time a post actually sits at,
 * each with its time centered above it.
 *
 * A row holds its posts at full width. While it is still ahead, its empty
 * space shows the channels that post at that time, greyed until hovered, and a
 * click starts a post at exactly that time. Dropping a card on a row moves the
 * post to that exact time, not just that hour.
 */
import { cn } from '@postgear/ui';
import { CalendarClock } from 'lucide-react';
import { ChannelMark } from '@/components/channels/channel-mark';
import type { Channel } from '@/types/channel';
import type { PostSummary } from '@/types/post';
import type { CalendarHandlers } from './calendar-handlers';
import {
  dayRows,
  isPastSlot,
  isSameDay,
  minuteLabel,
  minuteOfDay,
  startOfDay,
} from './calendar-math';
import { CalendarSlot } from './calendar-slot';
import { SlotPosts } from './slot-posts';

export function DayView({
  anchor,
  posts,
  channels,
  now,
  handlers,
}: {
  anchor: Date;
  posts: PostSummary[];
  /** The channels whose posting times make rows: the filtered set, enabled only. */
  channels: Channel[];
  now: Date;
  handlers: CalendarHandlers;
}) {
  const day = startOfDay(anchor);
  const dayPosts = posts
    .filter((post) => isSameDay(new Date(post.publishDate), day))
    .sort((a, b) => new Date(a.publishDate).getTime() - new Date(b.publishDate).getTime());
  const rows = dayRows(
    dayPosts,
    channels.flatMap((channel) => channel.postingTimes.map((slot) => slot.time)),
  );

  return (
    <div className="relative min-h-0 flex-1" data-testid="day-view">
      <div className="absolute inset-0 overflow-auto pg-scrollbar pg-scrollbar-primary">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <CalendarClock className="h-8 w-8 text-ink opacity-50" strokeWidth={2} />
            <p className="max-w-sm font-sans text-sm text-ink opacity-70">
              Nothing goes out on this day, and no channel has a posting time set.
            </p>
            {isSameDay(day, now) || day.getTime() > now.getTime() ? (
              <button
                type="button"
                onClick={() => handlers.onCreate({ day })}
                className="rounded-md px-2 py-1 type-ui text-sm text-ink underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
              >
                Create a post on this day
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {rows.map((minutes) => {
              const target = { day, hour: Math.floor(minutes / 60), minute: minutes % 60 };
              const rowPosts = dayPosts.filter(
                (post) => minuteOfDay(new Date(post.publishDate)) === minutes,
              );
              const rowChannels = channels.filter((channel) =>
                channel.postingTimes.some((slot) => slot.time === minutes),
              );
              const label = minuteLabel(minutes);

              return (
                <section key={minutes} aria-label={label} className="flex flex-col gap-1">
                  <h3 className="text-center type-ui text-sm tabular-nums text-ink">{label}</h3>
                  <CalendarSlot
                    target={target}
                    past={isPastSlot(target, now)}
                    empty={rowPosts.length === 0}
                    label={`${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${label}`}
                    onCreate={handlers.onCreate}
                    className="min-h-[3.75rem]"
                    addContent={
                      rowChannels.length > 0 ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex w-full flex-wrap items-center justify-center gap-5 rounded-lg border-2 border-transparent py-2',
                            'opacity-30 grayscale transition-[opacity,filter,border-color]',
                            'group-hover/slot:border-actionPrimary/40 group-hover/slot:opacity-100 group-hover/slot:grayscale-0',
                          )}
                        >
                          {rowChannels.map((channel) => (
                            <ChannelMark
                              key={channel.id}
                              color={channel.color}
                              id={channel.id}
                              name={channel.name}
                              picture={channel.picture}
                              platform={channel.providerIdentifier}
                              size="sm"
                            />
                          ))}
                        </span>
                      ) : undefined
                    }
                  >
                    <SlotPosts posts={rowPosts} now={now} density="roomy" handlers={handlers} />
                  </CalendarSlot>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
