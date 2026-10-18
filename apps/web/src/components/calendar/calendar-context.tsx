'use client';

/**
 * The calendar's shared state: what is shown, for when, and the posts in it.
 *
 * Split from the rendering the way the reference splits `calendar.context`
 * from `calendar.tsx`: the views only draw; this owns the range, the fetch, the
 * filters and the optimistic move. Everything is in the viewer's local time,
 * which is why the posts are fetched from the browser rather than the server:
 * the server does not know which day "today" is where the viewer sits.
 *
 * The view and date live in the URL (`?view=week&date=2026-10-11`) so a reload
 * or a shared link lands on the same week.
 */
import { useSearchParams } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import type { PostSummary } from '@/types/post';
import { describePost } from '../posts/post-status';
import {
  type CalendarView,
  dayKey,
  isCalendarView,
  parseDayKey,
  shiftAnchor,
  startOfDay,
  visibleRange,
} from './calendar-math';

/** How often the visible range is refreshed while something on it is in motion. */
const LIVE_POLL_MS = 10_000;
/** How often otherwise, so a post published by the worker shows up without a reload. */
const IDLE_POLL_MS = 60_000;

interface CalendarContextValue {
  orgId: string;
  view: CalendarView;
  anchor: Date;
  now: Date;
  channels: Channel[];
  /** Posts in the visible range, after the channel filter. */
  posts: PostSummary[];
  /** Posts in the visible range, before the channel filter. */
  allPosts: PostSummary[];
  loading: boolean;
  error: string | null;
  /** Channel ids shown. Empty means every channel. */
  channelFilter: string[];
  setView: (view: CalendarView) => void;
  goTo: (anchor: Date, view?: CalendarView) => void;
  step: (direction: -1 | 1) => void;
  today: () => void;
  toggleChannel: (channelId: string) => void;
  clearChannelFilter: () => void;
  reload: () => void;
  /** Shows a post at a new time at once; the caller confirms or reverts. */
  movePostLocally: (group: string, publishDate: Date) => void;
  replacePost: (post: PostSummary) => void;
  removePostLocally: (group: string) => void;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({
  orgId,
  channels,
  children,
}: {
  orgId: string;
  channels: Channel[];
  children: ReactNode;
}) {
  const searchParams = useSearchParams();

  const [view, setViewState] = useState<CalendarView>(() => {
    const requested = searchParams.get('view');
    return isCalendarView(requested) ? requested : 'week';
  });
  const [anchor, setAnchor] = useState<Date>(
    () => parseDayKey(searchParams.get('date')) ?? startOfDay(new Date()),
  );
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [allPosts, setAllPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const latest = useRef(0);

  const range = useMemo(() => visibleRange(view, anchor), [view, anchor]);

  // Keep the URL in step without a navigation: a navigation would remount
  // the page and lose the loaded posts.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', view);
    params.set('date', dayKey(anchor));
    const next = `${window.location.pathname}?${params.toString()}`;

    // Only when something changed: Next's router listens to replaceState, and
    // a no-op rewrite could still race a navigation the person just started.
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [view, anchor]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the explicit reload trigger
  useEffect(() => {
    const request = ++latest.current;
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });

    setLoading(true);

    api<{ posts: PostSummary[] }>(`/posts/calendar?${params.toString()}`)
      .then((result) => {
        if (request === latest.current) {
          setAllPosts(result.posts);
          setError(null);
          setNow(new Date());
        }
      })
      .catch((cause: unknown) => {
        if (request === latest.current) {
          setError(cause instanceof ApiError ? cause.message : 'The calendar could not be loaded.');
        }
      })
      .finally(() => {
        if (request === latest.current) {
          setLoading(false);
        }
      });
  }, [range, version]);

  // Refresh while the worker is expected to change something in view.
  const live = useMemo(
    () => allPosts.some((post) => describePost(post, now).live),
    [allPosts, now],
  );

  useEffect(() => {
    const timer = setInterval(
      () => {
        setNow(new Date());
        if (document.visibilityState === 'visible') {
          setVersion((current) => current + 1);
        }
      },
      live ? LIVE_POLL_MS : IDLE_POLL_MS,
    );

    return () => clearInterval(timer);
  }, [live]);

  // Only ids that are still channels: one disconnected from the channel card
  // while selected would otherwise filter the calendar down to nothing.
  const activeFilter = useMemo(
    () => channelFilter.filter((id) => channels.some((channel) => channel.id === id)),
    [channelFilter, channels],
  );

  const posts = useMemo(
    () =>
      activeFilter.length === 0
        ? allPosts
        : allPosts.filter((post) =>
            post.channels.some((channel) => activeFilter.includes(channel.channelId)),
          ),
    [allPosts, activeFilter],
  );

  const value = useMemo<CalendarContextValue>(
    () => ({
      orgId,
      view,
      anchor,
      now,
      channels,
      posts,
      allPosts,
      loading,
      error,
      channelFilter: activeFilter,
      setView: (next) => setViewState(next),
      goTo: (next, nextView) => {
        setAnchor(startOfDay(next));
        if (nextView) {
          setViewState(nextView);
        }
      },
      step: (direction) => setAnchor((current) => shiftAnchor(view, current, direction)),
      today: () => setAnchor(startOfDay(new Date())),
      toggleChannel: (channelId) =>
        setChannelFilter((current) =>
          current.includes(channelId)
            ? current.filter((id) => id !== channelId)
            : [...current, channelId],
        ),
      clearChannelFilter: () => setChannelFilter([]),
      reload: () => setVersion((current) => current + 1),
      movePostLocally: (group, publishDate) =>
        setAllPosts((current) =>
          current.map((post) =>
            post.group === group ? { ...post, publishDate: publishDate.toISOString() } : post,
          ),
        ),
      replacePost: (post) =>
        setAllPosts((current) => {
          const index = current.findIndex((entry) => entry.group === post.group);
          return index === -1
            ? [...current, post]
            : current.map((entry) => (entry.group === post.group ? post : entry));
        }),
      removePostLocally: (group) =>
        setAllPosts((current) => current.filter((post) => post.group !== group)),
    }),
    [orgId, view, anchor, now, channels, posts, allPosts, loading, error, activeFilter],
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarContextValue {
  const value = useContext(CalendarContext);

  if (!value) {
    throw new Error('useCalendar must be used inside a CalendarProvider');
  }

  return value;
}
