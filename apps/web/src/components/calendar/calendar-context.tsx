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
 *
 * The two filters (channels from the channel card, tags from the toolbar,
 * 2026-10-19) live here for as long as the calendar is mounted, which spans
 * the composer opening over it and closing again; a reload starts unfiltered.
 * A post is shown when it is on a selected channel (or none is selected) and
 * carries a selected tag (or none is selected).
 *
 * The channel order is the server's (`GET /channels` sorts by the stored
 * position), with one local override: a drag in the channel card reorders at
 * once, before `PUT /channels/order` answers, and puts the old order back if
 * it fails. The override belongs to the channel list it was made on, so the
 * next server render (a `router.refresh()`) takes over again.
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
import { POSTS_CHANGED_EVENT } from '@/lib/post-events';
import type { Channel } from '@/types/channel';
import type { PostSummary } from '@/types/post';
import type { Tag } from '@/types/tag';
import { describePost } from '../posts/post-status';
import { filterPosts, orderChannels } from './calendar-filters';
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

/** How often "now" is re-read, so the time on the week view's line is never stale. */
const CLOCK_MS = 15_000;
/** How often otherwise, so a post published by the worker shows up without a reload. */
const IDLE_POLL_MS = 60_000;

interface CalendarContextValue {
  orgId: string;
  view: CalendarView;
  anchor: Date;
  now: Date;
  /** In the workspace's order, with a drag's new order applied at once. */
  channels: Channel[];
  /** Posts in the visible range, after the channel and tag filters. */
  posts: PostSummary[];
  /** Posts in the visible range, before the filters. */
  allPosts: PostSummary[];
  loading: boolean;
  error: string | null;
  /** Channel ids shown. Empty means every channel. */
  channelFilter: string[];
  /** The workspace's tags, by name; null until the first load answers. */
  tags: Tag[] | null;
  /** Tag ids shown. Empty means every post, tagged or not. */
  tagFilter: string[];
  toggleTag: (tagId: string) => void;
  clearTagFilter: () => void;
  /** Fetches the tags again: the composer can add one while the calendar is open. */
  reloadTags: () => void;
  /** Shows the channels in this order at once (ids; any left out keep their place after). */
  orderChannelsLocally: (ids: string[]) => void;
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
  channels: serverChannels,
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
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [tagsVersion, setTagsVersion] = useState(0);
  // The drag's order, tied to the server list it was made on (see above).
  const [localOrder, setLocalOrder] = useState<{ source: Channel[]; ids: string[] } | null>(null);
  const [allPosts, setAllPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const latest = useRef(0);

  const range = useMemo(() => visibleRange(view, anchor), [view, anchor]);

  // Keep the URL in step without a navigation: a navigation would remount
  // the page and lose the loaded posts. Only on the calendar's own URL: the
  // calendar also sits beneath the composer modal on `/composer`, whose query
  // (`?group=`, `?at=`) is the composer's, not ours.
  useEffect(() => {
    if (!window.location.pathname.endsWith('/calendar')) {
      return;
    }
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

  // The workspace's tags, for the toolbar's filter. A failure leaves the
  // last list (or none): the filter is a convenience, the calendar works
  // without it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tagsVersion` is the explicit reload trigger
  useEffect(() => {
    let cancelled = false;

    api<{ tags: Tag[] }>('/tags')
      .then((result) => {
        if (!cancelled) {
          setTags(result.tags);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTags((current) => current ?? []);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tagsVersion]);

  // Reload at once when the composer, open as a modal over the calendar,
  // saves or deletes a post: see lib/post-events.ts. Its tags too, since the
  // composer is where tags are made.
  useEffect(() => {
    const reload = () => {
      setVersion((current) => current + 1);
      setTagsVersion((current) => current + 1);
    };
    window.addEventListener(POSTS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(POSTS_CHANGED_EVENT, reload);
  }, []);

  // The clock, on its own beat (2026-10-21): the week view writes the time on
  // its "now" line, and the data refresh below only runs every minute (or
  // every ten seconds while something is publishing), which would leave the
  // time up to a minute behind.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

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

  const channels = useMemo(
    () =>
      localOrder && localOrder.source === serverChannels
        ? orderChannels(serverChannels, localOrder.ids)
        : serverChannels,
    [serverChannels, localOrder],
  );

  // Only ids that are still channels: one disconnected from the channel card
  // while selected would otherwise filter the calendar down to nothing.
  const activeFilter = useMemo(
    () => channelFilter.filter((id) => channels.some((channel) => channel.id === id)),
    [channelFilter, channels],
  );

  // The same for tags, once they have loaded: one deleted in the composer
  // while selected would hide every post.
  const activeTagFilter = useMemo(
    () => (tags ? tagFilter.filter((id) => tags.some((tag) => tag.id === id)) : tagFilter),
    [tagFilter, tags],
  );

  const posts = useMemo(
    () => filterPosts(allPosts, activeFilter, activeTagFilter),
    [allPosts, activeFilter, activeTagFilter],
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
      tags,
      tagFilter: activeTagFilter,
      toggleTag: (tagId) =>
        setTagFilter((current) =>
          current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
        ),
      clearTagFilter: () => setTagFilter([]),
      reloadTags: () => setTagsVersion((current) => current + 1),
      orderChannelsLocally: (ids) => setLocalOrder({ source: serverChannels, ids }),
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
    [
      orgId,
      view,
      anchor,
      now,
      channels,
      serverChannels,
      posts,
      allPosts,
      loading,
      error,
      activeFilter,
      tags,
      activeTagFilter,
    ],
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
