/**
 * The bell's state, as a pure reducer (Sprint 8).
 *
 * The list is the most recent page of the workspace's feed plus whatever the
 * stream has pushed since: prepended, de-duplicated by id (the API pushes a
 * row from two places and a reconnect re-fetches the page), and capped so a
 * tab left open for a week does not hold the whole feed. The unread count is
 * the server's, carried on every page and every stream event, so the badge
 * never drifts from what a reload would show.
 */
import type {
  NotificationConnectionState,
  NotificationsPage,
  NotificationStreamEvent,
  NotificationType,
  NotificationView,
} from '@/types/notifications';

/** How many items the bell keeps. Older ones are a reload away. */
export const LIST_CAP = 50;

export interface NotificationsState {
  items: NotificationView[];
  unread: number;
  lastReadAt: string | null;
  /** The first page has arrived (or failed) at least once. */
  loaded: boolean;
  /** The last list fetch failed and there is nothing to show for it. */
  error: string | null;
  connection: NotificationConnectionState;
}

export type NotificationsAction =
  | { type: 'loaded'; page: NotificationsPage }
  | { type: 'load_failed'; message: string }
  | { type: 'ready'; unread: number }
  | { type: 'event'; event: NotificationStreamEvent }
  | { type: 'read_all'; lastReadAt: string }
  | { type: 'connection'; state: NotificationConnectionState };

export function initialNotificationsState(): NotificationsState {
  return {
    items: [],
    unread: 0,
    lastReadAt: null,
    loaded: false,
    error: null,
    connection: 'connecting',
  };
}

export function notificationsReducer(
  state: NotificationsState,
  action: NotificationsAction,
): NotificationsState {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        // Merged rather than replaced: an event that arrived while the page
        // was in flight is newer than the page and must not be lost.
        items: merge(action.page.notifications, state.items),
        unread: action.page.unread,
        lastReadAt: action.page.lastReadAt,
        loaded: true,
        error: null,
      };
    case 'load_failed':
      return { ...state, loaded: true, error: action.message };
    case 'ready':
      return { ...state, unread: action.unread };
    case 'event':
      return {
        ...state,
        items: merge([action.event.notification], state.items),
        unread: action.event.unread,
      };
    case 'read_all':
      return {
        ...state,
        items: state.items.map((item) => (item.read ? item : { ...item, read: true })),
        unread: 0,
        lastReadAt: action.lastReadAt,
      };
    case 'connection':
      return state.connection === action.state ? state : { ...state, connection: action.state };
  }
}

/**
 * The union of two lists by id, newest first, capped. When both hold an item
 * the incoming one wins: a re-fetched page carries the current `read` flag.
 */
function merge(incoming: NotificationView[], existing: NotificationView[]): NotificationView[] {
  const byId = new Map<string, NotificationView>();
  for (const item of existing) {
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    byId.set(item.id, item);
  }

  return [...byId.values()]
    .sort((a, b) => {
      const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
    })
    .slice(0, LIST_CAP);
}

/** The title shown for a row the writer left untitled: the API's catalogue, mirrored. */
export const NOTIFICATION_TITLES: Record<NotificationType, string> = {
  'post.published': 'Post published',
  'post.failed': 'Post failed',
  'channel.needs_reconnect': 'Channel needs reconnecting',
  'billing.activated': 'Subscription active',
  'billing.payment_failed': 'Payment failed',
  'billing.canceled': 'Subscription canceled',
  'billing.trial_started': 'Trial started',
  'webhook.failed': 'Webhook delivery failed',
  automation: 'Workflow message',
  'automation.review': 'Review needed',
  info: 'Notification',
};

export function titleOf(item: NotificationView): string {
  return item.title ?? NOTIFICATION_TITLES[item.type] ?? 'Notification';
}

/** Where a click goes: inside the app, out to a platform, or nowhere. */
export type LinkKind = 'app' | 'external' | 'none';

export function linkKind(link: string | null): LinkKind {
  if (!link) {
    return 'none';
  }
  if (link.startsWith('/') && !link.startsWith('//')) {
    return 'app';
  }
  if (/^https?:\/\//i.test(link)) {
    return 'external';
  }
  return 'none';
}

/** The reconnect delay after `attempt` failures: 1 s, 2 s, 4 s … capped at 30 s. */
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
}

/**
 * "just now", "5m ago", "3h ago", "Yesterday", or the date in the viewer's
 * locale. Called only after mount, since the locale is the browser's.
 */
export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }

  const seconds = Math.round((now.getTime() - then) / 1_000);
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
