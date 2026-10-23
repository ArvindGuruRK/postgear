/**
 * The queue as a timeline: posts under the day they publish on, each day
 * named the way people say it ("Today", "Tomorrow", "Wednesday") for its
 * date tile (2026-10-23). A "Now" marker between the days was tried and
 * removed the same day, by the owner's call: today's violet tile already
 * says where the present is.
 *
 * Pure, so the grouping is tested without React.
 */
import type { PostSummary } from '@/types/post';
import type { QueueStateFilter } from './queue-filters';

export interface TimelineDay {
  /** The local day, `toDateString()`: unique per day, stable across renders. */
  key: string;
  /** "Today, Fri 23 Oct", for the section's accessible name. */
  label: string;
  /** "Today", "Tomorrow", "Yesterday", or the weekday in full ("Wednesday"). */
  name: string;
  /** "23". */
  dayNumber: string;
  /** "Oct", with the year when it is not this year ("Oct 2027"). */
  month: string;
  today: boolean;
  /** Before today: its tile is the quieter, textured one. */
  past: boolean;
  posts: PostSummary[];
}

/** Posts in the list's own order, under the day each one publishes on. */
export function buildTimeline(posts: PostSummary[], now: Date): TimelineDay[] {
  const days: TimelineDay[] = [];

  for (const post of posts) {
    const date = new Date(post.publishDate);
    const last = days[days.length - 1];

    if (last?.key === date.toDateString()) {
      last.posts.push(post);
    } else {
      days.push({ ...describeDay(date, now), posts: [post] });
    }
  }

  return days;
}

function describeDay(date: Date, now: Date): Omit<TimelineDay, 'posts'> {
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const relative =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null;
  const otherYear = date.getFullYear() !== now.getFullYear();
  const formatted = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' } : {}),
  });

  return {
    key: date.toDateString(),
    label: relative ? `${relative}, ${formatted}` : formatted,
    name: relative ?? date.toLocaleDateString(undefined, { weekday: 'long' }),
    dayNumber: String(date.getDate()),
    month: date.toLocaleDateString(undefined, {
      month: 'short',
      ...(otherYear ? { year: 'numeric' } : {}),
    }),
    today: diff === 0,
    past: diff < 0,
  };
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** What an empty tab says, and whether it offers to write a post. */
export function emptyCopy(state: QueueStateFilter): {
  title: string;
  description: string;
  create: boolean;
} {
  switch (state) {
    case 'QUEUE':
      return {
        title: 'No posts in the queue',
        description: 'Schedule a post and it lines up here, soonest first.',
        create: true,
      };
    case 'ERROR':
      return {
        title: 'No failed posts',
        description: 'Every post went out as planned. A post that fails shows up here with why.',
        create: false,
      };
    case 'DRAFT':
      return {
        title: 'No drafts',
        description: 'Save a post as a draft in the composer to finish it later.',
        create: true,
      };
    case 'PUBLISHED':
      return {
        title: 'No published posts yet',
        description: 'Posts land here once they go out, newest first.',
        create: false,
      };
    case 'all':
      return {
        title: 'No posts yet',
        description: 'Write a post in the composer and it shows up here.',
        create: true,
      };
  }
}
