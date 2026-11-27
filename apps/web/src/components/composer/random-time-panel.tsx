'use client';

/**
 * Pick A Random Time (Sprint 13 Module 13, CA-9.3): the date picker's second
 * tab. Morning, Noon, Afternoon or Evening picks a random minute on the
 * chosen day inside that part (`randomTimeOfDay`, pure), never on a
 * five-minute mark, never within a minute of a post already on that day for
 * the chosen channel, and never sooner than the lead time today. Pressing
 * the same part again gives another time. The time it fills is a hand-picked
 * time from then on: nothing moves it again.
 */
import { DAY_PARTS, type DayPart, randomTimeOfDay } from '@postgear/automation';
import { Button, Text } from '@postgear/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { PostSummary } from '@/types/post';

export const DAY_PART_LABELS: Record<DayPart, string> = {
  morning: 'Morning',
  noon: 'Noon',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** "15 November 2026 at 7:58 AM". */
export function scheduledSentence(at: Date): string {
  const day = at.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Your post will be scheduled for ${day} at ${time}.`;
}

/** The times already placed on that day for the channel, the post being edited left out. */
export function takenOn(posts: PostSummary[], channelId: string | null, group: string | null) {
  return posts
    .filter((post) => post.group !== group)
    .filter((post) => post.state !== 'ERROR')
    .filter((post) => channelId === null || post.channels.some((c) => c.channelId === channelId))
    .map((post) => new Date(post.publishDate).getTime())
    .sort((a, b) => a - b);
}

export function RandomTimePanel({
  day,
  onPick,
  channelId,
  group,
}: {
  day: Date;
  onPick: (value: Date) => void;
  /** The first chosen channel: its posts that day are the ones kept clear of. */
  channelId: string | null;
  /** The post being edited, left out of its own day's list. */
  group: string | null;
}) {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [picked, setPicked] = useState<Date | null>(null);
  const [missed, setMissed] = useState(false);
  const dayKey = startOfDay(day).getTime();

  useEffect(() => {
    let live = true;
    const from = new Date(dayKey);
    const to = new Date(dayKey + 24 * 60 * 60 * 1000 - 1);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    api<{ posts: PostSummary[] }>(`/posts/calendar?${params.toString()}`)
      .then((answer) => {
        if (live) setPosts(answer.posts);
      })
      .catch(() => {
        if (live) setPosts([]);
      });
    return () => {
      live = false;
    };
  }, [dayKey]);

  const taken = takenOn(posts, channelId, group);

  function pick(part: DayPart) {
    const at = randomTimeOfDay({
      part,
      day: { year: day.getFullYear(), month: day.getMonth() + 1, day: day.getDate() },
      seed: `${part}-${Date.now()}-${Math.random()}`,
      taken,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      from: Date.now(),
    });
    if (at === null) {
      setMissed(true);
      setPicked(null);
      return;
    }
    const next = new Date(at);
    setMissed(false);
    setPicked(next);
    onPick(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {DAY_PARTS.map((part) => (
          <Button key={part} variant="secondary" size="sm" onClick={() => pick(part)}>
            {DAY_PART_LABELS[part]}
          </Button>
        ))}
      </div>

      <p aria-live="polite" className="m-0 font-sans text-sm text-ink">
        {missed
          ? 'That part of the day has passed. Pick another part or another day.'
          : picked
            ? scheduledSentence(picked)
            : ''}
      </p>

      <div className="flex flex-col gap-1">
        <Text size="sm" weight="bold">
          Scheduled On This Day
        </Text>
        {taken.length === 0 ? (
          <Text size="sm" muted>
            Nothing yet.
          </Text>
        ) : (
          <ul className="m-0 flex max-h-28 list-none flex-col gap-1 overflow-y-auto rounded-md bg-inset p-2 pg-scrollbar">
            {taken.map((time) => (
              <li key={time} className="font-sans text-sm tabular-nums text-ink">
                {new Date(time).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
