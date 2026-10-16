/**
 * The bell's reducer and its small helpers: a page merges without losing a
 * live event, an event prepends once, the list is capped, read-all clears
 * the badge, and a link is classified before anyone navigates to it.
 */
import type { NotificationsPage, NotificationView } from '@/types/notifications';
import {
  formatTimestamp,
  initialNotificationsState,
  LIST_CAP,
  linkKind,
  type NotificationsState,
  notificationsReducer,
  reconnectDelay,
  titleOf,
} from './notifications-state';

function item(id: string, minute: number, overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id,
    type: 'post.published',
    title: 'Post published',
    content: `Published ${id}`,
    link: null,
    createdAt: new Date(Date.UTC(2026, 9, 16, 12, minute)).toISOString(),
    read: false,
    ...overrides,
  };
}

function page(notifications: NotificationView[], unread = notifications.length): NotificationsPage {
  return { notifications, unread, lastReadAt: null };
}

function reduce(...actions: Parameters<typeof notificationsReducer>[1][]): NotificationsState {
  return actions.reduce(notificationsReducer, initialNotificationsState());
}

describe('notificationsReducer', () => {
  it('starts empty and connecting', () => {
    expect(initialNotificationsState()).toEqual({
      items: [],
      unread: 0,
      lastReadAt: null,
      loaded: false,
      error: null,
      connection: 'connecting',
    });
  });

  it('loads a page, newest first, with the server count', () => {
    const state = reduce({ type: 'loaded', page: page([item('b', 2), item('a', 1)], 7) });

    expect(state.items.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(state.unread).toBe(7);
    expect(state.loaded).toBe(true);
    expect(state.error).toBeNull();
  });

  it('prepends a stream event once and takes its count', () => {
    const state = reduce(
      { type: 'loaded', page: page([item('a', 1)], 1) },
      { type: 'event', event: { notification: item('b', 2), unread: 2 } },
      { type: 'event', event: { notification: item('b', 2), unread: 2 } },
    );

    expect(state.items.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(state.unread).toBe(2);
  });

  it('keeps an event that arrived while the page was loading', () => {
    const state = reduce(
      { type: 'event', event: { notification: item('live', 5), unread: 1 } },
      { type: 'loaded', page: page([item('a', 1)], 1) },
    );

    expect(state.items.map((entry) => entry.id)).toEqual(['live', 'a']);
  });

  it('lets a re-fetched page update the read flag of an item it already holds', () => {
    const state = reduce(
      { type: 'event', event: { notification: item('a', 1), unread: 1 } },
      { type: 'loaded', page: page([item('a', 1, { read: true })], 0) },
    );

    expect(state.items[0].read).toBe(true);
    expect(state.unread).toBe(0);
  });

  it('caps the list', () => {
    const many = Array.from({ length: LIST_CAP + 5 }, (_, index) => item(`n${index}`, index));
    let state = reduce({ type: 'loaded', page: page(many.slice(0, LIST_CAP), LIST_CAP) });
    for (const extra of many.slice(LIST_CAP)) {
      state = notificationsReducer(state, {
        type: 'event',
        event: { notification: extra, unread: 0 },
      });
    }

    expect(state.items).toHaveLength(LIST_CAP);
    expect(state.items[0].id).toBe(`n${LIST_CAP + 4}`);
  });

  it('marks everything read and zeroes the badge on read_all', () => {
    const state = reduce(
      { type: 'loaded', page: page([item('a', 1), item('b', 2)], 2) },
      { type: 'read_all', lastReadAt: '2026-10-16T12:30:00.000Z' },
    );

    expect(state.items.every((entry) => entry.read)).toBe(true);
    expect(state.unread).toBe(0);
    expect(state.lastReadAt).toBe('2026-10-16T12:30:00.000Z');
  });

  it('takes the ready count and tracks the connection', () => {
    const state = reduce({ type: 'ready', unread: 4 }, { type: 'connection', state: 'open' });

    expect(state.unread).toBe(4);
    expect(state.connection).toBe('open');
    expect(notificationsReducer(state, { type: 'connection', state: 'open' })).toBe(state);
  });

  it('records a failed load without dropping what it has', () => {
    const state = reduce(
      { type: 'loaded', page: page([item('a', 1)]) },
      { type: 'load_failed', message: 'Network down' },
    );

    expect(state.items).toHaveLength(1);
    expect(state.error).toBe('Network down');
    expect(state.loaded).toBe(true);
  });
});

describe('helpers', () => {
  it('falls back to the catalogue title', () => {
    expect(titleOf(item('a', 1, { title: null, type: 'post.failed' }))).toBe('Post failed');
    expect(titleOf(item('a', 1, { title: 'Custom' }))).toBe('Custom');
  });

  it('classifies links', () => {
    expect(linkKind('/org/queue?state=ERROR')).toBe('app');
    expect(linkKind('https://www.linkedin.com/feed/update/1')).toBe('external');
    expect(linkKind('//evil.example')).toBe('none');
    expect(linkKind('javascript:alert(1)')).toBe('none');
    expect(linkKind(null)).toBe('none');
  });

  it('backs off from one second to thirty', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it('formats a timestamp relative to now', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    const at = (ms: number) => new Date(now.getTime() - ms).toISOString();

    expect(formatTimestamp(at(10_000), now)).toBe('just now');
    expect(formatTimestamp(at(5 * 60_000), now)).toBe('5m ago');
    expect(formatTimestamp(at(3 * 3_600_000), now)).toBe('3h ago');
    expect(formatTimestamp(at(26 * 3_600_000), now)).toBe('Yesterday');
    expect(formatTimestamp(at(3 * 86_400_000), now)).toBe('3d ago');
    expect(formatTimestamp(at(30 * 86_400_000), now)).toMatch(/Sep/);
    expect(formatTimestamp('nope', now)).toBe('');
  });
});
