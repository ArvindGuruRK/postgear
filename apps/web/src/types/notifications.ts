/**
 * Notification shapes shared between server components and client islands
 * (Sprint 8). Mirror `GET /notifications*` — see
 * docs/sprint-documents/sprint-08-contract.md §5.2.
 */

export type NotificationType =
  | 'post.published'
  | 'post.failed'
  | 'channel.needs_reconnect'
  | 'billing.activated'
  | 'billing.payment_failed'
  | 'billing.canceled'
  | 'billing.trial_started'
  | 'webhook.failed'
  | 'info';

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string | null;
  content: string;
  /** A path inside the app, or an absolute platform URL, or nothing. */
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationsPage {
  notifications: NotificationView[];
  unread: number;
  lastReadAt: string | null;
}

export interface NotificationPreferences {
  successEmails: boolean;
  failureEmails: boolean;
}

/** `event: notification` on `GET /notifications/stream`. */
export interface NotificationStreamEvent {
  notification: NotificationView;
  unread: number;
}
